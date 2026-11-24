import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execute, query, queryOne } from '../db/connection';
import {
  authenticateToken,
  AuthenticatedRequest,
  getSessionCookieOptions,
  isValidP256UncompressedPublicKey,
  signUserJwt
} from '../middleware/authMiddleware';
import { createRateLimiter } from '../middleware/rateLimit';
import { getSafePublicBaseUrl } from '../config/secrets';
import { GREETINGS_DIR, VOICEMAILS_DIR } from '../config/paths';
import { getPhoneConfig, isNumberAvailable, generateAvailableNumber, validateChosenNumber } from '../services/phoneAllocationService';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';
import { EmailService } from '../services/emailService';
import { phoneSwitchService } from '../services/phoneSwitchService';

const router = Router();

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts from this IP. Please try again in 15 minutes.'
});

const registerLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many registration attempts from this IP. Please try again in 15 minutes.'
});

const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password reset requests from this IP. Please try again in 15 minutes.'
});

const resetVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many reset verification attempts from this IP. Please try again later.'
});

const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password reset attempts from this IP. Please try again in 15 minutes.'
});

function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie('token', token, getSessionCookieOptions(req));
}

// Get phone numbering options for registration or profile change
router.get('/number-options', async (_req: Request, res: Response) => {
  try {
    const config = await getPhoneConfig();
    const sampleAvailable = await generateAvailableNumber(config);
    return res.json({
      config,
      suggestedNumber: sampleAvailable.phoneNumber,
      suggestedAreaCode: sampleAvailable.areaCode
    });
  } catch {
    return res.status(500).json({ error: 'Failed to retrieve phone number options' });
  }
});

// User Registration
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const {
      username,
      password,
      displayName,
      email,
      requestedPhoneNumber,
      requestedAreaCode,
      agreedToTerms,
      acknowledgedE911,
      encryptionPublicKey: clientPubKey,
      encryptedPrivateKey: clientEncPrivKey,
      keySalt: clientKeySalt,
      recoveryEncryptedPrivateKey: clientRecEncPrivKey,
      recoveryKeySalt: clientRecSalt
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = String(username).trim();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const requireTermsRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['require_terms_on_signup']
    );
    const requireTerms = requireTermsRow?.value !== 'false';

    if (requireTerms && agreedToTerms !== true) {
      return res.status(400).json({
        error: 'You must accept the Terms of Service and Privacy Policy to create an account'
      });
    }

    if (acknowledgedE911 !== true) {
      return res.status(400).json({
        error: 'You must explicitly acknowledge that DecaTone does NOT provide 911 / 112 / 999 emergency calling'
      });
    }

    const existingUser = await queryOne('SELECT id FROM users WHERE username = ?', [cleanUsername]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const cleanEmail = email?.trim() || null;
    if (cleanEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Invalid email address format' });
      }
      const existingEmail = await queryOne('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existingEmail) {
        return res.status(400).json({ error: 'An account with this email address already exists' });
      }
    }

    const config = await getPhoneConfig();
    let assignedNumber = requestedPhoneNumber?.trim();
    let assignedAreaCode = requestedAreaCode?.trim();

    if (assignedNumber && config.allowUserChoice) {
      const validation = validateChosenNumber(assignedNumber, config);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      const available = await isNumberAvailable(assignedNumber, config.areaCodeEnabled ? assignedAreaCode : null);
      if (!available) {
        return res.status(400).json({ error: `Phone number ${assignedNumber} is already in use or reserved` });
      }
    } else {
      const allocated = await generateAvailableNumber(config, assignedAreaCode);
      assignedNumber = allocated.phoneNumber;
      assignedAreaCode = allocated.areaCode;
    }

    const passwordHash = await bcrypt.hash(password, 10);

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

    const termsVersionRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['terms_version']
    );
    const termsVersion = termsVersionRow?.value || '2026.11';
    const acceptedNow = new Date().toISOString();

    const result = await execute(
      `INSERT INTO users (
        username, password_hash, display_name, email, phone_number, area_code, role,
        key_salt, encryption_public_key, encrypted_private_key,
        recovery_encrypted_private_key, recovery_key_salt,
        token_version, terms_accepted_at, terms_version, e911_acknowledged_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'admin' ELSE 'user' END,
        ?, ?, ?, ?, ?, 1, ?, ?, ?
      )`,
      [
        cleanUsername,
        passwordHash,
        displayName?.trim() || cleanUsername,
        cleanEmail,
        assignedNumber,
        assignedAreaCode || null,
        keySalt,
        encryptionPublicKey,
        encryptedPrivateKey,
        recoveryEncPrivKey,
        recoverySalt,
        agreedToTerms === true ? acceptedNow : null,
        agreedToTerms === true ? termsVersion : null,
        acceptedNow
      ]
    );

    const userId = result.lastID;
    const insertedRow = await queryOne<{ role: string }>('SELECT role FROM users WHERE id = ?', [userId]);
    const role = insertedRow?.role || 'user';

    const token = signUserJwt({ id: userId, username: cleanUsername, role, token_version: 1 });
    setSessionCookie(req, res, token);

    const createdUser = {
      id: userId,
      username: cleanUsername,
      displayName: displayName?.trim() || cleanUsername,
      email: cleanEmail,
      phoneNumber: assignedNumber,
      areaCode: assignedAreaCode || null,
      role,
      keySalt,
      encryptionPublicKey,
      encryptedPrivateKey,
      hasRecoveryKey: Boolean(recoveryEncPrivKey),
      termsVersion,
      currentTermsVersion: termsVersion,
      termsAcceptedVersion: agreedToTerms === true ? termsVersion : null,
      e911AcknowledgedAt: acceptedNow,
      unreadVoicemails: 0
    };

    if (cleanEmail) {
      getSafePublicBaseUrl(req)
        .then(baseUrl => EmailService.sendWelcomeEmail(cleanEmail, createdUser, baseUrl))
        .catch(e => console.error(e));
    }

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: createdUser
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: `Registration failed: ${err.message}` });
  }
});

