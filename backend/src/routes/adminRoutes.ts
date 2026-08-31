import { Router, Response } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import https from 'https';
import bcrypt from 'bcryptjs';
import { exec, execSync } from 'child_process';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/authMiddleware';
import { runMigrations } from '../db/migrations';
import { createBackupArchiveInternal, purgeExcessBackups } from '../services/backupScheduler';
import { phoneSwitchService } from '../services/phoneSwitchService';
import { EmailService } from '../services/emailService';
import { homeAssistantMqttService } from '../services/homeAssistantMqttService';

const router = Router();
router.use(authenticateToken, requireAdmin);

const REPO_OWNER = 'TylerHats';
const REPO_NAME = 'DecaTone';

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
const customBrandingDir = path.join(dataDir, 'branding');
const backupsDir = path.join(dataDir, 'backups');
const uploadsDir = path.join(__dirname, '../../uploads');
const firmwareDir = path.join(dataDir, 'firmware');

if (!fs.existsSync(customBrandingDir)) fs.mkdirSync(customBrandingDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
if (!fs.existsSync(firmwareDir)) fs.mkdirSync(firmwareDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, customBrandingDir),
  filename: (req, file, cb) => cb(null, 'logo.png')
});
const uploadLogo = multer({ storage: logoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const faviconStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, customBrandingDir),
  filename: (req, file, cb) => cb(null, 'favicon.png')
});
const uploadFavicon = multer({ storage: faviconStorage, limits: { fileSize: 2 * 1024 * 1024 } });

const navbarIconStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, customBrandingDir),
  filename: (req, file, cb) => cb(null, 'navbar_icon.png')
});
const uploadNavbarIcon = multer({ storage: navbarIconStorage, limits: { fileSize: 2 * 1024 * 1024 } });

const firmwareStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, firmwareDir),
  filename: (req, file, cb) => cb(null, `firmware_latest.bin`)
});
const uploadFirmware = multer({ storage: firmwareStorage, limits: { fileSize: 16 * 1024 * 1024 } });

const restoreUpload = multer({ dest: path.join(os.tmpdir(), 'decatone-restore') });

export function isDockerEnvironment(): boolean {
  if (fs.existsSync('/.dockerenv')) return true;
  if (process.env.IS_DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true') return true;
  try {
    if (fs.existsSync('/proc/self/cgroup')) {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('containerd') || cgroup.includes('kubepods')) return true;
    }
  } catch (e) {}
  return false;
}

function execPromise(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function getGitHubApi(apiPath: string): Promise<any> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      headers: { 'User-Agent': 'DecaTone-Self-Updater' }
    };
    https
      .get(options, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

function getDirectorySize(dirPath: string): number {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        totalSize += getDirectorySize(filePath);
      } else if (file.isFile()) {
        try {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        } catch (e) {}
      }
    }
  } catch (e) {}
  return totalSize;
}

