import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { exec } from 'child_process';
import { FIRMWARE_DIR, REPO_ROOT } from '../config/paths';
import { execute, query, queryOne } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { phoneSwitchService } from './phoneSwitchService';

const REPO_OWNER = 'TylerHats';
const REPO_NAME = 'DecaTone';

// Track last OTA auto-dispatch per device so we don't re-push every 15 minutes
const lastDeviceOtaDispatch: Map<string, { version: string; dispatchedAt: number }> = new Map();
let isServerUpdateRunning = false;

export function detectDockerEnvironment(): boolean {
  if (fs.existsSync('/.dockerenv')) return true;
  if (process.env.IS_DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true') return true;
  try {
    if (fs.existsSync('/proc/self/cgroup')) {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('containerd') || cgroup.includes('kubepods')) {
        return true;
      }
    }
  } catch {}
  return false;
}

export function execAsync(
  command: string,
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: timeoutMs, env: env || process.env }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr ? `${err.message}\n${stderr}` : err.message;
        return reject(new Error(detail));
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function performGitAndBuildUpdate(channel: string, targetVersion?: string): Promise<void> {
  const buildEnv = { ...process.env, NODE_ENV: 'development' };

  if (channel === 'alpha') {
    await execAsync('git fetch origin main', REPO_ROOT, 60000);
    await execAsync('git reset --hard origin/main', REPO_ROOT, 60000);
  } else {
    const safeTag = String(targetVersion || '').trim();
    if (!safeTag || !/^[a-zA-Z0-9._\-+]+$/.test(safeTag)) {
      throw new Error(`Refusing bare-metal update without valid release tag for channel '${channel}'.`);
    }
    await execAsync('git fetch --tags origin', REPO_ROOT, 60000);
    await execAsync(`git checkout --force ${safeTag}`, REPO_ROOT, 60000);
  }

  await execAsync('npm run setup', REPO_ROOT, 240000, buildEnv);
  await execAsync('npm run build', REPO_ROOT, 240000, buildEnv);
}

