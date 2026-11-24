import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '../db/connection';
import {
  getSessionCookieOptions,
  isValidP256UncompressedPublicKey,
  signUserJwt
} from '../middleware/authMiddleware';
import { createRateLimiter } from '../middleware/rateLimit';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';
import { isReservedNumberOrPrefix } from '../services/phoneAllocationService';
import { TtsAudioService, TtsEngineType } from '../services/ttsAudioService';
import { tlsManagerService, TlsMode } from '../services/tlsManagerService';

const router = Router();

const setupRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many setup initialization attempts. Please wait 15 minutes.'
});

const setupTtsLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many setup voice preview requests. Please wait a moment.'
});

const OOBE_SAMPLE_PHRASE = 'Welcome to DecaTone. Your vintage rotary telephone switchboard is ready.';

async function isSystemInitialized(): Promise<boolean> {
  const userCountRow = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  return (userCountRow?.count || 0) > 0;
}

// Check if initial setup is required
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const initialized = await isSystemInitialized();
    const tts = await TtsAudioService.getTtsStatus();
    return res.json({
      setupRequired: !initialized,
      initialized,
      ttsEngine: tts.configuredEngine,
      ttsVoice: tts.selectedVoice
    });
  } catch {
    return res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// OOBE Pre-Setup TTS Voice Catalog & Download Progress (disabled once initialized)
router.get('/tts/status', async (_req: Request, res: Response) => {
  try {
    if (await isSystemInitialized()) {
      return res.status(403).json({ error: 'System is already initialized' });
    }
    const status = await TtsAudioService.getTtsStatus();
    return res.json(status);
  } catch {
    return res.status(500).json({ error: 'Failed to read TTS status' });
  }
});

// OOBE Pre-Setup On-Demand Model Download (Piper or Kokoro)
router.post('/tts/download', setupTtsLimiter, async (req: Request, res: Response) => {
  try {
    if (await isSystemInitialized()) {
      return res.status(403).json({ error: 'System is already initialized' });
    }
    const { engine, voiceId } = req.body || {};
    const result = TtsAudioService.startEngineOrVoiceDownload({ engine, voiceId });
    const status = await TtsAudioService.getTtsStatus();
    return res.status(result.started ? 202 : 200).json({ ...result, ...status });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Failed to start TTS download' });
  }
});

// OOBE Pre-Setup Live TTS Preview (fixed safe sample phrase only; disabled once initialized)
router.post('/tts/preview', setupTtsLimiter, async (req: Request, res: Response) => {
  try {
    if (await isSystemInitialized()) {
      return res.status(403).json({ error: 'System is already initialized' });
    }
    const rawVoice = req.body?.voiceId ? String(req.body.voiceId).trim() : undefined;
    const rawEngine = req.body?.engine ? String(req.body.engine).trim().toLowerCase() : undefined;
    const overrideEngine =
      rawEngine && ['piper', 'kokoro', 'espeak', 'procedural'].includes(rawEngine)
        ? (rawEngine as TtsEngineType)
        : undefined;

    const wavBuffer = await TtsAudioService.synthesizeWav(OOBE_SAMPLE_PHRASE, rawVoice, {
      overrideEngine,
      cache: false
    });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', wavBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(wavBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to synthesize voice preview' });
  }
});

