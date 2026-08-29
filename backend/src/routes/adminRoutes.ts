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
const uploadLogo = multer({ storage: logoStorage });

const firmwareStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, firmwareDir),
  filename: (req, file, cb) => cb(null, `firmware_latest.bin`)
});
const uploadFirmware = multer({ storage: firmwareStorage });

const restoreUpload = multer({ dest: path.join(os.tmpdir(), 'decatone-restore') });

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
    const fwVersion = version?.trim() || '1.1.0';

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', fwVersion]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_binary_url', '/api/firmware/download/latest']);

    // Broadcast OTA Update notification to all connected ESP32-S3 units
    phoneSwitchService.notifyOtaUpdateAvailable(fwVersion, '/api/firmware/download/latest');

    return res.json({
      message: `Firmware v${fwVersion} uploaded! OTA update notification broadcast to all connected phones.`,
      version: fwVersion
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Firmware upload failed: ${err.message}` });
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

// 6. Self-Updater & Release Channels
router.get('/update/check', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "update_channel"');
    const channel = channelRow?.value || 'stable';

    const installedVersionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "installed_version"');
    const installedVersion = installedVersionRow?.value || '1.0.0';

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
    const updateAvailable = normalize(targetVersion) !== '' && normalize(installedVersion) !== normalize(targetVersion);

    return res.json({
      currentVersion: installedVersion,
      targetVersion,
      channel,
      updateAvailable,
      latestRelease: latestReleaseInfo || { tag: targetVersion, name: `DecaTone ${targetVersion}`, notes: 'You are running the latest version.' }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check for updates' });
  }
});

router.post('/update/channel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { channel } = req.body;
    if (!['stable', 'beta', 'alpha'].includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel' });
    }

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['update_channel', channel]);
    return res.json({ message: `Update channel set to ${channel}` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update channel' });
  }
});

router.post('/update/apply', async (req: AuthenticatedRequest, res: Response) => {
  try {
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
      console.log('[Self-Updater] Restarting container to apply updates...');
      process.exit(0);
    }, 1200);

    return res.json({ message: 'Update applied! DecaTone is restarting now (please refresh your browser in 5 seconds).' });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to apply update: ${err.message}` });
  }
});


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

export default router;