// 1. System Metrics
router.get('/metrics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const phoneCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM phones');
    const onlinePhoneCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM phones WHERE is_online = 1');
    const callCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM calls');
    const voicemailCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM voicemails');

    let dbSizeBytes = 0;
    try {
      const dbPath = path.join(dataDir, 'decatone.db');
      if (fs.existsSync(dbPath)) {
        dbSizeBytes = fs.statSync(dbPath).size;
      }
    } catch (e) {}

    const uploadsSizeBytes = getDirectorySize(uploadsDir) + getDirectorySize(customBrandingDir);

    return res.json({
      stats: {
        totalUsers: userCount?.count || 0,
        totalPhones: phoneCount?.count || 0,
        onlinePhones: onlinePhoneCount?.count || 0,
        totalCalls: callCount?.count || 0,
        totalVoicemails: voicemailCount?.count || 0,
        dbSizeBytes,
        uploadsSizeBytes
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// 2. User Management Suite
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await query<any>(
      `SELECT u.id, u.username, u.display_name, u.phone_number, u.area_code, u.role, u.is_disabled, u.disabled_reason, u.created_at,
              p.device_id, p.is_online as phone_online, p.firmware_version
       FROM users u
       LEFT JOIN phones p ON p.user_id = u.id
       ORDER BY u.id ASC`
    );
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

router.put('/users/:id/role', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const targetId = parseInt(req.params.id, 10);

    if (targetId === req.user!.id && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot demote your own admin account' });
    }

    await execute('UPDATE users SET role = ? WHERE id = ?', [role, targetId]);
    return res.json({ message: 'User role updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user role' });
  }
});

router.put('/users/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { isDisabled, disabledReason } = req.body;
    const targetId = parseInt(req.params.id, 10);

    if (targetId === req.user!.id && isDisabled) {
      return res.status(400).json({ error: 'Cannot disable your own account' });
    }

    await execute(
      'UPDATE users SET is_disabled = ?, disabled_reason = ? WHERE id = ?',
      [isDisabled ? 1 : 0, disabledReason || null, targetId]
    );

    return res.json({ message: isDisabled ? 'User account disabled' : 'User account enabled' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user status' });
  }
});

router.put('/users/:id/reset-password', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const targetId = parseInt(req.params.id, 10);
    const hash = await bcrypt.hash(newPassword, 10);
    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, targetId]);

    return res.json({ message: 'User password reset successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.put('/users/:id/phone-number', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phoneNumber, areaCode } = req.body;
    const targetId = parseInt(req.params.id, 10);

    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

    // Check availability
    const existing = await queryOne('SELECT id FROM users WHERE phone_number = ? AND id != ?', [phoneNumber.trim(), targetId]);
    if (existing) {
      return res.status(400).json({ error: 'Phone number already assigned to another user' });
    }

    await execute('UPDATE users SET phone_number = ?, area_code = ? WHERE id = ?', [phoneNumber.trim(), areaCode?.trim() || null, targetId]);
    return res.json({ message: 'User phone number updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update phone number' });
  }
});

router.delete('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await execute('DELETE FROM users WHERE id = ?', [targetId]);
    return res.json({ message: 'User deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// 3. Hardware Fleet Inspector & Management
router.get('/fleet', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const phones = await query<any>(
      `SELECT p.*, u.username as assigned_username, u.display_name as assigned_display_name, u.phone_number as assigned_phone_number
       FROM phones p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.is_online DESC, p.last_seen DESC`
    );
    return res.json({ phones });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list phone fleet' });
  }
});

router.post('/fleet/:deviceId/test-ring', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const sent = phoneSwitchService.sendTestRing(deviceId);
    if (!sent) return res.status(400).json({ error: 'Device is offline' });
    return res.json({ message: 'Test ring sent to device!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send test ring' });
  }
});

router.post('/fleet/:deviceId/reboot', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const sent = phoneSwitchService.sendRemoteReboot(deviceId);
    if (!sent) return res.status(400).json({ error: 'Device is offline' });
    return res.json({ message: 'Reboot command sent to device!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reboot device' });
  }
});

router.post('/fleet/:deviceId/unpair', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    await execute('UPDATE phones SET user_id = NULL WHERE device_id = ?', [deviceId]);
    return res.json({ message: 'Phone unpaired from user' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unpair phone' });
  }
});