// Self-Service Forgot Password: Request Reset Email (constant-latency async email dispatch)
router.post('/forgot-password', forgotPasswordLimiter, async (req: Request, res: Response) => {
  try {
    const { usernameOrEmail } = req.body;
    if (!usernameOrEmail) {
      return res.status(400).json({ error: 'Username or email address is required' });
    }

    const queryStr = String(usernameOrEmail).trim();
    const user = await queryOne<any>(
      'SELECT id, username, email, display_name FROM users WHERE username = ? OR email = ?',
      [queryStr, queryStr]
    );

    if (user && user.email) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await execute(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt]
      );

      getSafePublicBaseUrl(req)
        .then((baseUrl) => EmailService.sendPasswordResetEmail(user.email, user.username, resetToken, baseUrl))
        .catch((err) => console.error('[Forgot Password Email Error]:', err));
    }

    return res.json({
      message: 'If an account exists with that username or email address, a password reset link has been dispatched.'
    });
  } catch (err: any) {
    console.error('[Forgot Password Error]:', err);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Verify Password Reset Token (returns optional encrypted recovery key bundle if set)
router.get('/verify-reset-token', resetVerifyLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    const resetRow = await queryOne<any>(
      `SELECT pr.*, u.username, u.encryption_public_key, u.recovery_encrypted_private_key, u.recovery_key_salt
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token = ? AND pr.used_at IS NULL AND datetime(pr.expires_at) > datetime('now')`,
      [token]
    );

    if (!resetRow) {
      return res.status(400).json({ error: 'Invalid or expired password reset link' });
    }

    return res.json({
      valid: true,
      username: resetRow.username,
      hasRecoveryKey: Boolean(resetRow.recovery_encrypted_private_key),
      encryptionPublicKey: resetRow.encryption_public_key || null,
      recoveryEncryptedPrivateKey: resetRow.recovery_encrypted_private_key || null,
      recoveryKeySalt: resetRow.recovery_key_salt || null
    });
  } catch {
    return res.status(500).json({ error: 'Failed to verify reset token' });
  }
});

