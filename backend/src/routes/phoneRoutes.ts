import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest, isValidP256UncompressedPublicKey } from '../middleware/authMiddleware';
import { createRateLimiter } from '../middleware/rateLimit';
import { phoneSwitchService, hashDeviceToken, verifyDeviceToken } from '../services/phoneSwitchService';
import { homeAssistantMqttService } from '../services/homeAssistantMqttService';
import { acousticCalibrationService } from '../services/acousticCalibrationService';
import { getCachedFirmwareSha256 } from '../services/firmwareCache';
import { isReservedNumberOrPrefix } from '../services/phoneAllocationService';

const router = Router();

const ENROLLMENT_WORDS = ['TONE', 'CALL', 'DIAL', 'RING', 'BELL', 'WIRE', 'POST', 'HOOK', 'ROTR', 'DESK', 'PULSE', 'LINE'];

const enrollLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many device enrollment requests from this IP. Please try again later.'
});

const claimByCodeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many pairing code attempts. Please wait 15 minutes before trying again.'
});

function serializeWrappedVmKey(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
}

// Public Enrollment Endpoint: Called by ESP32-S3 or Simulator during OOBE Setup or boot
router.post('/enroll', enrollLimiter, async (req: Request, res: Response) => {
  try {
    const { deviceId, hardwareProfile, bellFrequencyHz, devicePublicKey } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const cleanDeviceId = String(deviceId).trim().toUpperCase();
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const validPubKey = isValidP256UncompressedPublicKey(devicePublicKey) ? String(devicePublicKey).trim() : null;

    // Check if device is already paired to a user: NEVER allow unauthenticated overwrite of device_public_key!
    const existingPhone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    if (existingPhone && existingPhone.user_id) {
      const providedToken = typeof req.headers['x-device-token'] === 'string' ? req.headers['x-device-token'].trim() : '';
      if (validPubKey && existingPhone.device_token_hash && verifyDeviceToken(providedToken, existingPhone.device_token_hash)) {
        await execute('UPDATE phones SET device_public_key = ? WHERE device_id = ?', [validPubKey, cleanDeviceId]);
      }
      return res.json({
        isPaired: true,
        deviceId: cleanDeviceId,
        message: 'Device already paired'
      });
    }

    // Check if there is an active pending enrollment code for this device
    let pending = await queryOne<any>(
      "SELECT * FROM pending_device_enrollments WHERE device_id = ? AND expires_at > datetime('now')",
      [cleanDeviceId]
    );

    if (!pending) {
      const wordPrefix = ENROLLMENT_WORDS[crypto.randomInt(0, ENROLLMENT_WORDS.length)];
      const numericCode = String(crypto.randomInt(1000, 10000));
      const pairingCode = `${wordPrefix}-${numericCode}`;

      await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);
      await execute(
        `INSERT INTO pending_device_enrollments (device_id, ip_address, pairing_code_word, pairing_code_numeric, pairing_code, expires_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', '+24 hours'))`,
        [cleanDeviceId, ip, wordPrefix, numericCode, pairingCode]
      );

      pending = await queryOne<any>('SELECT * FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);
    }

    // Ensure phone record exists (and store devicePublicKey if provided)
    if (!existingPhone) {
      await execute(
        `INSERT INTO phones (device_id, ip_address, hardware_profile, bell_frequency_hz, device_public_key, is_online, last_seen)
         VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [
          cleanDeviceId,
          ip,
          hardwareProfile || 'western_electric_500',
          bellFrequencyHz || 20.0,
          validPubKey
        ]
      );
    } else if (validPubKey) {
      await execute('UPDATE phones SET device_public_key = ?, ip_address = ? WHERE device_id = ?', [validPubKey, ip, cleanDeviceId]);
    }

    return res.json({
      isPaired: false,
      deviceId: cleanDeviceId,
      wordPrefix: pending.pairing_code_word,
      numericCode: pending.pairing_code_numeric,
      pairingCode: pending.pairing_code,
      expiresAt: pending.expires_at
    });
  } catch (err: any) {
    console.error('Phone enrollment error:', err);
    return res.status(500).json({ error: 'Failed to enroll phone' });
  }
});

// Authenticated Routes
router.use(authenticateToken);

// Claim / Pair a Rotary Telephone by Exact Word + Number Pairing Code (e.g. TONE-4821)
router.post('/claim-by-code', claimByCodeLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { wordPrefix, numericCode, pairingCode, phoneLabel, label, wrappedVmKey } = req.body;
    let inputStr = String(pairingCode || '').trim().toUpperCase();
    if (!inputStr && wordPrefix && numericCode) {
      inputStr = `${String(wordPrefix).trim().toUpperCase()}-${String(numericCode).trim()}`;
    }

    const normalizedInput = inputStr.replace(/[\s\-_]/g, '');
    if (!normalizedInput || normalizedInput.length < 6 || !/^[A-Z]{3,8}\d{4}$/.test(normalizedInput)) {
      return res.status(400).json({
        error: 'Full word-and-digits pairing code is required (for example: TONE-4821)'
      });
    }

    const pending = await queryOne<any>(
      `SELECT * FROM pending_device_enrollments
       WHERE (
         UPPER(pairing_code) = ?
         OR UPPER(REPLACE(REPLACE(pairing_code, '-', ''), ' ', '')) = ?
       ) AND expires_at > datetime('now')
       LIMIT 1`,
      [inputStr, normalizedInput]
    );

    if (!pending) {
      return res.status(404).json({
        error: 'Invalid or expired pairing code. Lift your handset to hear the active pairing code.'
      });
    }

    const cleanDeviceId = pending.device_id;
    const chosenLabel = String(phoneLabel || label || '').trim() || null;
    const serializedVmKey = serializeWrappedVmKey(wrappedVmKey);

    // Generate cryptographically random 32-byte per-device auth token & store only its SHA-256 hash
    const deviceToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashDeviceToken(deviceToken);

    const existingPhone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    if (!existingPhone) {
      await execute(
        `INSERT INTO phones (device_id, user_id, phone_label, device_token_hash, wrapped_vm_key, ip_address, paired_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [cleanDeviceId, req.user!.id, chosenLabel || 'Main Phone', tokenHash, serializedVmKey, pending.ip_address || null]
      );
    } else {
      await execute(
        `UPDATE phones
         SET user_id = ?,
             phone_label = COALESCE(?, phone_label, 'Main Phone'),
             device_token_hash = ?,
             wrapped_vm_key = COALESCE(?, wrapped_vm_key),
             paired_at = CURRENT_TIMESTAMP
         WHERE device_id = ?`,
        [req.user!.id, chosenLabel, tokenHash, serializedVmKey, cleanDeviceId]
      );
    }

    // Delete consumed pending enrollment entry
    await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);

    const phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    const user = await queryOne<any>('SELECT id, username, display_name, phone_number FROM users WHERE id = ?', [req.user!.id]);

    phoneSwitchService.pushDeviceSettings(cleanDeviceId, {
      earpieceVolume: phone?.earpiece_volume ?? 80,
      micSensitivity: phone?.mic_sensitivity ?? 80,
      audioProfile: phone?.audio_profile || 'vintage_pots',
      sidetoneLevel: phone?.sidetone_level ?? 10,
      ringStyle: phone?.ring_style || 'traditional',
      ringCadence: phone?.ring_cadence_custom || '2000,4000',
      bellFrequencyHz: phone?.bell_frequency_hz ?? 20.0,
      hookFlashEnabled: phone?.hook_flash_enabled !== 0,
      wrappedVmKey: phone?.wrapped_vm_key || null
    });

    const client = phoneSwitchService.getPhoneClient(cleanDeviceId);
    if (client && user) {
      client.userId = user.id;
      client.phoneNumber = user.phone_number;
      if (client.ws && client.ws.readyState === 1) {
        client.ws.send(
          JSON.stringify({
            type: 'pairing_complete',
            deviceId: cleanDeviceId,
            deviceToken,
            isPaired: true,
            ownerUsername: user.username,
            phoneNumber: user.phone_number,
            hardwareProfile: phone?.hardware_profile || 'western_electric_500',
            wrappedVmKey: phone?.wrapped_vm_key || null
          })
        );
        client.ws.send(
          JSON.stringify({
            type: 'register_ack',
            status: 'registered',
            deviceId: cleanDeviceId,
            deviceToken,
            isPaired: true,
            ownerUsername: user.username,
            phoneNumber: user.phone_number,
            hardwareProfile: phone?.hardware_profile || 'western_electric_500',
            wrappedVmKey: phone?.wrapped_vm_key || null
          })
        );
      }
    }

    phoneSwitchService.sendToUserWeb(
      req.user!.id,
      {
        type: 'phone_status_change',
        deviceId: cleanDeviceId,
        isOnline: !!phone?.is_online,
        isPaired: true,
        ownerUsername: user?.username,
        phoneNumber: user?.phone_number,
        hardwareProfile: phone?.hardware_profile
      },
      true
    );

    if (phone && user) {
      homeAssistantMqttService.registerPhoneDiscovery(phone, user).catch(console.error);
    }

    return res.json({
      message: 'Telephone paired successfully to your account!',
      devicePublicKey: phone?.device_public_key || null,
      phone: {
        id: phone?.id,
        deviceId: cleanDeviceId,
        phoneLabel: phone?.phone_label || 'Main Phone',
        ringEnabled: phone?.ring_enabled !== 0,
        isOnline: !!phone?.is_online,
        firmwareVersion: phone?.firmware_version || '1.3.0',
        hardwareProfile: phone?.hardware_profile || 'western_electric_500',
        devicePublicKey: phone?.device_public_key || null,
        hasWrappedVmKey: !!phone?.wrapped_vm_key
      }
    });
  } catch (err: any) {
    console.error('Claim by code error:', err);
    return res.status(500).json({ error: 'Failed to pair phone by code' });
  }
});

