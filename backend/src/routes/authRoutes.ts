import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { execute, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest, JWT_SECRET } from '../middleware/authMiddleware';
import { getPhoneConfig, isNumberAvailable, generateAvailableNumber, validateChosenNumber } from '../services/phoneAllocationService';
import { EmailService } from '../services/emailService';

const router = Router();

// Get phone numbering options for registration or profile change
router.get('/number-options', async (req: Request, res: Response) => {
  try {
    const config = await getPhoneConfig();
    const sampleAvailable = await generateAvailableNumber(config);
    return res.json({
      config,
      suggestedNumber: sampleAvailable.phoneNumber,
      suggestedAreaCode: sampleAvailable.areaCode
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve phone number options' });
  }
});

// User Registration
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, displayName, email, requestedPhoneNumber, requestedAreaCode } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if username taken
    const existingUser = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Check if email taken if provided
    let cleanEmail = email?.trim() || null;
    if (cleanEmail) {
      const existingEmail = await queryOne('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existingEmail) {
        return res.status(400).json({ error: 'An account with this email address already exists' });
      }
    }

    // Handle Phone Number Allocation
    const config = await getPhoneConfig();
    let assignedNumber = requestedPhoneNumber?.trim();
    let assignedAreaCode = requestedAreaCode?.trim();

    if (assignedNumber && config.allowUserChoice) {
      const validation = validateChosenNumber(assignedNumber, config);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      const available = await isNumberAvailable(assignedNumber, assignedAreaCode);
      if (!available) {
        return res.status(400).json({ error: `Phone number ${assignedNumber} is already in use or reserved` });
      }
    } else {
      // Auto-assign available number
      const allocated = await generateAvailableNumber(config, assignedAreaCode);
      assignedNumber = allocated.phoneNumber;
      assignedAreaCode = allocated.areaCode;
    }

    // Check if this is the first user on the system -> make admin
    const userCountRow = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const role = (userCountRow?.count || 0) === 0 ? 'admin' : 'user';

    const passwordHash = await bcrypt.hash(password, 10);
    const keySalt = crypto.randomBytes(16).toString('hex');

    const result = await execute(
      `INSERT INTO users (username, password_hash, display_name, email, phone_number, area_code, role, key_salt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, passwordHash, displayName || username, cleanEmail, assignedNumber, assignedAreaCode || null, role, keySalt]
    );

    const userId = result.lastID;
    const token = jwt.sign({ id: userId, username, role }, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    const createdUser = {
      id: userId,
      username,
      displayName: displayName || username,
      email: cleanEmail,
      phoneNumber: assignedNumber,
      areaCode: assignedAreaCode,
      role
    };

    // Send Welcome Email asynchronously if email provided
    if (cleanEmail) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const baseUrl = `${protocol}://${host}`;
      EmailService.sendWelcomeEmail(cleanEmail, createdUser, baseUrl).catch(e => console.error(e));
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

// Self-Service Forgot Password: Request Reset Email
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { usernameOrEmail } = req.body;
    if (!usernameOrEmail) {
      return res.status(400).json({ error: 'Username or email address is required' });
    }

    const queryStr = usernameOrEmail.trim();
    const user = await queryOne<any>(
      'SELECT id, username, email, display_name FROM users WHERE username = ? OR email = ?',
      [queryStr, queryStr]
    );

    if (user && user.email) {
      // Generate cryptographic 32-byte reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      await execute(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt]
      );

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      await EmailService.sendPasswordResetEmail(user.email, user.username, resetToken, baseUrl);
    }

    // Always return success message to prevent user enumeration attacks
    return res.json({
      message: 'If an account exists with that username or email address, a password reset link has been dispatched.'
    });
  } catch (err: any) {
    console.error('[Forgot Password Error]:', err);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Verify Password Reset Token
router.get('/verify-reset-token', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    const resetRow = await queryOne<any>(
      `SELECT pr.*, u.username 
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token = ? AND pr.used_at IS NULL AND datetime(pr.expires_at) > datetime('now')`,
      [token]
    );

    if (!resetRow) {
      return res.status(400).json({ error: 'Invalid or expired password reset link' });
    }

    return res.json({ valid: true, username: resetRow.username });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify reset token' });
  }
});

// Execute Password Reset
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const resetRow = await queryOne<any>(
      `SELECT pr.*, u.id as user_id 
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token = ? AND pr.used_at IS NULL AND datetime(pr.expires_at) > datetime('now')`,
      [token]
    );

    if (!resetRow) {
      return res.status(400).json({ error: 'This password reset link is invalid or has expired' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    // Update password and mark token as used
    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, resetRow.user_id]);
    await execute('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [resetRow.id]);

    return res.json({ message: 'Password reset successfully! You can now sign in with your new password.' });
  } catch (err: any) {
    console.error('[Reset Password Error]:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// User Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await queryOne<any>(
      'SELECT id, username, password_hash, display_name, phone_number, area_code, role, is_disabled, disabled_reason FROM users WHERE username = ?',
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

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        phoneNumber: user.phone_number,
        areaCode: user.area_code,
        role: user.role
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Login failed' });
  }
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
              dnd_repeated_call_breakthrough as dndRepeatedCallBreakthrough
       FROM users WHERE id = ?`,
      [req.user!.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve profile' });
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
      params.push(displayName.trim());
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email ? email.trim() : null);
    }
    if (callPrivacy !== undefined) {
      updates.push('call_privacy = ?');
      params.push(callPrivacy);
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
    return res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
});

export default router;
