import path from 'path';
import fs from 'fs';

// Resolves identically from backend/src/config and backend/dist/config -> <repo>/backend
export const BACKEND_ROOT = path.resolve(__dirname, '../..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(BACKEND_ROOT, 'data');

export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(BACKEND_ROOT, 'uploads');

export const VOICEMAILS_DIR = path.join(UPLOADS_DIR, 'voicemails');
export const GREETINGS_DIR = path.join(UPLOADS_DIR, 'greetings');
export const BRANDING_DIR = path.join(DATA_DIR, 'branding');
export const FIRMWARE_DIR = path.join(DATA_DIR, 'firmware');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const TTS_VOICES_DIR = path.join(DATA_DIR, 'tts_voices');
export const PIPER_DIR = path.join(DATA_DIR, 'piper');
export const KOKORO_DIR = path.join(DATA_DIR, 'tts-kokoro');
export const TLS_DIR = path.join(DATA_DIR, 'tls');

export const DEFAULT_ASSETS_DIR = path.resolve(BACKEND_ROOT, '../assets');
export const FRONTEND_DIST_DIR = path.resolve(BACKEND_ROOT, '../frontend/dist');

export function ensureDirectories(): void {
  const dirs = [
    DATA_DIR,
    UPLOADS_DIR,
    VOICEMAILS_DIR,
    GREETINGS_DIR,
    BRANDING_DIR,
    FIRMWARE_DIR,
    BACKUPS_DIR,
    TTS_VOICES_DIR,
    PIPER_DIR,
    KOKORO_DIR,
    TLS_DIR
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirectories();
