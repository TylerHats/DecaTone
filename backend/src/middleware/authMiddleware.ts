import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { queryOne } from '../db/connection';
import { getJwtSecret } from '../config/secrets';

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: string;
  phone_number?: string;
  display_name?: string;
  tokenVersion?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export function getSessionCookieOptions(req: Request) {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase();
  const isSecure =
    override === 'true' ? true : override === 'false' ? false : Boolean(req.secure);
  return {
    httpOnly: true,
    secure: isSecure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax' as const
  };
}

export function isValidP256UncompressedPublicKey(val: unknown): boolean {
  if (typeof val !== 'string' || !val.trim()) return false;
  try {
    const buf = Buffer.from(val.trim(), 'base64');
    return buf.length === 65 && buf[0] === 0x04;
  } catch {
    return false;
  }
}

export function signUserJwt(user: { id: number; username: string; role: string; token_version?: number }): string {
  const tokenVersion = user.token_version || 1;
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tokenVersion },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '30d' }
  );
}

export const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      try {
        cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      } catch {
        cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    }
  });
  return cookies;
};

async function verifyJwtAndLoadUser(token: string): Promise<{ user?: AuthenticatedUser; status?: number; error?: string }> {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as any;
    if (!decoded || typeof decoded.id !== 'number') {
      return { status: 403, error: 'Invalid authentication token' };
    }

    const user = await queryOne<any>(
      'SELECT id, username, display_name, phone_number, role, is_disabled, disabled_reason, COALESCE(token_version, 1) as token_version FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!user) {
      return { status: 401, error: 'User account not found' };
    }

    if (user.is_disabled) {
      return { status: 403, error: user.disabled_reason || 'This account has been disabled by an administrator' };
    }

    const dbTokenVersion = user.token_version || 1;
    if (decoded.tokenVersion !== dbTokenVersion) {
      return { status: 401, error: 'Session has been revoked. Please sign in again.' };
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        phone_number: user.phone_number,
        role: user.role,
        tokenVersion: dbTokenVersion
      }
    };
  } catch {
    return { status: 403, error: 'Invalid or expired authentication session' };
  }
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers['authorization'];
  const rawBearer =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
  const bearerToken = rawBearer && rawBearer !== 'null' && rawBearer !== 'undefined' ? rawBearer : undefined;
  const token = bearerToken || cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  const result = await verifyJwtAndLoadUser(token);
  if (!result.user) {
    return res.status(result.status || 403).json({ error: result.error || 'Invalid session' });
  }

  req.user = result.user;
  next();
}

export async function authenticateWebSocketRequest(req: IncomingMessage): Promise<AuthenticatedUser | null> {
  const candidateTokens: string[] = [];

  // 1. Check Sec-WebSocket-Protocol: decatone-auth, <jwt>
  const rawProto = req.headers['sec-websocket-protocol'];
  const protoStr = Array.isArray(rawProto) ? rawProto.join(',') : rawProto;
  if (typeof protoStr === 'string' && protoStr.length > 0) {
    const parts = protoStr.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.includes('decatone-auth')) {
      for (const p of parts) {
        if (p !== 'decatone-auth') {
          candidateTokens.push(p);
        }
      }
    }
  }

  // 2. Check Authorization: Bearer <jwt>
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) candidateTokens.push(bearer);
  }

  // 3. Check Cookie: token=<jwt>
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.token) {
    candidateTokens.push(cookies.token);
  }

  for (const token of candidateTokens) {
    const result = await verifyJwtAndLoadUser(token);
    if (result.user) {
      return result.user;
    }
  }

  return null;
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required' });
  }
  next();
}