// Execute Password Reset (revokes old sessions via token_version; clears orphaned wrapped_vm_key if keypair rotated)
router.post('/reset-password', resetPasswordLimiter, async (req: Request, res: Response) => {
  try {
    const {
      token,
      newPassword,
      encryptionPublicKey: clientPubKey,
      encryptedPrivateKey: clientEncPrivKey,
      keySalt: clientKeySalt,
      recoveryEncryptedPrivateKey: clientRecEncPrivKey,
      recoveryKeySalt: clientRecSalt
    } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const resetRow = await queryOne<any>(
      `SELECT pr.*, u.id as user_id, u.encryption_public_key as current_pub_key,
              u.recovery_encrypted_private_key as current_rec_enc, u.recovery_key_salt as current_rec_salt
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token = ? AND pr.used_at IS NULL AND datetime(pr.expires_at) > datetime('now')`,
      [token]
    );

    if (!resetRow) {
      return res.status(400).json({ error: 'This password reset link is invalid or has expired' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

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
      const generated = await VoicemailCryptoService.generateUserKeyBundle(newPassword);
      encryptionPublicKey = generated.encryptionPublicKey;
      encryptedPrivateKey = generated.encryptedPrivateKey;
      keySalt = generated.keySalt;
    }

    const keypairChanged = resetRow.current_pub_key !== encryptionPublicKey;
    let nextRecEnc = resetRow.current_rec_enc || null;
    let nextRecSalt = resetRow.current_rec_salt || null;

    if (clientRecEncPrivKey && clientRecSalt) {
      nextRecEnc = String(clientRecEncPrivKey).trim();
      nextRecSalt = String(clientRecSalt).trim();
    } else if (keypairChanged) {
      // Old recovery bundle belonged to rotated keypair
      nextRecEnc = null;
      nextRecSalt = null;
    }

    await execute(
      `UPDATE users
       SET password_hash = ?,
           token_version = COALESCE(token_version, 1) + 1,
           encryption_public_key = ?,
           encrypted_private_key = ?,
           key_salt = ?,
           recovery_encrypted_private_key = ?,
           recovery_key_salt = ?
       WHERE id = ?`,
      [newHash, encryptionPublicKey, encryptedPrivateKey, keySalt, nextRecEnc, nextRecSalt, resetRow.user_id]
    );

    if (keypairChanged) {
      await execute('UPDATE phones SET wrapped_vm_key = NULL WHERE user_id = ?', [resetRow.user_id]);
    }

    await execute('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [resetRow.id]);

    return res.json({
      message: 'Password reset successfully! You can now sign in with your new password.',
      keypairRotated: keypairChanged
    });
  } catch (err: any) {
    console.error('[Reset Password Error]:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// User Login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await queryOne<any>(
      `SELECT id, username, password_hash, display_name, email, phone_number, area_code, role,
              is_disabled, disabled_reason, key_salt, encryption_public_key, encrypted_private_key,
              recovery_encrypted_private_key,
              COALESCE(token_version, 1) as token_version, terms_version, e911_acknowledged_at
       FROM users WHERE username = ?`,
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.is_disabled) {
      return res.status(403).json({ error: user.disabled_reason || 'This account has been disabled by an administrator' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    let keySalt = user.key_salt;
    let encryptionPublicKey = user.encryption_public_key;
    let encryptedPrivateKey = user.encrypted_private_key;

    if (!encryptionPublicKey || !encryptedPrivateKey || !keySalt) {
      const generated = await VoicemailCryptoService.generateUserKeyBundle(password);
      encryptionPublicKey = generated.encryptionPublicKey;
      encryptedPrivateKey = generated.encryptedPrivateKey;
      keySalt = generated.keySalt;
      await execute(
        'UPDATE users SET encryption_public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?',
        [encryptionPublicKey, encryptedPrivateKey, keySalt, user.id]
      );
    }

    const unreadRow = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM voicemails WHERE user_id = ? AND is_read = 0',
      [user.id]
    );
    const termsVersionRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['terms_version']
    );

    const token = signUserJwt({
      id: user.id,
      username: user.username,
      role: user.role,
      token_version: user.token_version
    });
    setSessionCookie(req, res, token);

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        phoneNumber: user.phone_number,
        areaCode: user.area_code,
        role: user.role,
        keySalt,
        encryptionPublicKey,
        encryptedPrivateKey,
        hasRecoveryKey: Boolean(user.recovery_encrypted_private_key),
        unreadVoicemails: unreadRow?.count || 0,
        termsVersion: termsVersionRow?.value || '2026.11',
        currentTermsVersion: termsVersionRow?.value || '2026.11',
        termsAcceptedVersion: user.terms_version || null,
        e911AcknowledgedAt: user.e911_acknowledged_at || null
      }
    });
  } catch {
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Logout (clears HttpOnly session cookie)
router.post('/logout', (req: Request, res: Response) => {
  const opts = getSessionCookieOptions(req);
  res.clearCookie('token', {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite
  });
  return res.json({ message: 'Signed out successfully' });
});

// Current Authenticated User Info
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await queryOne<any>(
      `SELECT id, username, display_name as displayName, email, phone_number as phoneNumber, area_code as areaCode,
              role, call_privacy as callPrivacy, notify_on_voicemail as notifyOnVoicemail, notify_on_missed_call as notifyOnMissedCall,
              dnd_manual_state as dndManualState, dnd_schedule_enabled as dndScheduleEnabled,
              dnd_schedule_start as dndScheduleStart, dnd_schedule_end as dndScheduleEnd,
              dnd_schedule_days as dndScheduleDays, dnd_override_period as dndOverridePeriod,
              dnd_override_until as dndOverrideUntil,
              dnd_repeated_call_breakthrough as dndRepeatedCallBreakthrough,
              key_salt as keySalt, encryption_public_key as encryptionPublicKey,
              encrypted_private_key as encryptedPrivateKey,
              (recovery_encrypted_private_key IS NOT NULL AND recovery_encrypted_private_key != '') as hasRecoveryKey,
              terms_version as termsAcceptedVersion,
              e911_acknowledged_at as e911AcknowledgedAt
       FROM users WHERE id = ?`,
      [req.user!.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const unreadRow = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM voicemails WHERE user_id = ? AND is_read = 0',
      [req.user!.id]
    );
    const termsVersionRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['terms_version']
    );

    user.hasRecoveryKey = Boolean(user.hasRecoveryKey);
    user.unreadVoicemails = unreadRow?.count || 0;
    user.currentTermsVersion = termsVersionRow?.value || '2026.11';

    return res.json({ user });
  } catch {
    return res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// Accept Updated Terms of Service & E911 Acknowledgment
router.post('/accept-terms', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { acknowledgedE911 } = req.body || {};
    if (acknowledgedE911 !== true) {
      return res.status(400).json({ error: 'E911 acknowledgment is required' });
    }

    const termsVersionRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['terms_version']
    );
    const currentVersion = termsVersionRow?.value || '2026.11';

    await execute(
      `UPDATE users
       SET terms_accepted_at = CURRENT_TIMESTAMP,
           terms_version = ?,
           e911_acknowledged_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [currentVersion, req.user!.id]
    );

    return res.json({
      message: 'Terms of Service and E911 notice acknowledged',
      termsAcceptedVersion: currentVersion
    });
  } catch {
    return res.status(500).json({ error: 'Failed to record terms acceptance' });
  }
});

// Upload / Update User E2EE Public & Password-Wrapped Private Key Bundle
router.put('/encryption-keys', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      encryptionPublicKey,
      encryptedPrivateKey,
      keySalt,
      recoveryEncryptedPrivateKey,
      recoveryKeySalt
    } = req.body;
    if (!encryptionPublicKey || !encryptedPrivateKey || !keySalt) {
      return res.status(400).json({ error: 'encryptionPublicKey, encryptedPrivateKey, and keySalt are required' });
    }

    if (!isValidP256UncompressedPublicKey(encryptionPublicKey)) {
      return res.status(400).json({ error: 'Invalid P-256 uncompressed public key format' });
    }

    const existingUser = await queryOne<any>('SELECT encryption_public_key FROM users WHERE id = ?', [req.user!.id]);
    const keypairChanged = existingUser && existingUser.encryption_public_key !== String(encryptionPublicKey).trim();

    if (recoveryEncryptedPrivateKey && recoveryKeySalt) {
      await execute(
        `UPDATE users
         SET encryption_public_key = ?, encrypted_private_key = ?, key_salt = ?,
             recovery_encrypted_private_key = ?, recovery_key_salt = ?
         WHERE id = ?`,
        [
          String(encryptionPublicKey).trim(),
          String(encryptedPrivateKey).trim(),
          String(keySalt).trim(),
          String(recoveryEncryptedPrivateKey).trim(),
          String(recoveryKeySalt).trim(),
          req.user!.id
        ]
      );
    } else {
      await execute(
        'UPDATE users SET encryption_public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?',
        [String(encryptionPublicKey).trim(), String(encryptedPrivateKey).trim(), String(keySalt).trim(), req.user!.id]
      );
    }

    if (keypairChanged) {
      await execute('UPDATE phones SET wrapped_vm_key = NULL WHERE user_id = ?', [req.user!.id]);
    }

    return res.json({
      message: 'Encryption keys saved',
      encryptionPublicKey: String(encryptionPublicKey).trim(),
      keySalt: String(keySalt).trim()
    });
  } catch {
    return res.status(500).json({ error: 'Failed to update encryption keys' });
  }
});

// Save or Regenerate Account Voicemail Recovery Key Bundle
router.put('/recovery-key', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recoveryEncryptedPrivateKey, recoveryKeySalt } = req.body || {};
    if (!recoveryEncryptedPrivateKey || !recoveryKeySalt) {
      return res.status(400).json({ error: 'recoveryEncryptedPrivateKey and recoveryKeySalt are required' });
    }

    await execute(
      'UPDATE users SET recovery_encrypted_private_key = ?, recovery_key_salt = ? WHERE id = ?',
      [String(recoveryEncryptedPrivateKey).trim(), String(recoveryKeySalt).trim(), req.user!.id]
    );

    return res.json({
      message: 'Account Recovery Key saved! Store it safely to prevent losing voicemail access after a password reset.',
      hasRecoveryKey: true
    });
  } catch {
    return res.status(500).json({ error: 'Failed to save Recovery Key' });
  }
});

// Change Password (verifies currentPassword, increments token_version, re-wraps or saves key bundle, issues fresh JWT)
router.put('/change-password', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      currentPassword,
      newPassword,
      encryptedPrivateKey: clientEncPrivKey,
      keySalt: clientKeySalt,
      encryptionPublicKey: clientPubKey
    } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    if (clientPubKey && !isValidP256UncompressedPublicKey(clientPubKey)) {
      return res.status(400).json({ error: 'Invalid P-256 uncompressed public key format' });
    }

    const user = await queryOne<any>(
      `SELECT id, username, role, password_hash, key_salt, encryption_public_key, encrypted_private_key,
              COALESCE(token_version, 1) as token_version
       FROM users WHERE id = ?`,
      [req.user!.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const matches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    const nextTokenVersion = (user.token_version || 1) + 1;

    let encryptionPublicKey = user.encryption_public_key;
    let encryptedPrivateKey = user.encrypted_private_key;
    let keySalt = user.key_salt;

    if (clientEncPrivKey && clientKeySalt) {
      encryptedPrivateKey = String(clientEncPrivKey).trim();
      keySalt = String(clientKeySalt).trim();
      if (clientPubKey) encryptionPublicKey = String(clientPubKey).trim();
    } else if (user.encrypted_private_key && user.key_salt) {
      try {
        const unwrapped = await VoicemailCryptoService.unwrapUserKeyBundle(
          user.encrypted_private_key,
          user.key_salt,
          currentPassword
        );
        const freshSaltBuf = crypto.randomBytes(16);
        const freshSaltHex = freshSaltBuf.toString('hex');
        const wrapKey = await new Promise<Buffer>((resolve, reject) => {
          crypto.pbkdf2(
            Buffer.from(newPassword, 'utf8'),
            freshSaltBuf,
            VoicemailCryptoService.PBKDF2_ITERATIONS,
            32,
            'sha256',
            (err, dk) => (err ? reject(err) : resolve(dk))
          );
        });
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, iv);
        const ct = Buffer.concat([cipher.update(unwrapped.bundle96), cipher.final()]);
        const tag = cipher.getAuthTag();

        encryptedPrivateKey = Buffer.concat([iv, tag, ct]).toString('base64');
        keySalt = freshSaltHex;
        encryptionPublicKey = unwrapped.publicKey.toString('base64');

        unwrapped.d.fill(0);
        unwrapped.bundle96.fill(0);
        wrapKey.fill(0);
      } catch {
        const generated = await VoicemailCryptoService.generateUserKeyBundle(newPassword);
        encryptionPublicKey = generated.encryptionPublicKey;
        encryptedPrivateKey = generated.encryptedPrivateKey;
        keySalt = generated.keySalt;
      }
    } else {
      const generated = await VoicemailCryptoService.generateUserKeyBundle(newPassword);
      encryptionPublicKey = generated.encryptionPublicKey;
      encryptedPrivateKey = generated.encryptedPrivateKey;
      keySalt = generated.keySalt;
    }

    const keypairChanged = user.encryption_public_key !== encryptionPublicKey;

    await execute(
      `UPDATE users
       SET password_hash = ?,
           token_version = ?,
           encryption_public_key = ?,
           encrypted_private_key = ?,
           key_salt = ?
       WHERE id = ?`,
      [newPasswordHash, nextTokenVersion, encryptionPublicKey, encryptedPrivateKey, keySalt, user.id]
    );

    if (keypairChanged) {
      await execute('UPDATE phones SET wrapped_vm_key = NULL WHERE user_id = ?', [user.id]);
    }

    const token = signUserJwt({
      id: user.id,
      username: user.username,
      role: user.role,
      token_version: nextTokenVersion
    });
    setSessionCookie(req, res, token);

    return res.json({
      message: 'Password updated successfully. All other active sessions have been signed out.',
      token,
      keySalt,
      encryptionPublicKey,
      encryptedPrivateKey
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to change password' });
  }
});

// Update User Profile & DND Preferences
router.put('/profile', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      displayName,
      email,
      callPrivacy,
      notifyOnVoicemail,
      notifyOnMissedCall,
      dndManualState,
      dndScheduleEnabled,
      dndScheduleStart,
      dndScheduleEnd,
      dndScheduleDays,
      dndRepeatedCallBreakthrough
    } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (displayName !== undefined) {
      updates.push('display_name = ?');
      params.push(String(displayName).trim());
    }
    if (email !== undefined) {
      const cleanEmail = email ? String(email).trim() : null;
      if (cleanEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          return res.status(400).json({ error: 'Please provide a valid email address' });
        }
        const dup = await queryOne('SELECT id FROM users WHERE email = ? AND id != ?', [cleanEmail, req.user!.id]);
        if (dup) {
          return res.status(409).json({ error: 'That email address is already linked to another account' });
        }
      }
      updates.push('email = ?');
      params.push(cleanEmail);
    }
    if (callPrivacy !== undefined) {
      const normalizedPrivacy =
        callPrivacy === 'anyone' || callPrivacy === 'open' ? 'everyone' : String(callPrivacy);
      if (!['everyone', 'friends_only', 'dnd', 'closed'].includes(normalizedPrivacy)) {
        return res.status(400).json({ error: 'Invalid callPrivacy value' });
      }
      updates.push('call_privacy = ?');
      params.push(normalizedPrivacy);
    }
    if (notifyOnVoicemail !== undefined) {
      updates.push('notify_on_voicemail = ?');
      params.push(notifyOnVoicemail ? 1 : 0);
    }
    if (notifyOnMissedCall !== undefined) {
      updates.push('notify_on_missed_call = ?');
      params.push(notifyOnMissedCall ? 1 : 0);
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

    if (updates.length > 0) {
      params.push(req.user!.id);
      await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    return res.json({ message: 'Profile updated successfully' });
  } catch (err: any) {
    if (String(err?.message || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'That email address is already in use by another account' });
    }
    return res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
});

// Self-Service Account Data Export (GDPR / CCPA Portability)
router.get('/export-data', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const profile = await queryOne<any>(
      `SELECT id, username, display_name, email, phone_number, area_code, role, call_privacy,
              notify_on_voicemail, notify_on_missed_call, dnd_manual_state, dnd_schedule_enabled,
              dnd_schedule_start, dnd_schedule_end, dnd_schedule_days, dnd_repeated_call_breakthrough,
              encryption_public_key, terms_accepted_at, terms_version, e911_acknowledged_at, created_at
       FROM users WHERE id = ?`,
      [userId]
    );

    const phones = await query<any>(
      `SELECT id, device_id, phone_label, hardware_profile, audio_profile, ring_style, ring_cadence_custom,
              bell_frequency_hz, earpiece_volume, mic_sensitivity, sidetone_level, intercom_enabled,
              call_forwarding_enabled, forward_to_number, firmware_version, last_seen, paired_at
       FROM phones WHERE user_id = ?`,
      [userId]
    );

    const friends = await query<any>(
      `SELECT u.id as friend_id, u.username, u.display_name, u.phone_number,
              COALESCE(fp.is_vip, 0) as is_vip, COALESCE(fp.ring_style, 'default') as ring_style,
              fp.ring_cadence_custom, f.created_at
       FROM friends f
       JOIN users u ON (u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
       LEFT JOIN friend_preferences fp ON fp.user_id = ? AND fp.friend_id = u.id
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'`,
      [userId, userId, userId, userId]
    );

    const speedDials = await query<any>(
      'SELECT slot_digit, target_phone_number, label FROM speed_dials WHERE user_id = ? ORDER BY slot_digit ASC',
      [userId]
    );

    const callHistory = await query<any>(
      `SELECT id, caller_number, callee_number, status, duration_sec, started_at, ended_at
       FROM calls WHERE caller_user_id = ? OR callee_user_id = ? ORDER BY id DESC`,
      [userId, userId]
    );

    const voicemails = await query<any>(
      `SELECT id, caller_number, duration_sec, is_read, is_encrypted, ephemeral_public_key, created_at
       FROM voicemails WHERE user_id = ? ORDER BY id DESC`,
      [userId]
    );

    res.setHeader('Content-Disposition', `attachment; filename="decatone-export-${profile?.username || userId}.json"`);
    return res.json({
      exportedAt: new Date().toISOString(),
      profile,
      phones,
      friends,
      speedDials,
      callHistory,
      voicemails
    });
  } catch {
    return res.status(500).json({ error: 'Failed to export account data' });
  }
});

// Self-Service Account Deletion
router.delete('/account', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({ error: 'Password confirmation is required to delete your account' });
    }

    const user = await queryOne<any>('SELECT id, role, password_hash FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    if (user.role === 'admin') {
      const adminCount = await queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND id != ?",
        [userId]
      );
      if ((adminCount?.count || 0) === 0) {
        return res.status(400).json({
          error: 'Cannot delete the sole system administrator account. Promote another administrator first or use System Wipe.'
        });
      }
    }

    await phoneSwitchService.hangupAllForUser(userId);

    const vms = await query<any>('SELECT audio_url FROM voicemails WHERE user_id = ?', [userId]);
    for (const vm of vms) {
      if (vm.audio_url && !String(vm.audio_url).startsWith('data:')) {
        const vmFile = path.join(VOICEMAILS_DIR, path.basename(vm.audio_url));
        try {
          if (fs.existsSync(vmFile)) fs.unlinkSync(vmFile);
        } catch {}
      }
    }

    const greeting = await queryOne<any>('SELECT audio_url FROM voicemail_greetings WHERE user_id = ?', [userId]);
    if (greeting?.audio_url && !String(greeting.audio_url).startsWith('data:')) {
      const greetFile = path.join(GREETINGS_DIR, path.basename(greeting.audio_url));
      try {
        if (fs.existsSync(greetFile)) fs.unlinkSync(greetFile);
      } catch {}
    }

    const pairedPhones = await query<any>('SELECT device_id FROM phones WHERE user_id = ?', [userId]);
    await execute(
      'UPDATE phones SET user_id = NULL, device_token_hash = NULL, wrapped_vm_key = NULL, call_forwarding_enabled = 0, forward_to_number = NULL WHERE user_id = ?',
      [userId]
    );
    for (const p of pairedPhones) {
      const cl = phoneSwitchService.getPhoneClient(p.device_id);
      if (cl) {
        cl.userId = undefined;
        cl.phoneNumber = undefined;
      }
    }

    await execute('DELETE FROM friend_preferences WHERE user_id = ? OR friend_id = ?', [userId, userId]);
    await execute('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [userId, userId]);
    await execute('DELETE FROM friend_requests WHERE sender_id = ? OR receiver_id = ?', [userId, userId]);
    await execute('DELETE FROM speed_dials WHERE user_id = ? OR target_user_id = ?', [userId, userId]);
    await execute('DELETE FROM voicemails WHERE user_id = ?', [userId]);
    await execute('DELETE FROM voicemail_greetings WHERE user_id = ?', [userId]);
    await execute('DELETE FROM password_resets WHERE user_id = ?', [userId]);
    await execute('DELETE FROM users WHERE id = ?', [userId]);

    const opts = getSessionCookieOptions(req);
    res.clearCookie('token', {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite
    });

    return res.json({ message: 'Your account and associated personal data have been permanently deleted.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete account' });
  }
});

export default router;
