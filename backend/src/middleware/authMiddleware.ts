import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../db/connection';

export const JWT_SECRET = process.env.JWT_SECRET || 'decatone_default_jwt_secret_change_me_in_production';

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: string;
  phone_number?: string;
  display_name?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return cookies;
};

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || cookies.token || (req.query.token as string);

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = await queryOne<any>('SELECT id, username, display_name, phone_number, role, is_disabled, disabled_reason FROM users WHERE id = ?', [decoded.id]);

    if (!user) {
      return res.status(401).json({ error: 'User account not found' });
    }

    if (user.is_disabled) {
      return res.status(403).json({ error: user.disabled_reason || 'This account has been disabled by an administrator' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      phone_number: user.phone_number,
      role: user.role
    };

    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired authentication session' });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required' });
  }
  next();
}
