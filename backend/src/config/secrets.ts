import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Request } from 'express';
import { DATA_DIR, ensureDirectories } from './paths';
import { queryOne } from '../db/connection';

const INSECURE_JWT_DEFAULTS = new Set([
  'decatone_default_jwt_secret_change_me_in_production',
  'decatone_production_secret_change_me_12345',
  'changeme',
  'secret',
  ''
]);

const JWT_SECRET_FILE = path.join(DATA_DIR, 'jwt.secret');

function loadOrGenerateJwtSecret(): string {
  const envSecret = (process.env.JWT_SECRET || '').trim();
  if (envSecret && !INSECURE_JWT_DEFAULTS.has(envSecret)) {
    return envSecret;
  }

  ensureDirectories();

  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const existing = fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32 && !INSECURE_JWT_DEFAULTS.has(existing)) {
        return existing;
      }
    }
  } catch (err) {
    console.warn('[Secrets] Warning reading jwt.secret, regenerating:', err);
  }

  const generated = crypto.randomBytes(64).toString('hex');
  try {
    fs.writeFileSync(JWT_SECRET_FILE, generated, { mode: 0o600 });
  } catch (err) {
    console.warn('[Secrets] Could not persist jwt.secret to disk, using ephemeral secret:', err);
  }
  return generated;
}

let currentJwtSecret = loadOrGenerateJwtSecret();

export function getJwtSecret(): string {
  return currentJwtSecret;
}

export function rotateJwtSecret(): string {
  const fresh = crypto.randomBytes(64).toString('hex');
  ensureDirectories();
  try {
    fs.writeFileSync(JWT_SECRET_FILE, fresh, { mode: 0o600 });
  } catch (err) {
    console.warn('[Secrets] Failed to persist rotated jwt.secret:', err);
  }

  // If process.env.JWT_SECRET wasn't explicitly fixed at container startup, switch active secret immediately
  const envSecret = (process.env.JWT_SECRET || '').trim();
  if (!envSecret || INSECURE_JWT_DEFAULTS.has(envSecret)) {
    currentJwtSecret = fresh;
  }
  return currentJwtSecret;
}

const STRICT_HOST_REGEX = /^[a-zA-Z0-9.\-:]+$/;

export async function getSafePublicBaseUrl(req?: Request | { protocol?: string; headers?: Record<string, any> }): Promise<string> {
  const envUrl = (process.env.PUBLIC_BASE_URL || '').trim();
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return envUrl.replace(/\/+$/, '');
      }
    } catch {
      // Fall through if invalid URL
    }
  }

  try {
    const dbUrlRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['public_base_url']
    );
    const dbUrl = dbUrlRow?.value?.trim();
    if (dbUrl) {
      const parsed = new URL(dbUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return dbUrl.replace(/\/+$/, '');
      }
    }
  } catch {
    // Ignore DB lookup errors during early boot or invalid URL
  }

  const protoHeader = req?.headers?.['x-forwarded-proto'];
  const rawProto = (typeof protoHeader === 'string' ? protoHeader.split(',')[0].trim() : '') || req?.protocol || 'http';
  const safeProto = rawProto === 'https' ? 'https' : 'http';

  const rawHost = typeof req?.headers?.host === 'string' ? req.headers.host.trim() : '';
  if (rawHost && STRICT_HOST_REGEX.test(rawHost)) {
    return `${safeProto}://${rawHost}`;
  }

  const port = process.env.PORT || 4000;
  return `http://localhost:${port}`;
}