// Bell Frequency Resonance Manual Test
router.post(['/resonance-sweep', '/:phoneId/resonance-sweep'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phoneId = req.params.phoneId;
    const { frequencyHz, durationMs, deviceId } = req.body;
    let phone: any = null;
    if (phoneId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE id = ? AND user_id = ?', [phoneId, req.user!.id]);
    } else if (deviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [deviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const freq = Math.max(12.0, Math.min(35.0, parseFloat(frequencyHz) || 20.0));
    const dur = parseInt(durationMs, 10) || 3000;

    phoneSwitchService.pushDeviceSettings(phone.device_id, { bellFrequencyHz: freq });
    phoneSwitchService.sendTestRing(phone.device_id, phone.ring_style || 'traditional', '2000,4000');

    return res.json({
      message: `Resonance test ring sent at ${freq.toFixed(1)} Hz`,
      frequencyHz: freq,
      durationMs: dur
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to trigger resonance sweep' });
  }
});

// Automated Acoustic Resonance Sweep Calibration Wizard
router.post(['/calibrate-resonance-wizard', '/:phoneId/calibrate-resonance-wizard'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phoneId = req.params.phoneId;
    const { deviceId } = req.body;
    let phone: any = null;
    if (phoneId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE id = ? AND user_id = ?', [phoneId, req.user!.id]);
    } else if (deviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [deviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const client = phoneSwitchService.getPhoneClient(phone.device_id);
    if (!client || !client.ws) {
      return res.status(400).json({ error: 'Phone is currently offline. Ensure your phone adapter is powered on and connected.' });
    }

    const result = await acousticCalibrationService.runSweep(phone.device_id, client.ws, (prog) => {
      phoneSwitchService.sendToUserWeb(req.user!.id, {
        type: 'calibration_progress',
        deviceId: phone.device_id,
        freq: prog.freq,
        percent: prog.percent
      });
    });

    return res.json({
      message: `Acoustic calibration complete! Optimal bell resonance tuned to ${result.peakFrequency} Hz.`,
      result
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Calibration sweep failed' });
  }
});

// List all phones paired to current user
router.get('/list', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phones = await query<any>(
      `SELECT id, device_id, phone_label, ring_enabled, earpiece_volume, mic_sensitivity,
              audio_profile, sidetone_level, ring_style, ring_cadence_custom, ring_timeout_sec,
              hardware_profile, bell_frequency_hz, intercom_enabled, hook_flash_enabled,
              call_forwarding_enabled, forward_to_number, device_public_key, wrapped_vm_key,
              is_online, hook_state, call_state, firmware_version, rssi, ip_address, last_seen, paired_at,
              ota_auto_update_enabled, ota_update_time, ota_update_channel
       FROM phones WHERE user_id = ? ORDER BY id ASC`,
      [req.user!.id]
    );

    return res.json({
      phones: phones.map(p => ({
        id: p.id,
        deviceId: p.device_id,
        phoneLabel: p.phone_label || 'Main Phone',
        ringEnabled: p.ring_enabled !== 0,
        earpieceVolume: p.earpiece_volume ?? 80,
        micSensitivity: p.mic_sensitivity ?? 80,
        audioProfile: p.audio_profile || 'vintage_pots',
        sidetoneLevel: p.sidetone_level ?? 10,
        ringStyle: p.ring_style || 'traditional',
        ringCadenceCustom: p.ring_cadence_custom || '2000,4000',
        ringTimeoutSec: p.ring_timeout_sec || 25,
        hardwareProfile: p.hardware_profile || 'western_electric_500',
        bellFrequencyHz: p.bell_frequency_hz ?? 20.0,
        intercomEnabled: p.intercom_enabled !== 0,
        hookFlashEnabled: p.hook_flash_enabled !== 0,
        callForwardingEnabled: p.call_forwarding_enabled === 1,
        forwardToNumber: p.forward_to_number || '',
        devicePublicKey: p.device_public_key || null,
        hasWrappedVmKey: !!p.wrapped_vm_key,
        otaAutoUpdateEnabled: p.ota_auto_update_enabled !== 0,
        otaUpdateTime: p.ota_update_time || '03:00',
        otaUpdateChannel: p.ota_update_channel || 'stable',
        isOnline: !!p.is_online,
        hookState: p.hook_state || 'on_hook',
        callState: p.call_state || 'idle',
        firmwareVersion: p.firmware_version || '1.3.0',
        rssi: p.rssi ?? -50,
        ipAddress: p.ip_address || '',
        lastSeen: p.last_seen,
        pairedAt: p.paired_at
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list paired phones' });
  }
});

// Advanced Hardware Diagnostics (uses real board telemetry when reported, labeled Measured vs Default)
router.get(['/:phoneId/diagnostics', '/diagnostics'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phoneId = req.params.phoneId;
    let phone: any = null;
    if (phoneId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE id = ? AND user_id = ?', [phoneId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const client = phoneSwitchService.getPhoneClient(phone.device_id);
    const isLive = !!(client && client.ws && client.ws.readyState === 1);

    const liveTel = client?.telemetry || {};
    const measuredPps = liveTel.pps ?? phone.last_pps;
    const measuredBreak = liveTel.breakRatio ?? phone.last_break_ratio;
    const measuredNoise = liveTel.noiseFloorDb ?? phone.last_noise_floor_db;
    const measuredHeap = liveTel.freeHeap ?? phone.free_heap;
    const measuredPsram = liveTel.freePsram ?? phone.free_psram;
    const measuredRssi = liveTel.rssi ?? phone.rssi;

    const rssiVal = measuredRssi ?? -52;

    return res.json({
      diagnostics: {
        phoneLabel: phone.phone_label || 'Physical Phone',
        deviceId: phone.device_id,
        hardwareProfile: phone.hardware_profile || 'western_electric_500',
        firmwareVersion: phone.firmware_version || '1.3.0',
        isOnline: isLive,
        hookState: phone.hook_state || 'on_hook',
        callState: phone.call_state || 'idle',
        rssi: rssiVal,
        wifiQualityPercent: Math.min(100, Math.max(0, 2 * (rssiVal + 100))),
        ipAddress: phone.ip_address || '127.0.0.1',
        bellFrequencyHz: phone.bell_frequency_hz ?? 20.0,
        earpieceVolume: phone.earpiece_volume ?? 80,
        micSensitivity: phone.mic_sensitivity ?? 80,
        sidetoneLevel: phone.sidetone_level ?? 10,
        intercomEnabled: phone.intercom_enabled !== 0,
        hookFlashEnabled: phone.hook_flash_enabled !== 0,
        callForwardingEnabled: phone.call_forwarding_enabled === 1,
        forwardToNumber: phone.forward_to_number || null,
        e2eeReady: !!phone.device_public_key,
        vmKeySynced: !!phone.wrapped_vm_key,
        lastSeen: phone.last_seen || new Date().toISOString(),
        pairedAt: phone.paired_at,
        // Board Telemetry — distinguishes real hardware measurements from nominal defaults
        rotaryGovernorSpeed:
          measuredPps !== null && measuredPps !== undefined
            ? `${Number(measuredPps).toFixed(1)} PPS (Measured)`
            : '10.0 PPS (Default)',
        rotaryBreakRatio:
          measuredBreak !== null && measuredBreak !== undefined
            ? `${Number(measuredBreak).toFixed(1)}% (Measured)`
            : '60.5% (Default)',
        audioNoiseFloor:
          measuredNoise !== null && measuredNoise !== undefined
            ? `${Number(measuredNoise).toFixed(1)} dBFS (Measured)`
            : '-54.0 dBFS (Default)',
        freeHeap: measuredHeap ?? undefined,
        freePsram: measuredPsram ?? undefined,
        freeHeapBytes: measuredHeap ?? null,
        freePsramBytes: measuredPsram ?? null,
        memoryStatus:
          measuredHeap !== null && measuredHeap !== undefined
            ? `${Math.round(Number(measuredHeap) / 1024)} KB Heap${measuredPsram ? ` / ${Math.round(Number(measuredPsram) / 1024)} KB PSRAM` : ''} (Measured)`
            : 'Unreported (Default)',
        adcMicGain: `${phone.mic_sensitivity ?? 80}%`,
        dacOutputLevel: `${phone.earpiece_volume ?? 80}%`
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to query diagnostics' });
  }
});

// Direct Claim / Pair by Device ID (requires active pairing code or administrator privilege)
router.post('/claim', claimByCodeLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId, label, phoneLabel, wrappedVmKey, pairingCode } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const cleanDeviceId = String(deviceId).trim().toUpperCase();
    const chosenLabel = String(phoneLabel || label || '').trim() || null;
    const serializedVmKey = serializeWrappedVmKey(wrappedVmKey);

    const isAdmin = req.user!.role === 'admin';
    if (!isAdmin) {
      const codeStr = String(pairingCode || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
      const pending = codeStr
        ? await queryOne<any>(
            `SELECT * FROM pending_device_enrollments
             WHERE device_id = ?
               AND UPPER(REPLACE(REPLACE(pairing_code, '-', ''), ' ', '')) = ?
               AND expires_at > datetime('now')
             LIMIT 1`,
            [cleanDeviceId, codeStr]
          )
        : null;
      if (!pending) {
        return res.status(403).json({
          error: 'Direct claiming by Device ID requires the active pairing code or administrator privileges. Use /claim-by-code with your spoken pairing code.'
        });
      }
    }

    let phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);

    let issuedDeviceToken: string | null = null;
    const client = phoneSwitchService.getPhoneClient(cleanDeviceId);

    if (!phone) {
      if (!client && !isAdmin) {
        return res.status(409).json({
          error: 'Device must be online and enrolled with the switchboard before pairing.'
        });
      }
      issuedDeviceToken = crypto.randomBytes(32).toString('hex');
      await execute(
        `INSERT INTO phones (device_id, user_id, phone_label, device_token_hash, wrapped_vm_key, paired_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          cleanDeviceId,
          req.user!.id,
          chosenLabel || 'Main Phone',
          hashDeviceToken(issuedDeviceToken),
          serializedVmKey
        ]
      );
    } else {
      if (phone.user_id && phone.user_id !== req.user!.id) {
        return res.status(400).json({ error: 'This phone is already registered to another user' });
      }

      if (client) {
        issuedDeviceToken = crypto.randomBytes(32).toString('hex');
      } else if (!phone.device_token_hash && !isAdmin) {
        return res.status(409).json({
          error: 'Device is currently offline without credentials. Power it on before claiming so its token can be delivered securely.'
        });
      } else if (!phone.device_token_hash && isAdmin) {
        issuedDeviceToken = crypto.randomBytes(32).toString('hex');
      }

      await execute(
        `UPDATE phones
         SET user_id = ?,
             phone_label = COALESCE(?, phone_label, 'Main Phone'),
             device_token_hash = COALESCE(?, device_token_hash),
             wrapped_vm_key = COALESCE(?, wrapped_vm_key),
             paired_at = CURRENT_TIMESTAMP
         WHERE device_id = ?`,
        [
          req.user!.id,
          chosenLabel,
          issuedDeviceToken ? hashDeviceToken(issuedDeviceToken) : null,
          serializedVmKey,
          cleanDeviceId
        ]
      );
    }

    await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);

    phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    const user = await queryOne<any>('SELECT id, username, display_name, phone_number FROM users WHERE id = ?', [req.user!.id]);

    phoneSwitchService.pushDeviceSettings(cleanDeviceId, {
      earpieceVolume: phone?.earpiece_volume ?? 80,
      micSensitivity: phone?.mic_sensitivity ?? 80,
      ringStyle: phone?.ring_style || 'traditional',
      ringCadence: phone?.ring_cadence_custom || '2000,4000',
      hookFlashEnabled: phone?.hook_flash_enabled !== 0,
      wrappedVmKey: phone?.wrapped_vm_key || null
    });

    if (client && user) {
      client.userId = user.id;
      client.phoneNumber = user.phone_number;
      if (client.ws && client.ws.readyState === 1) {
        client.ws.send(
          JSON.stringify({
            type: 'pairing_complete',
            deviceId: cleanDeviceId,
            ...(issuedDeviceToken ? { deviceToken: issuedDeviceToken } : {}),
            isPaired: true,
            ownerUsername: user.username,
            phoneNumber: user.phone_number,
            wrappedVmKey: phone?.wrapped_vm_key || null
          })
        );
      }
    }

    if (phone && user) {
      homeAssistantMqttService.registerPhoneDiscovery(phone, user).catch(console.error);
    }

    return res.json({
      message: 'Phone paired successfully!',
      ...(!client && isAdmin && issuedDeviceToken ? { provisionedOfflineDeviceToken: issuedDeviceToken } : {}),
      devicePublicKey: phone?.device_public_key || null,
      phone: {
        id: phone?.id,
        deviceId: cleanDeviceId,
        phoneLabel: phone?.phone_label || 'Main Phone',
        ringEnabled: phone?.ring_enabled !== 0,
        isOnline: !!phone?.is_online,
        firmwareVersion: phone?.firmware_version || '1.3.0',
        devicePublicKey: phone?.device_public_key || null,
        hasWrappedVmKey: !!phone?.wrapped_vm_key
      }
    });
  } catch (err: any) {
    console.error('Claim phone error:', err);
    return res.status(500).json({ error: 'Failed to pair phone' });
  }
});

// Upload Device-Wrapped Voicemail Private Key (for local dial-0 ECIES voicemail decryption on ESP32/Simulator)
router.put('/:deviceId/vm-key', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cleanDeviceId = String(req.params.deviceId || '').trim().toUpperCase();
    const { wrappedVmKey } = req.body;

    if (!wrappedVmKey) {
      return res.status(400).json({ error: 'wrappedVmKey payload is required' });
    }

    const phone = await queryOne<any>(
      'SELECT * FROM phones WHERE device_id = ? AND user_id = ?',
      [cleanDeviceId, req.user!.id]
    );
    if (!phone) {
      return res.status(404).json({ error: 'Paired phone not found on your account' });
    }

    const serialized = serializeWrappedVmKey(wrappedVmKey);
    await execute('UPDATE phones SET wrapped_vm_key = ? WHERE id = ?', [serialized, phone.id]);

    phoneSwitchService.pushDeviceSettings(cleanDeviceId, { wrappedVmKey: serialized });

    return res.json({
      message: 'Encrypted voicemail key synced to device',
      deviceId: cleanDeviceId,
      hasWrappedVmKey: true
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save wrapped voicemail key' });
  }
});

// Unpair Phone (Specific or All)
router.post(['/unclaim', '/unclaim/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || req.body.deviceId;
    if (targetDeviceId) {
      const cleanId = String(targetDeviceId).trim().toUpperCase();
      await execute(
        `UPDATE phones
         SET user_id = NULL, device_token_hash = NULL, wrapped_vm_key = NULL,
             call_forwarding_enabled = 0, forward_to_number = NULL
         WHERE device_id = ? AND user_id = ?`,
        [cleanId, req.user!.id]
      );
      const client = phoneSwitchService.getPhoneClient(cleanId);
      if (client && client.userId === req.user!.id) {
        client.userId = undefined;
        client.phoneNumber = undefined;
      }
    } else {
      const phones = await query<any>('SELECT device_id FROM phones WHERE user_id = ?', [req.user!.id]);
      await execute(
        `UPDATE phones
         SET user_id = NULL, device_token_hash = NULL, wrapped_vm_key = NULL,
             call_forwarding_enabled = 0, forward_to_number = NULL
         WHERE user_id = ?`,
        [req.user!.id]
      );
      for (const p of phones) {
        const client = phoneSwitchService.getPhoneClient(p.device_id);
        if (client && client.userId === req.user!.id) {
          client.userId = undefined;
          client.phoneNumber = undefined;
        }
      }
    }
    return res.json({ message: 'Phone unpaired successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unpair phone' });
  }
});

// Legacy Alias: POST /api/phone/preferences -> Updates user DND & call privacy preferences
router.post('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      callPrivacy,
      dndManualState,
      dndScheduleEnabled,
      dndScheduleStart,
      dndScheduleEnd,
      dndScheduleDays,
      dndRepeatedCallBreakthrough,
      notifyOnVoicemail,
      notifyOnMissedCall
    } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (callPrivacy !== undefined) {
      const normalizedPrivacy =
        callPrivacy === 'anyone' || callPrivacy === 'open' ? 'everyone' : String(callPrivacy);
      if (!['everyone', 'friends_only', 'dnd', 'closed'].includes(normalizedPrivacy)) {
        return res.status(400).json({ error: 'Invalid callPrivacy value' });
      }
      updates.push('call_privacy = ?');
      params.push(normalizedPrivacy);
    }
    if (dndManualState !== undefined) {
      updates.push('dnd_manual_state = ?');
      params.push(dndManualState ? 1 : 0);
    }
    if (dndScheduleEnabled !== undefined) {
      updates.push('dnd_schedule_enabled = ?');
      params.push(dndScheduleEnabled ? 1 : 0);
    }
    if (dndScheduleStart !== undefined) {
      updates.push('dnd_schedule_start = ?');
      params.push(dndScheduleStart);
    }
    if (dndScheduleEnd !== undefined) {
      updates.push('dnd_schedule_end = ?');
      params.push(dndScheduleEnd);
    }
    if (dndScheduleDays !== undefined) {
      updates.push('dnd_schedule_days = ?');
      params.push(dndScheduleDays);
    }
    if (dndRepeatedCallBreakthrough !== undefined) {
      updates.push('dnd_repeated_call_breakthrough = ?');
      params.push(dndRepeatedCallBreakthrough ? 1 : 0);
    }
    if (notifyOnVoicemail !== undefined) {
      updates.push('notify_on_voicemail = ?');
      params.push(notifyOnVoicemail ? 1 : 0);
    }
    if (notifyOnMissedCall !== undefined) {
      updates.push('notify_on_missed_call = ?');
      params.push(notifyOnMissedCall ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(req.user!.id);
      await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    return res.json({ message: 'Call and DND preferences saved' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update preferences' });
  }
});

// Get Phone Hardware Settings (Primary or Specific Phone)
router.get(['/settings', '/settings/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || (req.query.deviceId as string);
    let phone: any = null;

    if (targetDeviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [targetDeviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? ORDER BY id ASC LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    return res.json({
      id: phone.id,
      deviceId: phone.device_id,
      phoneLabel: phone.phone_label || 'Main Phone',
      ringEnabled: phone.ring_enabled !== 0,
      earpieceVolume: phone.earpiece_volume ?? 80,
      micSensitivity: phone.mic_sensitivity ?? 80,
      audioProfile: phone.audio_profile || 'vintage_pots',
      sidetoneLevel: phone.sidetone_level ?? 10,
      ringStyle: phone.ring_style || 'traditional',
      ringCadenceCustom: phone.ring_cadence_custom || '2000,4000',
      ringTimeoutSec: phone.ring_timeout_sec || 25,
      hardwareProfile: phone.hardware_profile || 'western_electric_500',
      bellFrequencyHz: phone.bell_frequency_hz ?? 20.0,
      intercomEnabled: phone.intercom_enabled !== 0,
      hookFlashEnabled: phone.hook_flash_enabled !== 0,
      callForwardingEnabled: phone.call_forwarding_enabled === 1,
      forwardToNumber: phone.forward_to_number || '',
      devicePublicKey: phone.device_public_key || null,
      hasWrappedVmKey: !!phone.wrapped_vm_key,
      otaAutoUpdateEnabled: phone.ota_auto_update_enabled !== 0,
      otaUpdateTime: phone.ota_update_time || '03:00',
      otaUpdateChannel: phone.ota_update_channel || 'stable',
      isOnline: !!phone.is_online,
      hookState: phone.hook_state,
      callState: phone.call_state,
      firmwareVersion: phone.firmware_version,
      rssi: phone.rssi,
      ipAddress: phone.ip_address,
      lastSeen: phone.last_seen,
      pairedAt: phone.paired_at
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch phone settings' });
  }
});

// Update Phone Hardware Settings (Primary or Specific Phone)
router.put(['/settings', '/settings/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || req.body.deviceId;
    const {
      phoneLabel,
      ringEnabled,
      earpieceVolume,
      micSensitivity,
      audioProfile,
      sidetoneLevel,
      ringStyle,
      ringCadenceCustom,
      ringTimeoutSec,
      hardwareProfile,
      bellFrequencyHz,
      intercomEnabled,
      hookFlashEnabled,
      callForwardingEnabled,
      forwardToNumber,
      otaAutoUpdateEnabled,
      otaUpdateTime,
      otaUpdateChannel
    } = req.body;

    let phone: any = null;
    if (targetDeviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [targetDeviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? ORDER BY id ASC LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    if (forwardToNumber !== undefined && forwardToNumber !== null && String(forwardToNumber).trim() !== '') {
      const cleanFwd = String(forwardToNumber).trim();
      if (!/^\d+$/.test(cleanFwd) || cleanFwd === req.user!.phone_number || ['911', '112', '999', '000', '9911'].includes(cleanFwd)) {
        return res.status(400).json({ error: 'Invalid call forwarding target extension' });
      }
    }

    const parseBoundedInt = (raw: any, min: number, max: number, label: string, fallback: number): number => {
      if (raw === undefined || raw === null) return fallback;
      const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(num)) {
        throw new Error(`Invalid numeric value for ${label}`);
      }
      return Math.max(min, Math.min(max, Math.round(num)));
    };

    let newVol: number;
    let newMic: number;
    let newSidetone: number;
    let newTimeout: number;
    let newBellFreq: number;
    try {
      newVol = parseBoundedInt(earpieceVolume, 0, 100, 'earpieceVolume', phone.earpiece_volume ?? 80);
      newMic = parseBoundedInt(micSensitivity, 0, 100, 'micSensitivity', phone.mic_sensitivity ?? 80);
      newSidetone = parseBoundedInt(sidetoneLevel, 0, 30, 'sidetoneLevel', phone.sidetone_level ?? 10);
      newTimeout = ringTimeoutSec !== undefined && ringTimeoutSec !== null
        ? parseBoundedInt(ringTimeoutSec, 5, 60, 'ringTimeoutSec', phone.ring_timeout_sec ?? 25)
        : (phone.ring_timeout_sec ?? 25);
      if (bellFrequencyHz !== undefined && bellFrequencyHz !== null) {
        const bf = typeof bellFrequencyHz === 'number' ? bellFrequencyHz : Number(String(bellFrequencyHz).trim());
        if (!Number.isFinite(bf)) {
          throw new Error('Invalid numeric value for bellFrequencyHz');
        }
        newBellFreq = Math.max(12.0, Math.min(35.0, bf));
      } else {
        newBellFreq = phone.bell_frequency_hz ?? 20.0;
      }
    } catch (valErr: any) {
      return res.status(400).json({ error: valErr.message || 'Invalid numeric hardware setting' });
    }

    const newLabel = phoneLabel !== undefined ? String(phoneLabel).trim() : (phone.phone_label || 'Main Phone');
    const newRingEnabled = ringEnabled !== undefined ? (ringEnabled ? 1 : 0) : (phone.ring_enabled ?? 1);
    const newAudioProfile = audioProfile || phone.audio_profile || 'vintage_pots';
    const newStyle = ringStyle || phone.ring_style;
    const newCadence = ringCadenceCustom || phone.ring_cadence_custom;
    const newHardwareProfile = hardwareProfile || phone.hardware_profile || 'western_electric_500';
    const newIntercom = intercomEnabled !== undefined ? (intercomEnabled ? 1 : 0) : (phone.intercom_enabled ?? 1);
    const newHookFlash = hookFlashEnabled !== undefined ? (hookFlashEnabled ? 1 : 0) : (phone.hook_flash_enabled ?? 1);
    const newCallFwdEnabled = callForwardingEnabled !== undefined ? (callForwardingEnabled ? 1 : 0) : (phone.call_forwarding_enabled ?? 0);
    const newForwardTo =
      forwardToNumber !== undefined
        ? (String(forwardToNumber).trim() || null)
        : (phone.forward_to_number || null);
    const newOtaEnabled = otaAutoUpdateEnabled !== undefined ? (otaAutoUpdateEnabled ? 1 : 0) : (phone.ota_auto_update_enabled ?? 1);
    const newOtaTime = otaUpdateTime || phone.ota_update_time || '03:00';
    const newOtaChannel = ['stable', 'beta', 'alpha'].includes(String(otaUpdateChannel))
      ? String(otaUpdateChannel)
      : (phone.ota_update_channel || 'stable');

    await execute(
      `UPDATE phones SET
        phone_label = ?,
        ring_enabled = ?,
        earpiece_volume = ?,
        mic_sensitivity = ?,
        audio_profile = ?,
        sidetone_level = ?,
        ring_style = ?,
        ring_cadence_custom = ?,
        ring_timeout_sec = ?,
        hardware_profile = ?,
        bell_frequency_hz = ?,
        intercom_enabled = ?,
        hook_flash_enabled = ?,
        call_forwarding_enabled = ?,
        forward_to_number = ?,
        ota_auto_update_enabled = ?,
        ota_update_time = ?,
        ota_update_channel = ?
       WHERE id = ?`,
      [
        newLabel,
        newRingEnabled,
        newVol,
        newMic,
        newAudioProfile,
        newSidetone,
        newStyle,
        newCadence,
        newTimeout,
        newHardwareProfile,
        newBellFreq,
        newIntercom,
        newHookFlash,
        newCallFwdEnabled,
        newForwardTo,
        newOtaEnabled,
        newOtaTime,
        newOtaChannel,
        phone.id
      ]
    );

    // Push new settings to live hardware immediately over WebSocket
    phoneSwitchService.pushDeviceSettings(phone.device_id, {
      earpieceVolume: newVol,
      micSensitivity: newMic,
      audioProfile: newAudioProfile,
      sidetoneLevel: newSidetone,
      ringStyle: newStyle,
      ringCadence: newCadence,
      bellFrequencyHz: newBellFreq,
      hardwareProfile: newHardwareProfile,
      intercomEnabled: newIntercom === 1,
      hookFlashEnabled: newHookFlash === 1,
      wrappedVmKey: phone.wrapped_vm_key || null
    });

    const updatedPhone = await queryOne<any>('SELECT * FROM phones WHERE id = ?', [phone.id]);
    const user = await queryOne<any>('SELECT id, username, display_name FROM users WHERE id = ?', [req.user!.id]);
    if (updatedPhone && user) {
      homeAssistantMqttService.registerPhoneDiscovery(updatedPhone, user).catch(console.error);
    }

    return res.json({ message: 'Hardware and audio DSP settings saved and synced to your phone!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update phone settings' });
  }
});

// Trigger Remote Test Ring (Specific or All User Phones)
router.post(['/test-ring', '/test-ring/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || req.body.deviceId;
    let phones: any[] = [];

    if (targetDeviceId) {
      const p = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [targetDeviceId, req.user!.id]);
      if (p) phones.push(p);
    } else {
      phones = await query<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    }

    if (phones.length === 0) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    let ringsSent = 0;
    for (const phone of phones) {
      if (phone.is_online) {
        phoneSwitchService.sendTestRing(phone.device_id, phone.ring_style, phone.ring_cadence_custom);
        ringsSent++;
      }
    }

    if (ringsSent === 0) {
      return res.status(400).json({ error: 'Phone(s) currently offline. Please check WiFi connection.' });
    }

    return res.json({ message: `Test ring sent to ${ringsSent} phone(s)! Your rotary bells should ring now.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send test ring' });
  }
});

// Trigger Remote Reboot (Specific or Primary Phone)
router.post(['/reboot', '/reboot/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || req.body.deviceId;
    let phone: any = null;

    if (targetDeviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [targetDeviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const sent = phoneSwitchService.sendRemoteReboot(phone.device_id);
    if (!sent) {
      return res.status(400).json({ error: 'Phone is currently offline' });
    }

    return res.json({ message: `Reboot command sent to ${phone.phone_label || phone.device_id}` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reboot phone' });
  }
});

// Trigger Manual OTA Firmware Update for Specific or Primary Phone
router.post(['/ota-update', '/ota-update/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || req.body.deviceId;
    let phone: any = null;

    if (targetDeviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [targetDeviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? LIMIT 1', [req.user!.id]);
    }

    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const client = phoneSwitchService.getPhoneClient(phone.device_id);
    if (!client || client.ws.readyState !== 1) {
      return res.status(400).json({ error: 'Phone is currently offline. Connect your hardware before starting OTA update.' });
    }

    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const binUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_binary_url"');

    const firmwareVersion = versionRow?.value || '1.3.0';
    const binaryUrl = binUrlRow?.value || '/api/firmware/download/latest';
    const sha256 = await getCachedFirmwareSha256();
    if (!sha256) {
      return res.status(404).json({ error: 'No verified firmware binary available on the server.' });
    }

    phoneSwitchService.sendToDevice(phone.device_id, {
      type: 'ota_available',
      version: firmwareVersion,
      binaryUrl,
      downloadUrl: binaryUrl,
      sha256
    });

    return res.json({
      message: `OTA update signal dispatched to ${phone.phone_label || phone.device_id}! Flashing v${firmwareVersion}...`,
      version: firmwareVersion,
      sha256
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to trigger manual OTA update' });
  }
});

// Speed Dials Management (Slots 1-9)
router.get('/speed-dials', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const speedDials = await query<any>(
      `SELECT sd.slot_digit, sd.target_phone_number, sd.label, u.username as target_username, u.display_name as target_display_name
       FROM speed_dials sd
       LEFT JOIN users u ON u.id = sd.target_user_id
       WHERE sd.user_id = ?
       ORDER BY sd.slot_digit ASC`,
      [req.user!.id]
    );

    return res.json({ speedDials });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch speed dials' });
  }
});

router.put('/speed-dials', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { slotDigit, targetPhoneNumber, label, targetUserId } = req.body;
    const digit = parseInt(slotDigit, 10);

    if (isNaN(digit) || digit < 1 || digit > 9) {
      return res.status(400).json({ error: 'Slot digit must be between 1 and 9' });
    }

    if (!targetPhoneNumber || !/^\d+$/.test(String(targetPhoneNumber).trim())) {
      return res.status(400).json({ error: 'Valid numeric target phone number is required' });
    }

    const cleanTarget = String(targetPhoneNumber).trim();
    if (['911', '112', '999', '000', '9911'].includes(cleanTarget)) {
      return res.status(400).json({ error: 'Emergency numbers cannot be assigned to speed dial' });
    }

    let resolvedTargetUserId = targetUserId || null;
    if (!resolvedTargetUserId) {
      const targetUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE phone_number = ?', [cleanTarget]);
      if (targetUser) resolvedTargetUserId = targetUser.id;
    }

    await execute(
      `INSERT OR REPLACE INTO speed_dials (user_id, slot_digit, target_user_id, target_phone_number, label)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user!.id, digit, resolvedTargetUserId, cleanTarget, label?.trim() || null]
    );

    return res.json({ message: `Speed dial slot ${digit} saved!` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save speed dial' });
  }
});

router.delete('/speed-dials/:slot', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    await execute('DELETE FROM speed_dials WHERE user_id = ? AND slot_digit = ?', [req.user!.id, slot]);
    return res.json({ message: `Speed dial slot ${slot} cleared` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete speed dial' });
  }
});

// Dial Extension from Web (supports paired hardware phone OR active web softphone)
router.post('/dial', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const calleeNumber = String(req.body.calleeNumber || req.body.destination || '').trim();
    const requestedDeviceId = req.body.deviceId ? String(req.body.deviceId).trim() : undefined;
    if (!calleeNumber) {
      return res.status(400).json({ error: 'Destination number required' });
    }

    let callerDeviceId: string | null = null;

    if (requestedDeviceId) {
      const cl = phoneSwitchService.getPhoneClient(requestedDeviceId);
      if (cl && cl.userId === req.user!.id && cl.ws.readyState === 1) {
        callerDeviceId = requestedDeviceId;
      } else {
        const owned = await queryOne<any>(
          'SELECT device_id, is_online FROM phones WHERE device_id = ? AND user_id = ?',
          [requestedDeviceId, req.user!.id]
        );
        if (owned && owned.is_online) callerDeviceId = owned.device_id;
      }
    }

    if (!callerDeviceId) {
      const onlineHw = await queryOne<any>(
        'SELECT device_id FROM phones WHERE user_id = ? AND is_online = 1 LIMIT 1',
        [req.user!.id]
      );
      if (onlineHw) {
        callerDeviceId = onlineHw.device_id;
      }
    }

    if (!callerDeviceId) {
      // Check if user has an active non-monitor Web Softphone session
      const webDeviceId = phoneSwitchService.findActiveWebSoftphoneDeviceId(req.user!.id);
      if (webDeviceId) {
        callerDeviceId = webDeviceId;
      }
    }

    if (!callerDeviceId) {
      return res.status(400).json({
        error: 'Your telephone hardware or Web Softphone must be online to initiate a call'
      });
    }

    await phoneSwitchService.initiateCall(callerDeviceId, calleeNumber);
    return res.json({ message: `Calling ${calleeNumber}...`, callerDeviceId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to place call' });
  }
});

// Answer Incoming Call from Web UI / CallModal
router.post('/answer', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId, callId } = req.body || {};
    const answered = await phoneSwitchService.answerForUser(req.user!.id, deviceId, callId);
    if (!answered) {
      return res.status(404).json({ error: 'No incoming ringing call found to answer' });
    }
    return res.json({ message: 'Call answered' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to answer call' });
  }
});

// End / Hang Up Active Call from Web UI (covers both hardware phones AND active WEB-... softphone clients!)
router.post('/hangup', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await phoneSwitchService.hangupAllForUser(req.user!.id);
    return res.json({ message: 'Call ended' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to hang up call' });
  }
});

// Call History
router.get('/calls', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const calls = await query<any>(
      `SELECT c.*, 
              caller.username as caller_username, caller.display_name as caller_display_name,
              callee.username as callee_username, callee.display_name as callee_display_name
       FROM calls c
       LEFT JOIN users caller ON caller.id = c.caller_user_id
       LEFT JOIN users callee ON callee.id = c.callee_user_id
       WHERE c.caller_user_id = ? OR c.callee_user_id = ?
       ORDER BY c.id DESC LIMIT 50`,
      [req.user!.id, req.user!.id]
    );

    return res.json({ calls });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

export default router;
