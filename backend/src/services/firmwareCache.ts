import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FIRMWARE_DIR } from '../config/paths';

// Async Firmware SHA-256 Cache keyed by { mtimeMs, size }
let cachedFwSha: { binPath: string; mtimeMs: number; size: number; sha256: string } | null = null;

/** Compute and cache SHA-256 digest of a firmware binary based on file stats. */
export async function getCachedFirmwareSha256(
  binPath = path.join(FIRMWARE_DIR, 'firmware_latest.bin')
): Promise<string | null> {
  try {
    const st = await fs.promises.stat(binPath);
    if (!st.isFile()) return null;
    if (cachedFwSha && cachedFwSha.binPath === binPath && cachedFwSha.mtimeMs === st.mtimeMs && cachedFwSha.size === st.size) {
      return cachedFwSha.sha256;
    }
    const sha256 = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(binPath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
    cachedFwSha = { binPath, mtimeMs: st.mtimeMs, size: st.size, sha256 };
    return sha256;
  } catch {
    return null;
  }
}

/** Clear cached firmware binary SHA-256 digest after uploads or resets. */
export function invalidateFirmwareShaCache(): void {
  cachedFwSha = null;
}

