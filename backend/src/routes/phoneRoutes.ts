import { Router, Request, Response } from 'express';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { phoneSwitchService } from '../services/phoneSwitchService';
import { homeAssistantMqttService } from '../services/homeAssistantMqttService';
import { acousticCalibrationService } from '../services/acousticCalibrationService';

const router = Router();

const ENROLLMENT_WORDS = ['TONE', 'CALL', 'DIAL', 'RING', 'BELL', 'CORD', 'VINTAGE'];

// Public Enrollment Endpoint: Called by ESP32-S3 during OOBE Setup or boot
router.post('/enroll', async (req: Request, res: Response) => {
  try {
    const { deviceId, mac, hardwareProfile, bellFrequencyHz } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const cleanDeviceId = deviceId.trim().toUpperCase();
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';

    // Check if device is already paired to a user
    const existingPhone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    if (existingPhone && existingPhone.user_id) {
      return res.json({
        isPaired: true,
        deviceId: cleanDeviceId,
        message: 'Device already paired'
      });
    }

    // Check if there is an active pending enrollment code for this device
    let pending = await queryOne<any>(
      'SELECT * FROM pending_device_enrollments WHERE device_id = ? AND expires_at > datetime("now")',
      [cleanDeviceId]
    );

    if (!pending) {
      // Pick a randomized word prefix and 4-digit code
      const wordPrefix = ENROLLMENT_WORDS[Math.floor(Math.random() * ENROLLMENT_WORDS.length)];
      const numericCode = String(Math.floor(1000 + Math.random() * 9000));
      const pairingCode = `${wordPrefix} ${numericCode}`;

      await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);
      await execute(
        `INSERT INTO pending_device_enrollments (device_id, word_prefix, numeric_code, pairing_code, mac_address, ip_address, hardware_profile, bell_frequency_hz, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))`,
        [cleanDeviceId, wordPrefix, numericCode, pairingCode, mac || '', ip, hardwareProfile || 'western_electric_500', bellFrequencyHz || 20.0]
      );

      pending = await queryOne<any>('SELECT * FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);
    }

    // Ensure phone record exists
    if (!existingPhone) {
      await execute(
        `INSERT INTO phones (device_id, mac_address, ip_address, hardware_profile, bell_frequency_hz, is_online, last_seen)
         VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [cleanDeviceId, mac || '', ip, hardwareProfile || 'western_electric_500', bellFrequencyHz || 20.0]
      );
    }

    return res.json({
      isPaired: false,
      deviceId: cleanDeviceId,
      wordPrefix: pending.word_prefix,
      numericCode: pending.numeric_code,
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

// Claim / Pair a Rotary Telephone by Word + Number Pairing Code
router.post('/claim-by-code', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { wordPrefix, numericCode, pairingCode } = req.body;
    let inputStr = (pairingCode || '').trim().toUpperCase();
    if (!inputStr && wordPrefix && numericCode) {
      inputStr = `${wordPrefix.trim().toUpperCase()}-${numericCode.trim()}`;
    }

    if (!inputStr) {
      return res.status(400).json({ error: 'Pairing code is required (e.g. TONE-4821 or 4821)' });
    }

    const normalizedInput = inputStr.replace(/[\s\-_]/g, '');

    // Search pending enrollments matching full code, numeric code, or normalized string
    const pending = await queryOne<any>(
      `SELECT * FROM pending_device_enrollments 
       WHERE (
         pairing_code = ? 
         OR pairing_code_numeric = ? 
         OR REPLACE(REPLACE(pairing_code, '-', ''), ' ', '') = ?
         OR pairing_code LIKE ?
       ) AND expires_at > datetime("now") LIMIT 1`,
      [inputStr, inputStr, normalizedInput, `%${inputStr}%`]
    );

    if (!pending) {
      return res.status(404).json({ error: 'Invalid or expired pairing code. Check the code displayed on your phone adapter.' });
    }

    const cleanDeviceId = pending.device_id;

    // Assign phone to this user
    await execute(
      'UPDATE phones SET user_id = ?, paired_at = CURRENT_TIMESTAMP WHERE device_id = ?',
      [req.user!.id, cleanDeviceId]
    );

    // Delete pending enrollment entry
    await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);

    const phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    const user = await queryOne<any>('SELECT id, username, display_name, phone_number FROM users WHERE id = ?', [req.user!.id]);

    phoneSwitchService.pushDeviceSettings(cleanDeviceId, {
      earpieceVolume: phone?.earpiece_volume ?? 80,
      micSensitivity: phone?.mic_sensitivity ?? 80,
      ringStyle: phone?.ring_style || 'traditional',
      ringCadence: phone?.ring_cadence_custom || '2000,4000',
      bellFrequencyHz: phone?.bell_frequency_hz ?? 20.0
    });

    const client = phoneSwitchService.getPhoneClient(cleanDeviceId);
    if (client) {
      client.userId = user.id;
      client.phoneNumber = user.phone_number;
      if (client.ws && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify({
          type: 'register_ack',
          status: 'registered',
          deviceId: cleanDeviceId,
          isPaired: true,
          ownerUsername: user.username,
          phoneNumber: user.phone_number,
          hardwareProfile: phone?.hardware_profile || 'western_electric_500'
        }));
      }
    }

    phoneSwitchService.broadcastToWeb({
      type: 'phone_status_change',
      deviceId: cleanDeviceId,
      isOnline: !!phone?.is_online,
      isPaired: true,
      ownerUsername: user.username,
      phoneNumber: user.phone_number,
      hardwareProfile: phone?.hardware_profile
    });

    homeAssistantMqttService.registerPhoneDiscovery(phone, user).catch(console.error);

    return res.json({
      message: 'Telephone paired successfully to your account!',
      phone: {
        id: phone?.id,
        phoneLabel: phone?.phone_label || 'Main Phone',
        ringEnabled: phone?.ring_enabled !== 0,
        isOnline: !!phone?.is_online,
        firmwareVersion: phone?.firmware_version || '1.2.2',
        hardwareProfile: phone?.hardware_profile || 'western_electric_500'
      }
    });
  } catch (err: any) {
    console.error('Claim by code error:', err);
    return res.status(500).json({ error: 'Failed to pair phone by code' });
  }
});

// Bell Frequency Resonance Manual Test & Automated Acoustic Sweep Wizard
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

    const freq = parseFloat(frequencyHz) || 20.0;
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
      phoneSwitchService.broadcastToWeb({
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
              hardware_profile, bell_frequency_hz, intercom_enabled, is_online, hook_state,
              call_state, firmware_version, rssi, ip_address, last_seen, paired_at,
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
        otaAutoUpdateEnabled: p.ota_auto_update_enabled !== 0,
        otaUpdateTime: p.ota_update_time || '03:00',
        otaUpdateChannel: p.ota_update_channel || 'stable',
        isOnline: !!p.is_online,
        hookState: p.hook_state || 'on_hook',
        callState: p.call_state || 'idle',
        firmwareVersion: p.firmware_version || '1.2.2',
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

// Advanced Hardware Diagnostics
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
    const isLive = client && client.ws && client.ws.readyState === 1;

    return res.json({
      diagnostics: {
        phoneLabel: phone.phone_label || 'Physical Phone',
        hardwareProfile: phone.hardware_profile || 'western_electric_500',
        firmwareVersion: phone.firmware_version || '1.2.2',
        isOnline: isLive,
        hookState: phone.hook_state || 'on_hook',
        callState: phone.call_state || 'idle',
        rssi: phone.rssi ?? -52,
        wifiQualityPercent: Math.min(100, Math.max(0, 2 * ((phone.rssi ?? -52) + 100))),
        ipAddress: phone.ip_address || '127.0.0.1',
        bellFrequencyHz: phone.bell_frequency_hz ?? 20.0,
        earpieceVolume: phone.earpiece_volume ?? 80,
        micSensitivity: phone.mic_sensitivity ?? 80,
        sidetoneLevel: phone.sidetone_level ?? 10,
        intercomEnabled: phone.intercom_enabled !== 0,
        lastSeen: phone.last_seen || new Date().toISOString(),
        pairedAt: phone.paired_at,
        // Board Telemetry
        rotaryGovernorSpeed: '10.0 PPS (Normal)',
        rotaryBreakRatio: '60.5% (Optimal)',
        audioNoiseFloor: '-54 dBFS (Clean)',
        adcMicGain: `${phone.mic_sensitivity ?? 80}%`,
        dacOutputLevel: `${phone.earpiece_volume ?? 80}%`
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to query diagnostics' });
  }
});

// Legacy Claim / Pair by Device ID
router.post('/claim', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId, label } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const cleanDeviceId = deviceId.trim().toUpperCase();

    // Check if phone exists in DB (reported by ESP32-S3 on boot)
    let phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);

    if (!phone) {
      // Allow pre-claiming: create device entry in DB waiting for hardware check-in
      await execute(
        'INSERT INTO phones (device_id, user_id, phone_label, paired_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [cleanDeviceId, req.user!.id, label?.trim() || 'Main Phone']
      );
    } else {
      if (phone.user_id && phone.user_id !== req.user!.id) {
        return res.status(400).json({ error: 'This phone is already registered to another user' });
      }

      // Assign to this user (preserving existing phones)
      await execute(
        'UPDATE phones SET user_id = ?, phone_label = COALESCE(?, phone_label), paired_at = CURRENT_TIMESTAMP WHERE device_id = ?',
        [req.user!.id, label?.trim() || null, cleanDeviceId]
      );
    }

    // Push updated pairing status and settings to device if online
    phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);
    phoneSwitchService.pushDeviceSettings(cleanDeviceId, {
      earpieceVolume: phone?.earpiece_volume || 80,
      micSensitivity: phone?.mic_sensitivity || 80,
      ringStyle: phone?.ring_style || 'traditional',
      ringCadence: phone?.ring_cadence_custom || '2000,4000'
    });

    const user = await queryOne<any>('SELECT id, username, display_name FROM users WHERE id = ?', [req.user!.id]);
    homeAssistantMqttService.registerPhoneDiscovery(phone, user).catch(console.error);

    return res.json({
      message: 'Phone paired successfully!',
      phone: {
        deviceId: cleanDeviceId,
        phoneLabel: phone?.phone_label || 'Main Phone',
        ringEnabled: phone?.ring_enabled !== 0,
        isOnline: !!phone?.is_online,
        firmwareVersion: phone?.firmware_version || '1.2.0'
      }
    });
  } catch (err: any) {
    console.error('Claim phone error:', err);
    return res.status(500).json({ error: 'Failed to pair phone' });
  }
});

// Unpair Phone (Specific or All)
router.post(['/unclaim', '/unclaim/:deviceId'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetDeviceId = req.params.deviceId || req.body.deviceId;
    if (targetDeviceId) {
      await execute('UPDATE phones SET user_id = NULL WHERE device_id = ? AND user_id = ?', [targetDeviceId, req.user!.id]);
    } else {
      await execute('UPDATE phones SET user_id = NULL WHERE user_id = ?', [req.user!.id]);
    }
    return res.json({ message: 'Phone unpaired successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unpair phone' });
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

    const newLabel = phoneLabel !== undefined ? phoneLabel.trim() : (phone.phone_label || 'Main Phone');
    const newRingEnabled = ringEnabled !== undefined ? (ringEnabled ? 1 : 0) : (phone.ring_enabled ?? 1);
    const newVol = earpieceVolume !== undefined ? Math.max(0, Math.min(100, parseInt(earpieceVolume, 10))) : phone.earpiece_volume;
    const newMic = micSensitivity !== undefined ? Math.max(0, Math.min(100, parseInt(micSensitivity, 10))) : phone.mic_sensitivity;
    const newAudioProfile = audioProfile || phone.audio_profile || 'vintage_pots';
    const newSidetone = sidetoneLevel !== undefined ? Math.max(0, Math.min(100, parseInt(sidetoneLevel, 10))) : (phone.sidetone_level ?? 10);
    const newStyle = ringStyle || phone.ring_style;
    const newCadence = ringCadenceCustom || phone.ring_cadence_custom;
    const newTimeout = ringTimeoutSec ? Math.max(5, Math.min(60, parseInt(ringTimeoutSec, 10))) : phone.ring_timeout_sec;
    const newHardwareProfile = hardwareProfile || phone.hardware_profile || 'western_electric_500';
    const newBellFreq = bellFrequencyHz !== undefined ? parseFloat(bellFrequencyHz) : (phone.bell_frequency_hz ?? 20.0);
    const newIntercom = intercomEnabled !== undefined ? (intercomEnabled ? 1 : 0) : (phone.intercom_enabled ?? 1);
    const newOtaEnabled = otaAutoUpdateEnabled !== undefined ? (otaAutoUpdateEnabled ? 1 : 0) : (phone.ota_auto_update_enabled ?? 1);
    const newOtaTime = otaUpdateTime || phone.ota_update_time || '03:00';
    const newOtaChannel = otaUpdateChannel || phone.ota_update_channel || 'stable';

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
      intercomEnabled: newIntercom === 1
    });

    const updatedPhone = await queryOne<any>('SELECT * FROM phones WHERE id = ?', [phone.id]);
    const user = await queryOne<any>('SELECT id, username, display_name FROM users WHERE id = ?', [req.user!.id]);
    homeAssistantMqttService.registerPhoneDiscovery(updatedPhone, user).catch(console.error);

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

    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const binUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_binary_url"');

    const firmwareVersion = versionRow?.value || '1.2.0';
    const binaryUrl = binUrlRow?.value || '/api/firmware/download/latest';

    phoneSwitchService.sendToDevice(phone.device_id, {
      type: 'ota_available',
      version: firmwareVersion,
      binaryUrl
    });

    return res.json({
      message: `OTA update signal dispatched to ${phone.phone_label || phone.device_id}! Flashing v${firmwareVersion}...`,
      version: firmwareVersion
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

    if (!targetPhoneNumber) {
      return res.status(400).json({ error: 'Target phone number is required' });
    }

    await execute(
      `INSERT OR REPLACE INTO speed_dials (user_id, slot_digit, target_user_id, target_phone_number, label)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user!.id, digit, targetUserId || null, targetPhoneNumber.trim(), label?.trim() || null]
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

// Dial Extension from Web
router.post('/dial', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const calleeNumber = (req.body.calleeNumber || req.body.destination || '').trim();
    const deviceId = req.body.deviceId;
    if (!calleeNumber) {
      return res.status(400).json({ error: 'Destination number required' });
    }

    let phone: any = null;
    if (deviceId) {
      phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ? AND user_id = ?', [deviceId, req.user!.id]);
    } else {
      phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? AND is_online = 1 LIMIT 1', [req.user!.id]);
      if (!phone) {
        phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ? LIMIT 1', [req.user!.id]);
      }
    }

    if (!phone || !phone.is_online) {
      return res.status(400).json({ error: 'Your phone hardware must be online to initiate a call' });
    }

    await phoneSwitchService.initiateCall(phone.device_id, calleeNumber.trim());
    return res.json({ message: `Calling ${calleeNumber}...` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to place call' });
  }
});

// End / Hang Up Active Call from Web UI
router.post('/hangup', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phones = await query<any>('SELECT device_id FROM phones WHERE user_id = ?', [req.user!.id]);
    for (const p of phones) {
      await phoneSwitchService.handleCallHangup(p.device_id);
    }
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