// 4. Firmware OTA Management
router.post('/firmware/upload', uploadFirmware.single('firmware'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No firmware .bin file provided' });
    }

    const { version } = req.body;
    const fwVersion = version?.trim() || '1.2.0';

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', fwVersion]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_binary_url', '/api/firmware/download/latest']);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['custom_firmware_override', '1']);

    // Broadcast OTA Update notification to all connected ESP32-S3 units
    phoneSwitchService.notifyOtaUpdateAvailable(fwVersion, '/api/firmware/download/latest');

    return res.json({
      message: `Custom Firmware v${fwVersion} uploaded and activated! Broadcast signal dispatched to connected phones.`,
      version: fwVersion,
      isCustomOverride: true
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Firmware upload failed: ${err.message}` });
  }
});

router.post('/firmware/reset-override', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await execute('DELETE FROM system_settings WHERE key = "custom_firmware_override"');
    const defaultVersion = '1.2.0';
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', defaultVersion]);

    return res.json({
      message: 'Custom firmware override cleared. Firmware distribution reverted to official release binary.',
      version: defaultVersion,
      isCustomOverride: false
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to reset firmware override: ${err.message}` });
  }
});

// 5. Backups & Restore Suite
router.get('/backups', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = fs.readdirSync(backupsDir);
    const backups = files
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(backupsDir, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          sizeBytes: stat.size,
          created_at: stat.mtime
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.json({ backups });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.post('/backups/create', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const backup = await createBackupArchiveInternal();
    return res.json({
      message: 'Compressed backup archive created successfully!',
      backup
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Backup creation failed: ${err.message}` });
  }
});

router.get('/backups/download/:filename', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(backupsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to download backup' });
  }
});

router.post('/backups/restore', restoreUpload.single('backup_file'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    let sourcePath = '';
    const filenameParam = req.body.filename;

    if (req.file) {
      sourcePath = req.file.path;
    } else if (filenameParam) {
      sourcePath = path.join(backupsDir, path.basename(filenameParam));
    }

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return res.status(400).json({ error: 'No valid backup file provided' });
    }

    if (sourcePath.endsWith('.tar.gz') || req.file) {
      const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decatone-restore-unpack-'));
      try {
        await execPromise(`tar -xzf "${sourcePath}" -C "${unpackDir}"`);

        // 1. Restore Database file
        const restoredDbPath = path.join(unpackDir, 'decatone.db');
        if (fs.existsSync(restoredDbPath)) {
          fs.copyFileSync(restoredDbPath, path.join(dataDir, 'decatone.db'));
        }

        // 2. Restore Branding directory
        const restoredBrandingDir = path.join(unpackDir, 'branding');
        if (fs.existsSync(restoredBrandingDir)) {
          fs.cpSync(restoredBrandingDir, customBrandingDir, { recursive: true });
        }

        // 3. Restore Uploads directory
        const restoredUploadsDir = path.join(unpackDir, 'uploads');
        if (fs.existsSync(restoredUploadsDir)) {
          fs.cpSync(restoredUploadsDir, uploadsDir, { recursive: true });
        }
      } finally {
        try {
          fs.rmSync(unpackDir, { recursive: true, force: true });
        } catch (e) {}
      }
    } else if (sourcePath.endsWith('.db')) {
      fs.copyFileSync(sourcePath, path.join(dataDir, 'decatone.db'));
    }

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    await runMigrations();

    return res.json({
      success: true,
      message: 'System backup restored successfully! Database, custom branding, and voicemails have been restored.'
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Restore failed: ${err.message}` });
  }
});

// Backup Settings (Automated Backups & Retention)
router.get('/backups/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any>('SELECT key, value FROM system_settings WHERE key IN ("auto_backup_enabled", "auto_backup_interval", "auto_backup_time", "backup_retention_count")');
    const map: Record<string, string> = {};
    rows.forEach(r => { map[r.key] = r.value; });

    return res.json({
      autoBackupEnabled: map['auto_backup_enabled'] === 'true',
      autoBackupInterval: map['auto_backup_interval'] || 'daily',
      autoBackupTime: map['auto_backup_time'] || '02:00',
      backupRetentionCount: parseInt(map['backup_retention_count'] || '10', 10)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch backup settings' });
  }
});

