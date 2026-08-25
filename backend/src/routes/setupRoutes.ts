import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { execute, queryOne } from '../db/connection';
import { JWT_SECRET } from '../middleware/authMiddleware';

const router = Router();

// Check if DecaTone is already initialized
router.get('/status', async (req: Request, res: Response) => {
  try {
    const adminUser = await queryOne('SELECT id FROM users WHERE role = "admin" LIMIT 1');
    return res.json({
      initialized: !!adminUser,
      setupRequired: !adminUser
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// Initial Setup Wizard: Create initial admin and system settings
router.post('/initialize', async (req: Request, res: Response) => {
  try {
    const adminUser = await queryOne('SELECT id FROM users WHERE role = "admin" LIMIT 1');
    if (adminUser) {
      return res.status(400).json({ error: 'DecaTone is already initialized' });
    }

    const { username, password, displayName, appName, phoneNumberLength, defaultAreaCode } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const length = phoneNumberLength ? String(phoneNumberLength) : '3';
    const numLengthInt = parseInt(length, 10);
    const initialAdminNumber = String(Math.pow(10, numLengthInt - 1)); // e.g. "100" or "1000"

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await execute(
      `INSERT INTO users (username, password_hash, display_name, phone_number, area_code, role)
       VALUES (?, ?, ?, ?, ?, 'admin')`,
      [username, passwordHash, displayName || username, initialAdminNumber, defaultAreaCode || null]
    );

    if (appName) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['app_name', appName.trim()]);
    }
    if (phoneNumberLength) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_length', String(phoneNumberLength)]);
    }
    if (defaultAreaCode) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['default_area_code', defaultAreaCode.trim()]);
    }

    const userId = result.lastID;
    const token = jwt.sign({ id: userId, username, role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    return res.status(201).json({
      message: 'DecaTone initialized successfully!',
      token,
      user: {
        id: userId,
        username,
        displayName: displayName || username,
        phoneNumber: initialAdminNumber,
        role: 'admin'
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Setup initialization failed: ${err.message}` });
  }
});

export default router;
