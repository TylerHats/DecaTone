import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { execute, queryOne } from '../db/connection';
import { JWT_SECRET } from '../middleware/authMiddleware';

const router = Router();

// Check if initial setup is required
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userCountRow = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const count = userCountRow?.count || 0;
    return res.json({
      setupRequired: count === 0,
      initialized: count > 0
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// Initialize system with first Master Admin account and dial plan
router.post('/initialize', async (req: Request, res: Response) => {
  try {
    const userCountRow = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    if ((userCountRow?.count || 0) > 0) {
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
      adminPhoneNumber,
      adminExtension
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const minLen = parseInt(phoneNumberMinLength || phoneNumberLength || '4', 10);
    const maxLen = parseInt(phoneNumberMaxLength || phoneNumberMinLength || '10', 10);

    // Save System Settings
    if (appName) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['app_name', appName.trim()]);
    }
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_length', String(minLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['number_min_length', String(minLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['number_max_length', String(maxLen)]);
    if (assignmentMode) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['assignment_mode', String(assignmentMode)]);
    }
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['installed_version', '1.2.2']);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', '1.2.2']);

    // Determine initial master extension number
    let initialExt = (adminPhoneNumber || adminExtension || '').trim();
    if (!initialExt || initialExt.length < minLen || initialExt.length > maxLen) {
      initialExt = '1' + '0'.repeat(Math.max(2, minLen - 1));
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create Master Admin User
    const result = await execute(
      `INSERT INTO users (username, password_hash, display_name, phone_number, role, is_disabled)
       VALUES (?, ?, ?, ?, 'admin', 0)`,
      [username.trim().toLowerCase(), passwordHash, displayName?.trim() || 'System Administrator', initialExt]
    );

    const userId = result.lastID;
    const user = {
      id: userId,
      username: username.trim().toLowerCase(),
      display_name: displayName?.trim() || 'System Administrator',
      phone_number: initialExt,
      role: 'admin'
    };

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`[Setup] 🎉 DecaTone system initialized! Master Admin created: @${user.username} (Ext: ${initialExt})`);
    return res.json({
      message: 'System successfully initialized',
      token,
      user
    });
  } catch (err: any) {
    console.error('[Setup] Initialize error:', err);
    return res.status(500).json({ error: err.message || 'Setup initialization failed' });
  }
});

export default router;