router.put('/backups/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { autoBackupEnabled, autoBackupInterval, autoBackupTime, backupRetentionCount } = req.body;

    if (autoBackupEnabled !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['auto_backup_enabled', autoBackupEnabled ? 'true' : 'false']);
    }
    if (autoBackupInterval) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['auto_backup_interval', autoBackupInterval]);
    }
    if (autoBackupTime) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['auto_backup_time', autoBackupTime]);
    }
    if (backupRetentionCount !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['backup_retention_count', String(backupRetentionCount)]);
      purgeExcessBackups(parseInt(String(backupRetentionCount), 10));
    }

    return res.json({ message: 'Backup and retention settings updated successfully!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update backup settings' });
  }
});

// 6. Self-Updater & Release Channels
router.get('/update/check', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "update_channel"');
    const channel = channelRow?.value || 'stable';

    const installedVersionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "installed_version"');
    const installedVersion = installedVersionRow?.value || '1.2.2';

    let targetVersion = installedVersion;
    let latestReleaseInfo: any = null;

    if (channel === 'alpha') {
      const commits = await getGitHubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`);
      if (commits && commits.sha) {
        targetVersion = commits.sha.substring(0, 7);
        latestReleaseInfo = {
          tag: targetVersion,
          name: `Alpha Commit: ${commits.commit.message.split('\n')[0]}`,
          notes: commits.commit.message,
          published_at: commits.commit.committer.date
        };
      }
    } else if (channel === 'beta') {
      const tags = await getGitHubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/tags`);
      if (Array.isArray(tags) && tags.length > 0) {
        const latestTag = tags[0];
        targetVersion = latestTag.name;
        latestReleaseInfo = {
          tag: latestTag.name,
          name: `Beta Release: ${latestTag.name}`,
          notes: `Beta update based on tag ${latestTag.name}`,
          published_at: new Date().toISOString()
        };
      }
    } else {
      const releases = await getGitHubApi(`/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
      if (releases && releases.tag_name) {
        targetVersion = releases.tag_name;
        latestReleaseInfo = {
          tag: releases.tag_name,
          name: releases.name || releases.tag_name,
          notes: releases.body || 'Latest stable release',
          published_at: releases.published_at
        };
      }
    }

    const normalize = (v: string) => (v ? v.replace(/^v/i, '').trim().toLowerCase() : '');
    const normTarget = normalize(targetVersion);
    const normInstalled = normalize(installedVersion);

    // Semver comparator (only notify if target > installed)
    const semverGT = (a: string, b: string) => {
      const pa = a.split('.').map(n => parseInt(n, 10) || 0);
      const pb = b.split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return true;
        if (na < nb) return false;
      }
      return false;
    };

    const updateAvailable = normTarget !== '' && (channel === 'alpha' ? normInstalled !== normTarget : semverGT(normTarget, normInstalled));
    const isDocker = isDockerEnvironment();

    return res.json({
      currentVersion: installedVersion,
      targetVersion,
      channel,
      updateAvailable,
      isDocker,
      dockerImage: 'tylerhats/decatone:latest',
      latestRelease: latestReleaseInfo || { tag: targetVersion, name: `DecaTone ${targetVersion}`, notes: 'You are running the latest version.' }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check for updates' });
  }
});

router.get('/update/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any>('SELECT key, value FROM system_settings WHERE key IN ("server_auto_update_enabled", "server_auto_update_channel", "server_auto_update_time", "server_auto_update_frequency")');
    const map: Record<string, string> = {};
    rows.forEach(r => { map[r.key] = r.value; });

    return res.json({
      autoUpdateEnabled: map['server_auto_update_enabled'] === 'true',
      autoUpdateChannel: map['server_auto_update_channel'] || 'stable',
      autoUpdateTime: map['server_auto_update_time'] || '03:00',
      autoUpdateFrequency: map['server_auto_update_frequency'] || 'daily',
      isDocker: isDockerEnvironment()
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch update settings' });
  }
});

router.put('/update/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { autoUpdateEnabled, autoUpdateChannel, autoUpdateTime, autoUpdateFrequency } = req.body;
    if (autoUpdateEnabled !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_enabled', autoUpdateEnabled ? 'true' : 'false']);
    }
    if (autoUpdateChannel) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_channel', autoUpdateChannel]);
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['update_channel', autoUpdateChannel]);
    }
    if (autoUpdateTime) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_time', autoUpdateTime]);
    }
    if (autoUpdateFrequency) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_frequency', autoUpdateFrequency]);
    }

    return res.json({ message: 'Server auto-update settings saved!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save update settings' });
  }
});

router.post('/update/channel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { channel } = req.body;
    if (!['stable', 'beta', 'alpha'].includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel' });
    }

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['update_channel', channel]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_channel', channel]);
    return res.json({ message: `Update channel set to ${channel}` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update channel' });
  }
});

router.post('/update/apply', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (isDockerEnvironment()) {
      return res.status(400).json({
        isDocker: true,
        error: 'DecaTone is running inside a Docker container. In-app git updates are disabled. Please pull the updated container image: docker pull ghcr.io/tylerhats/decatone:latest && docker compose up -d'
      });
    }

    const repoPath = path.join(__dirname, '../../..');
    const { targetVersion } = req.body;

    try {
      execSync('git fetch --all && git reset --hard origin/main && git clean -fd', { cwd: repoPath, timeout: 45000 });
      const buildEnv = { ...process.env, NODE_ENV: 'development' };
      execSync('npm run setup', { cwd: repoPath, timeout: 180000, env: buildEnv });
      execSync('npm run build', { cwd: repoPath, timeout: 180000, env: buildEnv });
    } catch (gitErr: any) {
      console.warn('[Self-Updater Warning]', gitErr.message);
    }

    await runMigrations();

    if (targetVersion) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['installed_version', String(targetVersion)]);
    }

    setTimeout(() => {
      console.log('[Self-Updater] Restarting service to apply updates...');
      process.exit(0);
    }, 1200);

    return res.json({ message: 'Update applied! DecaTone is restarting now (please refresh your browser in 5 seconds).' });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to apply update: ${err.message}` });
  }
});

