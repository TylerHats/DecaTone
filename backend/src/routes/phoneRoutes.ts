import { Router, Request, Response } from 'express';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { phoneSwitchService } from '../services/phoneSwitchService';

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

// Claim / Pair an ESP32-S3 Device by Word + Number Pairing Code
router.post('/claim-by-code', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { wordPrefix, numericCode, pairingCode } = req.body;
    let targetCode = '';

    if (pairingCode) {
      targetCode = pairingCode.trim().toUpperCase();
    } else if (wordPrefix && numericCode) {
      targetCode = `${wordPrefix.trim().toUpperCase()} ${numericCode.trim()}`;
    } else {
      return res.status(400).json({ error: 'Word and numeric code are required' });
    }

    const pending = await queryOne<any>(
      'SELECT * FROM pending_device_enrollments WHERE pairing_code = ? AND expires_at > datetime("now")',
      [targetCode]
    );

    if (!pending) {
      return res.status(404).json({ error: 'Invalid or expired pairing code. Check the code spoken on your handset.' });
    }

    const cleanDeviceId = pending.device_id;

    // Check if current user already has another phone paired
    await execute('UPDATE phones SET user_id = NULL WHERE user_id = ?', [req.user!.id]);

    // Assign phone to this user
    await execute(
      'UPDATE phones SET user_id = ?, paired_at = CURRENT_TIMESTAMP WHERE device_id = ?',
      [req.user!.id, cleanDeviceId]
    );

    // Delete pending enrollment entry
    await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [cleanDeviceId]);

    const phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);

    phoneSwitchService.pushDeviceSettings(cleanDeviceId, {
      earpieceVolume: phone?.earpiece_volume || 80,
      micSensitivity: phone?.mic_sensitivity || 80,
      ringStyle: phone?.ring_style || 'traditional',
      ringCadence: phone?.ring_cadence_custom || '2000,4000'
    });

    return res.json({
      message: 'Telephone paired successfully to your account!',
      phone: {
        deviceId: cleanDeviceId,
        isOnline: !!phone?.is_online,
        firmwareVersion: phone?.firmware_version || '1.2.0',
        hardwareProfile: phone?.hardware_profile || 'western_electric_500'
      }
    });
  } catch (err: any) {
    console.error('Claim by code error:', err);
    return res.status(500).json({ error: 'Failed to pair phone by code' });
  }
});

// Bell Frequency Resonance Sweep Calibration
router.post('/resonance-sweep', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { frequencyHz, durationMs } = req.body;
    const phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const freq = parseFloat(frequencyHz) || 20.0;
    const dur = parseInt(durationMs, 10) || 3000;

    // Push sweep frequency and trigger test ring
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

// Legacy Claim / Pair by Device ID
router.post('/claim', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const cleanDeviceId = deviceId.trim().toUpperCase();

    // Check if phone exists in DB (reported by ESP32-S3 on boot)
    let phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [cleanDeviceId]);

    if (!phone) {
      // Allow pre-claiming: create device entry in DB waiting for hardware check-in
      await execute(
        'INSERT INTO phones (device_id, user_id, paired_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [cleanDeviceId, req.user!.id]
      );
    } else {
      if (phone.user_id && phone.user_id !== req.user!.id) {
        return res.status(400).json({ error: 'This phone is already registered to another user' });
      }

      // Check if current user already has another phone paired
      await execute('UPDATE phones SET user_id = NULL WHERE user_id = ?', [req.user!.id]);

      // Assign to this user
      await execute(
        'UPDATE phones SET user_id = ?, paired_at = CURRENT_TIMESTAMP WHERE device_id = ?',
        [req.user!.id, cleanDeviceId]
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

    return res.json({
      message: 'Phone paired successfully!',
      phone: {
        deviceId: cleanDeviceId,
        isOnline: !!phone?.is_online,
        firmwareVersion: phone?.firmware_version || '1.2.0'
      }
    });
  } catch (err: any) {
    console.error('Claim phone error:', err);
    return res.status(500).json({ error: 'Failed to pair phone' });
  }
});

// Unpair Phone
router.post('/unclaim', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await execute('UPDATE phones SET user_id = NULL WHERE user_id = ?', [req.user!.id]);
    return res.json({ message: 'Phone unpaired successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unpair phone' });
  }
});