export function fetchGitHubJson(apiPath: string): Promise<any> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: apiPath,
        headers: { 'User-Agent': 'DecaTone-AutoUpdate-Scheduler/1.3' },
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function semverGreaterThan(a: string, b: string): boolean {
  const pa = a.replace(/^v/i, '').trim().split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').trim().split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

function isWithinTimeWindow(targetHHMM: string, nowDate: Date, windowMinutes = 45): boolean {
  const [hStr, mStr] = (targetHHMM || '03:00').trim().split(':');
  const targetH = parseInt(hStr, 10);
  const targetM = parseInt(mStr, 10);
  if (isNaN(targetH) || isNaN(targetM)) return false;

  const currentMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const targetMinutes = targetH * 60 + targetM;
  const diffMinutes = (currentMinutes - targetMinutes + 1440) % 1440;
  return diffMinutes <= windowMinutes;
}

export function computeFirmwareSha256(binPath = path.join(FIRMWARE_DIR, 'firmware_latest.bin')): string | null {
  try {
    if (!fs.existsSync(binPath)) return null;
    const buf = fs.readFileSync(binPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

async function resolveChannelTargetVersion(channel: string, fallbackVersion: string): Promise<string> {
  if (channel === 'alpha') {
    const commit = await fetchGitHubJson(`/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`);
    return commit?.sha ? String(commit.sha).substring(0, 7) : fallbackVersion;
  }
  if (channel === 'beta') {
    const tags = await fetchGitHubJson(`/repos/${REPO_OWNER}/${REPO_NAME}/tags`);
    return Array.isArray(tags) && tags[0]?.name ? String(tags[0].name) : fallbackVersion;
  }
  const rel = await fetchGitHubJson(`/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
  return rel?.tag_name ? String(rel.tag_name) : fallbackVersion;
}

async function checkAndRunPhoneOtaUpdates(nowDate: Date): Promise<void> {
  const binPath = path.join(FIRMWARE_DIR, 'firmware_latest.bin');
  if (!fs.existsSync(binPath)) return;

  const versionRow = await queryOne<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = ?',
    ['firmware_latest_version']
  );
  const binUrlRow = await queryOne<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = ?',
    ['firmware_binary_url']
  );
  const overrideRow = await queryOne<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = ?',
    ['custom_firmware_override']
  );

  const defaultVersion = (versionRow?.value || '').trim();
  if (!defaultVersion) return;

  const binaryUrl = binUrlRow?.value || '/api/firmware/download/latest';
  const sha256 = computeFirmwareSha256(binPath);
  if (!sha256) return;

  const onlineIdlePhones = await query<any>(
    `SELECT device_id, firmware_version, ota_auto_update_enabled, ota_update_time, ota_update_channel
     FROM phones
     WHERE is_online = 1
       AND COALESCE(ota_auto_update_enabled, 1) = 1
       AND COALESCE(call_state, 'idle') = 'idle'
       AND COALESCE(hook_state, 'on_hook') = 'on_hook'`
  );

  const isCustomOverride = overrideRow?.value === '1';
  const channelCache = new Map<string, string>();
  const nowMs = nowDate.getTime();

  for (const phone of onlineIdlePhones) {
    const phoneChannel = String(phone.ota_update_channel || 'stable').toLowerCase();
    // Respect per-phone ota_update_channel unless a local custom override binary was uploaded
    let targetVersion = defaultVersion;
    if (!isCustomOverride && ['stable', 'beta', 'alpha'].includes(phoneChannel)) {
      if (!channelCache.has(phoneChannel)) {
        const resolved = await resolveChannelTargetVersion(phoneChannel, defaultVersion);
        channelCache.set(phoneChannel, resolved);
      }
      targetVersion = channelCache.get(phoneChannel) || defaultVersion;
    }

    const devVersion = (phone.firmware_version || '').replace(/^v/i, '').trim();
    const targetNorm = targetVersion.replace(/^v/i, '').trim();
    if (!targetNorm || devVersion === targetNorm) continue;

    // Only dispatch when the server's locally hosted binary actually matches the phone's target version
    const hostedNorm = defaultVersion.replace(/^v/i, '').trim();
    if (hostedNorm !== targetNorm) continue;

    if (!isWithinTimeWindow(phone.ota_update_time || '03:00', nowDate, 45)) {
      continue;
    }

    const prev = lastDeviceOtaDispatch.get(phone.device_id);
    if (prev && prev.version === targetVersion && nowMs - prev.dispatchedAt < 20 * 60 * 60 * 1000) {
      continue;
    }

    lastDeviceOtaDispatch.set(phone.device_id, { version: targetVersion, dispatchedAt: nowMs });
    phoneSwitchService.sendToDevice(phone.device_id, {
      type: 'ota_available',
      version: targetVersion,
      binaryUrl,
      downloadUrl: binaryUrl,
      sha256
    });
    console.log(`[AutoUpdate] Dispatched scheduled OTA v${targetVersion} (${phoneChannel}) to idle phone ${phone.device_id}`);
  }
}

async function checkAndRunServerAutoUpdate(nowDate: Date): Promise<void> {
  if (isServerUpdateRunning || detectDockerEnvironment()) return;

  if (phoneSwitchService.getActiveCallCount() > 0) return;

  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key IN (
      'server_auto_update_enabled',
      'server_auto_update_channel',
      'update_channel',
      'server_auto_update_time',
      'server_auto_update_frequency',
      'last_server_auto_update_at',
      'installed_version'
    )`
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  if (map['server_auto_update_enabled'] !== 'true') return;

  const targetTime = map['server_auto_update_time'] || '03:00';
  if (!isWithinTimeWindow(targetTime, nowDate, 45)) return;

  const frequency = map['server_auto_update_frequency'] || 'daily';
  const minGapMs = frequency === 'weekly' ? 6.5 * 24 * 60 * 60 * 1000 : 20 * 60 * 60 * 1000;
  const lastCheckAt = map['last_server_auto_update_at'] ? new Date(map['last_server_auto_update_at']).getTime() : 0;
  if (nowDate.getTime() - lastCheckAt < minGapMs) return;

  const channel = map['server_auto_update_channel'] || map['update_channel'] || 'stable';
  const installedVersion = map['installed_version'] || '1.3.0';
  const targetVersion = await resolveChannelTargetVersion(channel, '');

  await execute(
    'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
    ['last_server_auto_update_at', nowDate.toISOString()]
  );

  if (!targetVersion) return;

  const normInstalled = installedVersion.replace(/^v/i, '').trim().toLowerCase();
  const normTarget = targetVersion.replace(/^v/i, '').trim().toLowerCase();
  const updateNeeded = channel === 'alpha' ? normInstalled !== normTarget : semverGreaterThan(normTarget, normInstalled);
  if (!updateNeeded) return;

  if (phoneSwitchService.getActiveCallCount() > 0) return;

  isServerUpdateRunning = true;
  try {
    console.log(`[AutoUpdate] Idle window reached. Updating DecaTone (${channel}) from ${installedVersion} -> ${targetVersion}...`);
    await performGitAndBuildUpdate(channel, targetVersion);
    await runMigrations();
    await execute(
      'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
      ['installed_version', targetVersion]
    );

    if (phoneSwitchService.getActiveCallCount() === 0) {
      console.log('[AutoUpdate] Build complete and switchboard idle. Exiting cleanly for supervisor restart.');
      setTimeout(() => process.exit(0), 1000).unref();
    }
  } catch (err) {
    console.error('[AutoUpdate] Scheduled server update failed:', err);
  } finally {
    isServerUpdateRunning = false;
  }
}

export function initAutoUpdateScheduler(): void {
  const intervalMs = 15 * 60 * 1000;
  const timer = setInterval(async () => {
    const now = new Date();
    try {
      await checkAndRunPhoneOtaUpdates(now);
      await checkAndRunServerAutoUpdate(now);
    } catch (err) {
      console.error('[AutoUpdate Scheduler Error]:', err);
    }
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}