// 7. Branding & Icons Management
router.post('/branding/logo', uploadLogo.single('logo'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No logo image file provided' });
    }

    const logoUrl = `/branding/logo.png?v=${Date.now()}`;
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['logo_url', logoUrl]);

    return res.json({
      message: 'Branding logo uploaded successfully!',
      logoUrl
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to upload branding logo' });
  }
});

router.post('/branding/favicon', uploadFavicon.single('favicon'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No favicon image file provided' });
    }

    const faviconUrl = `/branding/favicon.png?v=${Date.now()}`;
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['favicon_url', faviconUrl]);

    return res.json({
      message: 'Custom browser favicon uploaded successfully!',
      faviconUrl
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to upload favicon' });
  }
});

router.post('/branding/navbar-icon', uploadNavbarIcon.single('navbar_icon'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No navbar icon image file provided' });
    }

    const navbarIconUrl = `/branding/navbar_icon.png?v=${Date.now()}`;
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['navbar_icon_url', navbarIconUrl]);

    return res.json({
      message: 'Custom navbar/top-right icon uploaded successfully!',
      navbarIconUrl
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to upload navbar icon' });
  }
});

router.post('/branding/reset', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await execute('DELETE FROM system_settings WHERE key IN ("logo_url", "favicon_url", "navbar_icon_url", "icon_url")');
    if (fs.existsSync(customBrandingDir)) {
      const files = fs.readdirSync(customBrandingDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(customBrandingDir, f)); } catch (e) {}
      }
    }
    return res.json({ message: 'All branding assets reset to default!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset branding assets' });
  }
});

