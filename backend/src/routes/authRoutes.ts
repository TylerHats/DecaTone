import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { execute, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest, JWT_SECRET } from '../middleware/authMiddleware';
import { getPhoneConfig, isNumberAvailable, generateAvailableNumber } from '../services/phoneAllocationService';

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
    const { username, password, displayName, requestedPhoneNumber, requestedAreaCode } = req.body;

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

    // Handle Phone Number Allocation
    const config = await getPhoneConfig();
    let assignedNumber = requestedPhoneNumber?.trim();
    let assignedAreaCode = requestedAreaCode?.trim();

    if (assignedNumber && config.allowUserChoice) {
      // Validate user requested number
      if (!/^\d+$/.test(assignedNumber)) {
        return res.status(400).json({ error: 'Phone number must contain only numeric digits' });
      }
      if (assignedNumber.length !== config.numberLength) {
        return res.status(400).json({ error: `Phone number must be exactly ${config.numberLength} digits` });
      }
      const available = await isNumberAvailable(assignedNumber, assignedAreaCode);
      if (!available) {
        return res.status(400).json({ error: `Phone number ${assignedNumber} is already in use` });
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

    const result = await execute(
      `INSERT INTO users (username, password_hash, display_name, phone_number, area_code, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, passwordHash, displayName || username, assignedNumber, assignedAreaCode || null, role]
    );

    const userId = result.lastID;
    const token = jwt.sign({ id: userId, username, role }, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: userId,
        username,
        displayName: displayName || username,
        phoneNumber: assignedNumber,
        areaCode: assignedAreaCode,
        role
      }
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: `Registration failed: ${err.message}` });
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

// Get Current User Profile & Paired Phone Info
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await queryOne<any>(
      'SELECT id, username, display_name, phone_number, area_code, role, call_privacy, avatar_url, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get paired phone info if available
    const phone = await queryOne<any>(
      'SELECT device_id, mac_address, ip_address, firmware_version, rssi, is_online, hook_state, call_state, earpiece_volume, mic_sensitivity, ring_style, ring_cadence_custom, ring_timeout_sec, last_seen, paired_at FROM phones WHERE user_id = ?',
      [user.id]
    );

    // Get unread voicemail count
    const vmCount = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM voicemails WHERE user_id = ? AND is_read = 0',
      [user.id]
    );

    return res.json({
      user: {
        ...user,
        unreadVoicemails: vmCount?.count || 0
      },
      phone: phone || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch user session' });
  }
});

// Update Profile & Privacy Preferences
router.put('/profile', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { displayName, callPrivacy, newPassword, currentPassword } = req.body;

    if (displayName) {
      await execute('UPDATE users SET display_name = ? WHERE id = ?', [displayName.trim(), req.user!.id]);
    }

    if (callPrivacy && ['anyone', 'friends_only', 'dnd'].includes(callPrivacy)) {
      await execute('UPDATE users SET call_privacy = ? WHERE id = ?', [callPrivacy, req.user!.id]);
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to set a new password' });
      }
      const user = await queryOne<any>('SELECT password_hash FROM users WHERE id = ?', [req.user!.id]);
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(400).json({ error: 'Current password incorrect' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }
      const newHash = await bcrypt.hash(newPassword, 10);
      await execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user!.id]);
    }

    return res.json({ message: 'Profile updated successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