// Initialize system with first Master Admin account, dial plan, TTS choice, TLS mode, and E2EE + Recovery key bundles
router.post('/initialize', setupRateLimiter, async (req: Request, res: Response) => {
  try {
    if (await isSystemInitialized()) {
      return res.status(400).json({ error: 'System is already initialized' });
    }

    const {
      username,
      password,
      displayName,
      appName,
      phoneNumberLength,
      phoneNumberMinLength,
      phoneNumberMaxLength,
      assignmentMode,
      numberAssignmentMode,
      adminPhoneNumber,
      adminExtension,
      encryptionPublicKey: clientPubKey,
      encryptedPrivateKey: clientEncPrivKey,
      keySalt: clientKeySalt,
      recoveryEncryptedPrivateKey: clientRecEncPrivKey,
      recoveryKeySalt: clientRecSalt,
      acknowledgedE911,
      agreedToTerms,
      ttsEngine,
      ttsVoice,
      tlsMode,
      trustProxy,
      acmeDomain,
      acmeEmail,
      acmeStaging,
      localCaHosts
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (String(username).trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (acknowledgedE911 !== true) {
      return res.status(400).json({ error: 'You must explicitly acknowledge that DecaTone does not support E911/112/999 emergency calling' });
    }

    const minLen = parseInt(String(phoneNumberMinLength ?? phoneNumberLength ?? '4'), 10);
    const maxLen = parseInt(String(phoneNumberMaxLength ?? phoneNumberMinLength ?? phoneNumberLength ?? '4'), 10);

    if (isNaN(minLen) || isNaN(maxLen) || minLen < 2 || maxLen > 15 || minLen > maxLen) {
      return res.status(400).json({ error: 'Invalid phone number length bounds (must satisfy 2 <= minLength <= maxLength <= 15)' });
    }

    const modeRaw = String(numberAssignmentMode || assignmentMode || 'user_choice');
    const validMode = ['user_choice', 'fixed_random', 'sequential'].includes(modeRaw) ? modeRaw : 'user_choice';

    // Validate E2EE Key Bundle
    let encryptionPublicKey: string;
    let encryptedPrivateKey: string;
    let keySalt: string;

    if (clientPubKey || clientEncPrivKey || clientKeySalt) {
      if (!isValidP256UncompressedPublicKey(clientPubKey) || !clientEncPrivKey || !clientKeySalt) {
        return res.status(400).json({ error: 'Invalid P-256 encryption key bundle format' });
      }
      encryptionPublicKey = String(clientPubKey).trim();
      encryptedPrivateKey = String(clientEncPrivKey).trim();
      keySalt = String(clientKeySalt).trim();
    } else {
      const generated = await VoicemailCryptoService.generateUserKeyBundle(password);
      encryptionPublicKey = generated.encryptionPublicKey;
      encryptedPrivateKey = generated.encryptedPrivateKey;
      keySalt = generated.keySalt;
    }

    const recoveryEncPrivKey = clientRecEncPrivKey && clientRecSalt ? String(clientRecEncPrivKey).trim() : null;
    const recoverySalt = clientRecEncPrivKey && clientRecSalt ? String(clientRecSalt).trim() : null;

    // Save System Settings
    if (appName && String(appName).trim()) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['app_name', String(appName).trim()]);
    }
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_length', String(minLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_min_length', String(minLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_max_length', String(maxLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['number_assignment_mode', validMode]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['allow_user_number_choice', validMode === 'user_choice' ? 'true' : 'false']);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['installed_version', '1.3.0']);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', '1.3.0']);

    if (ttsEngine || ttsVoice) {
      try {
        await TtsAudioService.setPreferredConfig({ engine: ttsEngine, voiceId: ttsVoice });
      } catch {}
    }

    let tlsStatus: any = null;
    if (tlsMode || trustProxy !== undefined || acmeDomain || localCaHosts) {
      const safeTlsMode: TlsMode | undefined =
        tlsMode === 'acme' || tlsMode === 'local_ca' || tlsMode === 'proxy' ? tlsMode : undefined;
      try {
        tlsStatus = await tlsManagerService.updateConfig({
          mode: safeTlsMode,
          trustProxy,
          acmeDomain,
          acmeEmail,
          acmeStaging: Boolean(acmeStaging),
          localCaHosts
        });
      } catch (tlsErr: any) {
        console.warn('[Setup] Deferred TLS configuration error:', tlsErr?.message);
      }
    }

    // Determine initial master extension number
    let initialExt = String(adminPhoneNumber || adminExtension || '').trim();
    if (!initialExt || initialExt.length < minLen || initialExt.length > maxLen || isReservedNumberOrPrefix(initialExt)) {
      initialExt = '1' + '0'.repeat(Math.max(1, minLen - 1));
      if (isReservedNumberOrPrefix(initialExt)) {
        initialExt = '2' + '0'.repeat(Math.max(1, minLen - 1));
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const termsVersionRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['terms_version']);
    const termsVersion = termsVersionRow?.value || '2026.11';

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanDisplayName = displayName?.trim() || 'System Administrator';

    const result = await execute(
      `INSERT INTO users (
        username, password_hash, display_name, phone_number, role, is_disabled,
        key_salt, encryption_public_key, encrypted_private_key,
        recovery_encrypted_private_key, recovery_key_salt,
        token_version, terms_accepted_at, terms_version, e911_acknowledged_at
      ) VALUES (?, ?, ?, ?, 'admin', 0, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
      [
        cleanUsername,
        passwordHash,
        cleanDisplayName,
        initialExt,
        keySalt,
        encryptionPublicKey,
        encryptedPrivateKey,
        recoveryEncPrivKey,
        recoverySalt,
        agreedToTerms === false ? null : termsVersion
      ]
    );

    const userId = result.lastID;
    const token = signUserJwt({
      id: userId,
      username: cleanUsername,
      role: 'admin',
      token_version: 1
    });

    res.cookie('token', token, getSessionCookieOptions(req));

    const user = {
      id: userId,
      username: cleanUsername,
      displayName: cleanDisplayName,
      display_name: cleanDisplayName,
      phoneNumber: initialExt,
      phone_number: initialExt,
      role: 'admin',
      keySalt,
      encryptionPublicKey,
      encryptedPrivateKey,
      hasRecoveryKey: Boolean(recoveryEncPrivKey),
      termsVersion,
      currentTermsVersion: termsVersion,
      termsAcceptedVersion: termsVersion,
      unreadVoicemails: 0
    };

    console.log(`[Setup] 🎉 DecaTone system initialized! Master Admin created: @${user.username} (Ext: ${initialExt})`);
    return res.json({
      message: 'System successfully initialized',
      token,
      user,
      tlsStatus
    });
  } catch (err: any) {
    console.error('[Setup] Initialize error:', err);
    return res.status(500).json({ error: err.message || 'Setup initialization failed' });
  }
});

export default router;