// Broadcast OTA Update to Connected ESP32 Phones
router.post('/firmware/ota-broadcast', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const binUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_binary_url"');

    const firmwareVersion = versionRow?.value || '1.2.0';
    const binaryUrl = binUrlRow?.value || '/api/firmware/download/latest';

    const onlineDevices = await query<any>('SELECT device_id FROM phones WHERE is_online = 1');
    let dispatched = 0;

    for (const d of onlineDevices) {
      phoneSwitchService.sendToDevice(d.device_id, {
        type: 'ota_available',
        version: firmwareVersion,
        binaryUrl
      });
      dispatched++;
    }

    return res.json({
      message: `OTA update signal dispatched to ${dispatched} online phone(s)!`,
      count: dispatched,
      firmwareVersion
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to broadcast OTA update: ${err.message}` });
  }
});

// 7.5 Test SMTP Email Configuration
router.post('/smtp/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { testEmail } = req.body;
    const recipient = testEmail?.trim() || req.user?.username;

    if (!recipient || !recipient.includes('@')) {
      return res.status(400).json({ error: 'A valid recipient email address is required to send a test email' });
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const result = await EmailService.sendTestEmail(recipient, baseUrl);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json({ success: true, message: result.message });
  } catch (err: any) {
    return res.status(500).json({ error: `SMTP test error: ${err.message}` });
  }
});

// 8. Factory Reset / System Wipe
router.post('/system/wipe', async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('EXECUTING DECATONE SYSTEM FACTORY RESET...');
    await execute('DELETE FROM users');
    await execute('DELETE FROM phones');
    await execute('DELETE FROM friends');
    await execute('DELETE FROM friend_requests');
    await execute('DELETE FROM speed_dials');
    await execute('DELETE FROM calls');
    await execute('DELETE FROM voicemails');
    await execute('DELETE FROM voicemail_greetings');
    await execute('DELETE FROM system_settings');
    await execute('DELETE FROM schema_migrations');

    // Clean uploads and branding
    if (fs.existsSync(uploadsDir)) {
      try {
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
          fs.rmSync(path.join(uploadsDir, file), { recursive: true, force: true });
        }
      } catch (e) {}
    }

    if (fs.existsSync(customBrandingDir)) {
      try {
        const files = fs.readdirSync(customBrandingDir);
        for (const file of files) {
          fs.rmSync(path.join(customBrandingDir, file), { recursive: true, force: true });
        }
      } catch (e) {}
    }

    await runMigrations();

    return res.json({
      success: true,
      message: 'DecaTone wiped successfully! Restarting initial setup wizard...'
    });
  } catch (err: any) {
    return res.status(500).json({ error: `System wipe failed: ${err.message}` });
  }
});

// Home Assistant MQTT Integration Settings
router.get('/mqtt', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await homeAssistantMqttService.getMqttSettings();
    return res.json({
      enabled: settings.enabled === 'true',
      host: settings.host,
      port: settings.port,
      user: settings.user,
      pass: settings.pass ? '••••••••' : '',
      pin: settings.pin
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch MQTT settings' });
  }
});

router.put('/mqtt', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enabled, host, port, user, pass, pin } = req.body;
    await homeAssistantMqttService.updateSettings({
      enabled: !!enabled,
      host: host || 'localhost',
      port: parseInt(port || '1883', 10),
      user: user || '',
      pass: pass && pass !== '••••••••' ? pass : undefined,
      pin: pin || '512'
    });
    return res.json({ message: 'Home Assistant MQTT integration settings saved and applied!' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update MQTT settings' });
  }
});

// General Admin System Settings
router.get('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any>('SELECT key, value FROM system_settings');
    const settingsMap: Record<string, string> = {};
    for (const r of rows) {
      settingsMap[r.key] = r.value;
    }
    return res.json({ settings: settingsMap });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch admin settings' });
  }
});

router.post('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (settings && typeof settings === 'object') {
      for (const [key, value] of Object.entries(settings)) {
        await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [key, String(value)]);
      }
    }
    return res.json({ success: true, message: 'System settings saved successfully!' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to save system settings' });
  }
});

export default router;