// Get Phone Hardware Settings
router.get('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    return res.json({
      deviceId: phone.device_id,
      earpieceVolume: phone.earpiece_volume ?? 80,
      micSensitivity: phone.mic_sensitivity ?? 80,
      audioProfile: phone.audio_profile || 'vintage_pots',
      sidetoneLevel: phone.sidetone_level ?? 10,
      ringStyle: phone.ring_style || 'traditional',
      ringCadenceCustom: phone.ring_cadence_custom || '2000,4000',
      ringTimeoutSec: phone.ring_timeout_sec || 25,
      hardwareProfile: phone.hardware_profile || 'western_electric_500',
      bellFrequencyHz: phone.bell_frequency_hz ?? 20.0,
      hookFlashEnabled: phone.hook_flash_enabled !== 0,
      intercomEnabled: phone.intercom_enabled !== 0,
      isOnline: !!phone.is_online,
      hookState: phone.hook_state,
      callState: phone.call_state,
      firmwareVersion: phone.firmware_version,
      rssi: phone.rssi,
      ipAddress: phone.ip_address,
      lastSeen: phone.last_seen
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch phone settings' });
  }
});

// Update Phone Hardware Settings
router.put('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      earpieceVolume,
      micSensitivity,
      audioProfile,
      sidetoneLevel,
      ringStyle,
      ringCadenceCustom,
      ringTimeoutSec,
      hardwareProfile,
      bellFrequencyHz,
      hookFlashEnabled,
      intercomEnabled
    } = req.body;

    const phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const newVol = earpieceVolume !== undefined ? Math.max(0, Math.min(100, parseInt(earpieceVolume, 10))) : phone.earpiece_volume;
    const newMic = micSensitivity !== undefined ? Math.max(0, Math.min(100, parseInt(micSensitivity, 10))) : phone.mic_sensitivity;
    const newAudioProfile = audioProfile || phone.audio_profile || 'vintage_pots';
    const newSidetone = sidetoneLevel !== undefined ? Math.max(0, Math.min(100, parseInt(sidetoneLevel, 10))) : (phone.sidetone_level ?? 10);
    const newStyle = ringStyle || phone.ring_style;
    const newCadence = ringCadenceCustom || phone.ring_cadence_custom;
    const newTimeout = ringTimeoutSec ? Math.max(5, Math.min(60, parseInt(ringTimeoutSec, 10))) : phone.ring_timeout_sec;
    const newHardwareProfile = hardwareProfile || phone.hardware_profile || 'western_electric_500';
    const newBellFreq = bellFrequencyHz !== undefined ? parseFloat(bellFrequencyHz) : (phone.bell_frequency_hz ?? 20.0);
    const newHookFlash = hookFlashEnabled !== undefined ? (hookFlashEnabled ? 1 : 0) : (phone.hook_flash_enabled ?? 1);
    const newIntercom = intercomEnabled !== undefined ? (intercomEnabled ? 1 : 0) : (phone.intercom_enabled ?? 1);

    await execute(
      `UPDATE phones SET
        earpiece_volume = ?,
        mic_sensitivity = ?,
        audio_profile = ?,
        sidetone_level = ?,
        ring_style = ?,
        ring_cadence_custom = ?,
        ring_timeout_sec = ?,
        hardware_profile = ?,
        bell_frequency_hz = ?,
        hook_flash_enabled = ?,
        intercom_enabled = ?
       WHERE id = ?`,
      [
        newVol,
        newMic,
        newAudioProfile,
        newSidetone,
        newStyle,
        newCadence,
        newTimeout,
        newHardwareProfile,
        newBellFreq,
        newHookFlash,
        newIntercom,
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
      hookFlashEnabled: newHookFlash === 1,
      intercomEnabled: newIntercom === 1
    });

    return res.json({ message: 'Hardware and audio DSP settings saved and synced to your phone!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update phone settings' });
  }
});

// Trigger Remote Test Ring
router.post('/test-ring', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const sent = phoneSwitchService.sendTestRing(phone.device_id, phone.ring_style, phone.ring_cadence_custom);
    if (!sent) {
      return res.status(400).json({ error: 'Phone is currently offline. Please check its WiFi connection.' });
    }

    return res.json({ message: 'Test ring sent! Your rotary bell should ring now.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send test ring' });
  }
});

// Trigger Remote Reboot
router.post('/reboot', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    if (!phone) {
      return res.status(404).json({ error: 'No phone paired to this account' });
    }

    const sent = phoneSwitchService.sendRemoteReboot(phone.device_id);
    if (!sent) {
      return res.status(400).json({ error: 'Phone is currently offline' });
    }

    return res.json({ message: 'Reboot command sent to ESP32-S3' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reboot phone' });
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
    const { calleeNumber } = req.body;
    if (!calleeNumber) {
      return res.status(400).json({ error: 'Destination number required' });
    }

    const phone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [req.user!.id]);
    if (!phone || !phone.is_online) {
      return res.status(400).json({ error: 'Your phone hardware must be online to initiate a call' });
    }

    await phoneSwitchService.initiateCall(phone.device_id, calleeNumber.trim());
    return res.json({ message: `Calling ${calleeNumber}...` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to place call' });
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
