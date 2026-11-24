import { Router, Response } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import https from 'https';
import bcrypt from 'bcryptjs';
import { DB_PATH, closeDatabase, execute, query, queryOne, reopenDatabase } from '../db/connection';
import {
  BACKUPS_DIR,
  BRANDING_DIR,
  FIRMWARE_DIR,
  GREETINGS_DIR,
  UPLOADS_DIR,
  VOICEMAILS_DIR,
  ensureDirectories
} from '../config/paths';
import { getSafePublicBaseUrl, rotateJwtSecret } from '../config/secrets';
import { authenticateToken, AuthenticatedRequest, getSessionCookieOptions, requireAdmin } from '../middleware/authMiddleware';
import { runMigrations } from '../db/migrations';
import { createBackupArchiveInternal, extractBackupArchiveSafe, purgeExcessBackups } from '../services/backupScheduler';
import {
  detectDockerEnvironment,
  performGitAndBuildUpdate
} from '../services/autoUpdateScheduler';
import { phoneSwitchService } from '../services/phoneSwitchService';
import { EmailService } from '../services/emailService';
import { homeAssistantMqttService } from '../services/homeAssistantMqttService';
import { TtsAudioService, TtsEngineType } from '../services/ttsAudioService';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';
import { getPhoneConfig, isReservedNumberOrPrefix } from '../services/phoneAllocationService';
import { tlsManagerService } from '../services/tlsManagerService';
import { getCachedFirmwareSha256, invalidateFirmwareShaCache } from '../services/firmwareCache';

const router = Router();
router.use(authenticateToken, requireAdmin);

const REPO_OWNER = 'TylerHats';
const REPO_NAME = 'DecaTone';
const CANONICAL_DOCKER_IMAGE = 'tylerhats/decatone:latest';

ensureDirectories();

// Cache GitHub API update checks for 15 minutes per channel to avoid unauthenticated rate limiting
const githubUpdateCache = new Map<string, { fetchedAt: number; payload: any }>();
const UPDATE_CACHE_TTL_MS = 15 * 60 * 1000;

const ALLOWED_BRANDING_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico']);
const ALLOWED_BRANDING_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon'
]);

export function detectBrandingImageFormat(buf: Buffer): 'png' | 'jpg' | 'webp' | 'ico' | null {
  if (!buf || buf.length < 12) return null;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
    return 'ico';
  }
  return null;
}

export function isValidBrandingImageBuffer(buf: Buffer): boolean {
  return detectBrandingImageFormat(buf) !== null;
}

function brandingFileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (ext === '.svg' || ext === '.html' || ext === '.htm' || mime.includes('svg') || mime.includes('html')) {
    return cb(new Error('SVG and HTML files are prohibited for security reasons. Upload PNG, JPEG, WEBP, or ICO.'));
  }
  if (ALLOWED_BRANDING_EXTS.has(ext) || ALLOWED_BRANDING_MIMES.has(mime)) {
    return cb(null, true);
  }
  return cb(new Error('Unsupported image format. Please upload PNG, JPEG, WEBP, or ICO.'));
}

const tempBrandingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirectories();
    cb(null, os.tmpdir());
  },
  filename: (_req, _file, cb) => {
    cb(null, `decatone-brand-${crypto.randomUUID()}.tmp`);
  }
});

const uploadLogo = multer({ storage: tempBrandingStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: brandingFileFilter });
const uploadFavicon = multer({ storage: tempBrandingStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: brandingFileFilter });
const uploadNavbarIcon = multer({ storage: tempBrandingStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: brandingFileFilter });

const firmwareStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirectories();
    cb(null, FIRMWARE_DIR);
  },
  filename: (_req, _file, cb) => cb(null, 'firmware_latest.bin')
});
const uploadFirmware = multer({ storage: firmwareStorage, limits: { fileSize: 16 * 1024 * 1024 } });

const restoreUpload = multer({
  dest: path.join(os.tmpdir(), 'decatone-restore'),
  limits: { fileSize: 250 * 1024 * 1024 }
});

export function isDockerEnvironment(): boolean {
  return detectDockerEnvironment();
}

function getGitHubApi(apiPath: string): Promise<any> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: apiPath,
        headers: { 'User-Agent': 'DecaTone-Self-Updater' },
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
          totalSize += fs.statSync(filePath).size;
        } catch {}
      }
    }
  } catch {}
  return totalSize;
}

const ALLOWED_SYSTEM_SETTINGS_KEYS = new Set([
  'app_name',
  'public_base_url',
  'logo_url',
  'favicon_url',
  'icon_url',
  'navbar_icon_url',
  'terms_of_service',
  'privacy_policy',
  'require_terms_on_signup',
  'terms_version',
  'phone_number_length',
  'phone_number_min_length',
  'phone_number_max_length',
  'number_assignment_mode',
  'allow_user_number_choice',
  'area_code_enabled',
  'area_codes_list',
  'default_area_code',
  'tts_engine',
  'tts_voice',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_secure',
  'smtp_allow_self_signed',
  'auto_backup_enabled',
  'auto_backup_interval',
  'auto_backup_time',
  'backup_retention_count',
  'server_auto_update_enabled',
  'server_auto_update_channel',
  'server_auto_update_time',
  'server_auto_update_frequency',
  'update_channel',
  'mqtt_enabled',
  'mqtt_host',
  'mqtt_port',
  'mqtt_user',
  'mqtt_pass',
  'mqtt_ha_pin',
  'ha_rotary_triggers_json',
  'ota_open_download',
  'ota_require_auth',
  'tls_mode',
  'tls_acme_domain',
  'tls_acme_email',
  'tls_acme_staging',
  'tls_local_ca_hosts',
  'trust_proxy',
  'system_timezone',
  'weather_units',
  'weather_location'
]);

function isSafeBrandingUrl(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/branding/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// 1. System Metrics
router.get('/metrics', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const userCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const phoneCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM phones');
    const onlinePhoneCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM phones WHERE is_online = 1');
    const callCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM calls');
    const voicemailCount = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM voicemails');

    let dbSizeBytes = 0;
    try {
      if (fs.existsSync(DB_PATH)) {
        dbSizeBytes = fs.statSync(DB_PATH).size;
      }
    } catch {}

    const uploadsSizeBytes = getDirectorySize(UPLOADS_DIR) + getDirectorySize(BRANDING_DIR);

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
  } catch {
    return res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// 2. User Management Suite
router.get('/users', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await query<any>(
      `SELECT u.id,
              u.username,
              u.display_name,
              u.email,
              u.phone_number,
              u.area_code,
              u.role,
              u.is_disabled,
              u.disabled_reason,
              u.terms_version,
              u.e911_acknowledged_at,
              u.created_at,
              (SELECT p.device_id FROM phones p WHERE p.user_id = u.id ORDER BY p.is_online DESC, p.id ASC LIMIT 1) as device_id,
              COALESCE((SELECT MAX(p.is_online) FROM phones p WHERE p.user_id = u.id), 0) as phone_online,
              (SELECT COUNT(*) FROM phones p WHERE p.user_id = u.id) as phone_count,
              (SELECT p.firmware_version FROM phones p WHERE p.user_id = u.id ORDER BY p.is_online DESC, p.id ASC LIMIT 1) as firmware_version
       FROM users u
       ORDER BY u.id ASC`
    );
    return res.json({ users });
  } catch {
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
  } catch {
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
      'UPDATE users SET is_disabled = ?, disabled_reason = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [isDisabled ? 1 : 0, disabledReason || null, targetId]
    );

    if (isDisabled) {
      await phoneSwitchService.hangupAllForUser(targetId);
    }

    return res.json({ message: isDisabled ? 'User account disabled' : 'User account enabled' });
  } catch {
    return res.status(500).json({ error: 'Failed to update user status' });
  }
});

router.put('/users/:id/reset-password', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const targetId = parseInt(req.params.id, 10);
    const hash = await bcrypt.hash(newPassword, 10);
    const keyBundle = await VoicemailCryptoService.generateUserKeyBundle(newPassword);

    await execute(
      `UPDATE users
       SET password_hash = ?,
           token_version = COALESCE(token_version, 1) + 1,
           encryption_public_key = ?,
           encrypted_private_key = ?,
           key_salt = ?,
           recovery_encrypted_private_key = NULL,
           recovery_key_salt = NULL
       WHERE id = ?`,
      [hash, keyBundle.encryptionPublicKey, keyBundle.encryptedPrivateKey, keyBundle.keySalt, targetId]
    );
    await execute('UPDATE phones SET wrapped_vm_key = NULL WHERE user_id = ?', [targetId]);

    return res.json({ message: 'User password reset successfully (sessions revoked, fresh E2EE keypair provisioned, wrapped phone keys cleared)' });
  } catch {
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.put('/users/:id/phone-number', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phoneNumber, areaCode } = req.body;
    const targetId = parseInt(req.params.id, 10);

    const cleanExt = String(phoneNumber || '').trim();
    if (!cleanExt) return res.status(400).json({ error: 'Phone number required' });

    if (!/^\d+$/.test(cleanExt) || cleanExt.length < 2 || cleanExt.length > 15) {
      return res.status(400).json({ error: 'Phone number must contain 2 to 15 numeric digits' });
    }

    if (isReservedNumberOrPrefix(cleanExt)) {
      return res.status(400).json({
        error: `Extension ${cleanExt} (or its prefix) is reserved for emergency/service/feature lines`
      });
    }

    const cleanArea = areaCode ? String(areaCode).trim() : '';
    const existing = await queryOne(
      "SELECT id FROM users WHERE phone_number = ? AND COALESCE(area_code, '') = ? AND id != ?",
      [cleanExt, cleanArea, targetId]
    );
    if (existing) {
      return res.status(400).json({ error: 'Phone number already assigned to another user in this area code' });
    }

    await execute('UPDATE users SET phone_number = ?, area_code = ? WHERE id = ?', [
      cleanExt,
      cleanArea || null,
      targetId
    ]);
    return res.json({ message: 'User phone number updated' });
  } catch {
    return res.status(500).json({ error: 'Failed to update phone number' });
  }
});

router.delete('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await phoneSwitchService.hangupAllForUser(targetId);

    const vms = await query<any>('SELECT audio_url FROM voicemails WHERE user_id = ?', [targetId]);
    for (const vm of vms) {
      if (vm.audio_url && !String(vm.audio_url).startsWith('data:')) {
        const vmPath = path.join(VOICEMAILS_DIR, path.basename(vm.audio_url));
        try {
          if (fs.existsSync(vmPath)) fs.unlinkSync(vmPath);
        } catch {}
      }
    }

    const greeting = await queryOne<any>('SELECT audio_url FROM voicemail_greetings WHERE user_id = ?', [targetId]);
    if (greeting?.audio_url && !String(greeting.audio_url).startsWith('data:')) {
      const greetPath = path.join(GREETINGS_DIR, path.basename(greeting.audio_url));
      try {
        if (fs.existsSync(greetPath)) fs.unlinkSync(greetPath);
      } catch {}
    }

    const pairedPhones = await query<any>('SELECT device_id FROM phones WHERE user_id = ?', [targetId]);
    await execute(
      `UPDATE phones
       SET user_id = NULL, device_token_hash = NULL, wrapped_vm_key = NULL,
           call_forwarding_enabled = 0, forward_to_number = NULL
       WHERE user_id = ?`,
      [targetId]
    );
    for (const p of pairedPhones) {
      const cl = phoneSwitchService.getPhoneClient(p.device_id);
      if (cl) {
        cl.userId = undefined;
        cl.phoneNumber = undefined;
      }
    }

    await execute('DELETE FROM friend_preferences WHERE user_id = ? OR friend_id = ?', [targetId, targetId]);
    await execute('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [targetId, targetId]);
    await execute('DELETE FROM friend_requests WHERE sender_id = ? OR receiver_id = ?', [targetId, targetId]);
    await execute('DELETE FROM speed_dials WHERE user_id = ? OR target_user_id = ?', [targetId, targetId]);
    await execute('DELETE FROM voicemails WHERE user_id = ?', [targetId]);
    await execute('DELETE FROM voicemail_greetings WHERE user_id = ?', [targetId]);
    await execute('DELETE FROM password_resets WHERE user_id = ?', [targetId]);
    await execute('DELETE FROM users WHERE id = ?', [targetId]);

    return res.json({ message: 'User and associated voicemail/greeting files deleted successfully' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// 3. Hardware Fleet Inspector & Management
router.get('/fleet', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const phones = await query<any>(
      `SELECT p.id, p.device_id, p.user_id, p.phone_label, p.mac_address, p.ip_address, p.firmware_version,
              p.rssi, p.is_online, p.hook_state, p.call_state, p.earpiece_volume, p.mic_sensitivity,
              p.audio_profile, p.sidetone_level, p.ring_style, p.ring_cadence_custom, p.ring_timeout_sec,
              p.hardware_profile, p.bell_frequency_hz, p.intercom_enabled, p.hook_flash_enabled,
              p.call_forwarding_enabled, p.forward_to_number,
              p.ota_auto_update_enabled, p.ota_update_time, p.ota_update_channel,
              p.last_pps, p.last_break_ratio, p.last_noise_floor_db, p.free_heap, p.free_psram,
              p.device_public_key, p.last_seen, p.paired_at, p.created_at,
              u.username as assigned_username, u.display_name as assigned_display_name, u.phone_number as assigned_phone_number
       FROM phones p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.is_online DESC, p.last_seen DESC`
    );
    return res.json({ phones });
  } catch {
    return res.status(500).json({ error: 'Failed to list phone fleet' });
  }
});

router.post('/fleet/:deviceId/test-ring', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const sent = phoneSwitchService.sendTestRing(deviceId);
    if (!sent) return res.status(400).json({ error: 'Device is offline' });
    return res.json({ message: 'Test ring sent to device!' });
  } catch {
    return res.status(500).json({ error: 'Failed to send test ring' });
  }
});

router.post('/fleet/:deviceId/reboot', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const sent = phoneSwitchService.sendRemoteReboot(deviceId);
    if (!sent) return res.status(400).json({ error: 'Device is offline' });
    return res.json({ message: 'Reboot command sent to device!' });
  } catch {
    return res.status(500).json({ error: 'Failed to reboot device' });
  }
});

router.post('/fleet/:deviceId/unpair', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    await execute(
      `UPDATE phones
       SET user_id = NULL, device_token_hash = NULL, wrapped_vm_key = NULL,
           call_forwarding_enabled = 0, forward_to_number = NULL
       WHERE device_id = ?`,
      [deviceId]
    );
    const cl = phoneSwitchService.getPhoneClient(deviceId);
    if (cl) {
      cl.userId = undefined;
      cl.phoneNumber = undefined;
    }
    return res.json({ message: 'Phone unpaired from user' });
  } catch {
    return res.status(500).json({ error: 'Failed to unpair phone' });
  }
});

router.post('/fleet/:deviceId/ota', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const client = phoneSwitchService.getPhoneClient(deviceId);
    if (!client || client.ws.readyState !== 1) {
      return res.status(400).json({ error: 'Device is offline' });
    }

    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const binUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_binary_url"');
    const firmwareVersion = versionRow?.value || '1.3.0';
    const binaryUrl = binUrlRow?.value || '/api/firmware/download/latest';
    const sha256 = await getCachedFirmwareSha256();
    if (!sha256) {
      return res.status(404).json({ error: 'No verified firmware binary available on the server.' });
    }

    phoneSwitchService.sendToDevice(deviceId, {
      type: 'ota_available',
      version: firmwareVersion,
      binaryUrl,
      downloadUrl: binaryUrl,
      sha256
    });
    return res.json({ message: `OTA update (v${firmwareVersion}) dispatched to ${deviceId}`, version: firmwareVersion, sha256 });
  } catch {
    return res.status(500).json({ error: 'Failed to dispatch OTA update to device' });
  }
});

// 4. Firmware OTA Management
router.post('/firmware/upload', uploadFirmware.single('firmware'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No firmware .bin file provided' });
    }

    invalidateFirmwareShaCache();
    const { version } = req.body;
    const fwVersion = version?.trim() || '1.3.0';
    const sha256 = await getCachedFirmwareSha256(req.file.path);

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', fwVersion]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_binary_url', '/api/firmware/download/latest']);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['custom_firmware_override', '1']);

    phoneSwitchService.notifyOtaUpdateAvailable(fwVersion, '/api/firmware/download/latest', sha256);

    return res.json({
      message: `Custom Firmware v${fwVersion} uploaded and activated! Broadcast signal dispatched to connected phones.`,
      version: fwVersion,
      sha256,
      isCustomOverride: true
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Firmware upload failed: ${err.message}` });
  }
});

router.post('/firmware/reset-override', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const customBinPath = path.join(FIRMWARE_DIR, 'firmware_latest.bin');
    try {
      if (fs.existsSync(customBinPath)) fs.unlinkSync(customBinPath);
    } catch {}
    invalidateFirmwareShaCache();

    await execute('DELETE FROM system_settings WHERE key = "custom_firmware_override"');
    const defaultVersion = '1.3.0';
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['firmware_latest_version', defaultVersion]);

    return res.json({
      message: 'Custom firmware binary removed and override cleared.',
      version: defaultVersion,
      isCustomOverride: false
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to reset firmware override: ${err.message}` });
  }
});

// 5. Backups & Restore Suite
router.get('/backups', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    ensureDirectories();
    const files = fs.readdirSync(BACKUPS_DIR);
    const backups = files
      .filter((f) => f.endsWith('.tar.gz') || f.endsWith('.db'))
      .map((f) => {
        const filePath = path.join(BACKUPS_DIR, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          sizeBytes: stat.size,
          created_at: stat.mtime
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.json({ backups });
  } catch {
    return res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.post('/backups/create', async (_req: AuthenticatedRequest, res: Response) => {
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
    const filePath = path.join(BACKUPS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    res.setHeader('Content-Type', filename.endsWith('.tar.gz') ? 'application/gzip' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    return res.status(500).json({ error: 'Failed to download backup' });
  }
});

router.delete('/backups/:filename', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!filename.endsWith('.tar.gz') && !filename.endsWith('.db')) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    const filePath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }
    fs.unlinkSync(filePath);
    return res.json({ message: `Deleted backup '${filename}'` });
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to delete backup: ${err.message}` });
  }
});

router.post('/backups/restore', (req: AuthenticatedRequest, res: Response) => {
  restoreUpload.single('backup_file')(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'Backup upload failed' });
    }

    try {
      let sourcePath = '';
      const filenameParam = req.body.filename;

      if (req.file) {
        sourcePath = req.file.path;
      } else if (filenameParam) {
        sourcePath = path.join(BACKUPS_DIR, path.basename(filenameParam));
      }

      if (!sourcePath || !fs.existsSync(sourcePath)) {
        return res.status(400).json({ error: 'No valid backup file provided' });
      }

      // Safely close live SQLite WAL connection before swapping DB file
      const replaceSqliteDatabaseSafe = async (srcDbFile: string) => {
        await phoneSwitchService.hangupAllActiveCalls();
        await closeDatabase();
        const walPath = `${DB_PATH}-wal`;
        const shmPath = `${DB_PATH}-shm`;
        try { if (fs.existsSync(walPath)) fs.unlinkSync(walPath); } catch {}
        try { if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath); } catch {}
        fs.copyFileSync(srcDbFile, DB_PATH);
        try { if (fs.existsSync(walPath)) fs.unlinkSync(walPath); } catch {}
        try { if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath); } catch {}
        await reopenDatabase();
      };

      const origName = req.file?.originalname || filenameParam || '';
      if (sourcePath.endsWith('.tar.gz') || origName.endsWith('.tar.gz') || (req.file && !origName.endsWith('.db'))) {
        const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decatone-restore-unpack-'));
        try {
          await extractBackupArchiveSafe(sourcePath, unpackDir);

          const restoredDbPath = path.join(unpackDir, 'decatone.db');
          if (fs.existsSync(restoredDbPath)) {
            await replaceSqliteDatabaseSafe(restoredDbPath);
          }

          const restoredBrandingDir = path.join(unpackDir, 'branding');
          if (fs.existsSync(restoredBrandingDir)) {
            ensureDirectories();
            fs.cpSync(restoredBrandingDir, BRANDING_DIR, { recursive: true, dereference: false });
          }

          const restoredUploadsDir = path.join(unpackDir, 'uploads');
          if (fs.existsSync(restoredUploadsDir)) {
            ensureDirectories();
            fs.cpSync(restoredUploadsDir, UPLOADS_DIR, { recursive: true, dereference: false });
          }
        } finally {
          try {
            fs.rmSync(unpackDir, { recursive: true, force: true });
          } catch {}
        }
      } else if (sourcePath.endsWith('.db') || origName.endsWith('.db')) {
        await replaceSqliteDatabaseSafe(sourcePath);
      }

      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }

      await runMigrations();
      await tlsManagerService.applyTrustProxy(req.app as any);
      await homeAssistantMqttService.reloadFromSettings();

      return res.json({
        success: true,
        message: 'System backup restored cleanly! Database, custom branding, and sealed voicemails have been restored.'
      });
    } catch (err: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      try { await reopenDatabase(); } catch {}
      return res.status(500).json({ error: `Restore failed: ${err.message}` });
    }
  });
});

router.get('/backups/settings', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any>(
      'SELECT key, value FROM system_settings WHERE key IN ("auto_backup_enabled", "auto_backup_interval", "auto_backup_time", "backup_retention_count")'
    );
    const map: Record<string, string> = {};
    rows.forEach((r) => { map[r.key] = r.value; });

    return res.json({
      autoBackupEnabled: map['auto_backup_enabled'] === 'true',
      autoBackupInterval: map['auto_backup_interval'] || 'daily',
      autoBackupTime: map['auto_backup_time'] || '02:00',
      backupRetentionCount: parseInt(map['backup_retention_count'] || '10', 10)
    });
  } catch {
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
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['auto_backup_interval', String(autoBackupInterval)]);
    }
    if (autoBackupTime) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['auto_backup_time', String(autoBackupTime)]);
    }
    if (backupRetentionCount !== undefined) {
      const count = Math.max(1, parseInt(String(backupRetentionCount), 10) || 10);
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['backup_retention_count', String(count)]);
      purgeExcessBackups(count);
    }

    return res.json({ message: 'Backup and retention settings updated successfully!' });
  } catch {
    return res.status(500).json({ error: 'Failed to update backup settings' });
  }
});

// 6. Self-Updater & Release Channels (15-min GitHub API cache)
router.get('/update/check', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const forceRefresh = req.query.force === '1' || req.query.force === 'true';
    const channelRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "update_channel"');
    const channel = channelRow?.value || 'stable';

    const installedVersionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "installed_version"');
    const installedVersion = installedVersionRow?.value || '1.3.0';

    let targetVersion = installedVersion;
    let latestReleaseInfo: any = null;

    const cached = githubUpdateCache.get(channel);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < UPDATE_CACHE_TTL_MS) {
      targetVersion = cached.payload.targetVersion || installedVersion;
      latestReleaseInfo = cached.payload.latestReleaseInfo;
    } else {
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

      if (latestReleaseInfo) {
        githubUpdateCache.set(channel, {
          fetchedAt: Date.now(),
          payload: { targetVersion, latestReleaseInfo }
        });
      }
    }

    const normalize = (v: string) => (v ? v.replace(/^v/i, '').trim().toLowerCase() : '');
    const normTarget = normalize(targetVersion);
    const normInstalled = normalize(installedVersion);

    const semverGT = (a: string, b: string) => {
      const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
      const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return true;
        if (na < nb) return false;
      }
      return false;
    };

    const updateAvailable =
      normTarget !== '' && (channel === 'alpha' ? normInstalled !== normTarget : semverGT(normTarget, normInstalled));
    const isDocker = isDockerEnvironment();

    return res.json({
      currentVersion: installedVersion,
      targetVersion,
      channel,
      updateAvailable,
      isDocker,
      dockerImage: CANONICAL_DOCKER_IMAGE,
      latestRelease: latestReleaseInfo || {
        tag: targetVersion,
        name: `DecaTone ${targetVersion}`,
        notes: 'You are running the latest version.'
      }
    });
  } catch {
    return res.status(500).json({ error: 'Failed to check for updates' });
  }
});

router.get('/update/settings', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any>(
      'SELECT key, value FROM system_settings WHERE key IN ("server_auto_update_enabled", "server_auto_update_channel", "server_auto_update_time", "server_auto_update_frequency")'
    );
    const map: Record<string, string> = {};
    rows.forEach((r) => { map[r.key] = r.value; });

    return res.json({
      autoUpdateEnabled: map['server_auto_update_enabled'] === 'true',
      autoUpdateChannel: map['server_auto_update_channel'] || 'stable',
      autoUpdateTime: map['server_auto_update_time'] || '03:00',
      autoUpdateFrequency: map['server_auto_update_frequency'] || 'daily',
      isDocker: isDockerEnvironment(),
      dockerImage: CANONICAL_DOCKER_IMAGE
    });
  } catch {
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
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_channel', String(autoUpdateChannel)]);
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['update_channel', String(autoUpdateChannel)]);
    }
    if (autoUpdateTime) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_time', String(autoUpdateTime)]);
    }
    if (autoUpdateFrequency) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['server_auto_update_frequency', String(autoUpdateFrequency)]);
    }

    return res.json({ message: 'Server auto-update settings saved!' });
  } catch {
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
    githubUpdateCache.delete(channel);
    return res.json({ message: `Update channel set to ${channel}` });
  } catch {
    return res.status(500).json({ error: 'Failed to update channel' });
  }
});

router.post('/update/apply', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (isDockerEnvironment()) {
      return res.status(400).json({
        isDocker: true,
        dockerImage: CANONICAL_DOCKER_IMAGE,
        error: `DecaTone is running inside a Docker container. In-app git updates are disabled. Please pull the updated container image: docker pull ${CANONICAL_DOCKER_IMAGE} && docker compose up -d`
      });
    }

    const { targetVersion } = req.body || {};
    const channelRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = "update_channel"'
    );
    const channel = channelRow?.value || 'stable';

    await performGitAndBuildUpdate(channel, targetVersion);
    await runMigrations();

    if (targetVersion) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['installed_version', String(targetVersion)]);
    }

    setTimeout(() => {
      console.log('[Self-Updater] Restarting service to apply updates...');
      process.exit(0);
    }, 1200).unref();

    return res.json({ message: 'Update applied! DecaTone is restarting now (please refresh your browser in 5 seconds).' });
  } catch (err: any) {
    return res.status(500).json({ error: `Update aborted (no version state altered): ${err.message}` });
  }
});

// 7. Branding & Icons Management (exact MIME extension preservation — blocks SVG/HTML XSS!)
async function handleVerifiedBrandingUpload(
  req: AuthenticatedRequest,
  res: Response,
  slotName: string,
  settingKey: string,
  label: string
) {
  if (!req.file) {
    return res.status(400).json({ error: `No ${label} image file provided` });
  }

  try {
    const headerBuf = Buffer.alloc(16);
    const fd = fs.openSync(req.file.path, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, headerBuf, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }

    const format = detectBrandingImageFormat(headerBuf.subarray(0, bytesRead));
    if (!format) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        error: `Invalid ${label} file signature. Only genuine PNG, JPEG, WEBP, or ICO images are permitted.`
      });
    }

    ensureDirectories();
    const destFilename = `${slotName}.${format}`;
    for (const oldExt of ['png', 'jpg', 'webp', 'ico']) {
      if (oldExt !== format) {
        const stalePath = path.join(BRANDING_DIR, `${slotName}.${oldExt}`);
        try { if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath); } catch {}
      }
    }

    const finalDest = path.join(BRANDING_DIR, destFilename);
    fs.copyFileSync(req.file.path, finalDest);
    try { fs.unlinkSync(req.file.path); } catch {}

    const publicUrl = `/branding/${destFilename}?v=${Date.now()}`;
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [settingKey, publicUrl]);

    return res.json({
      message: `${label} uploaded successfully!`,
      url: publicUrl,
      ...(settingKey === 'logo_url' ? { logoUrl: publicUrl } : {}),
      ...(settingKey === 'favicon_url' ? { faviconUrl: publicUrl } : {}),
      ...(settingKey === 'navbar_icon_url' ? { navbarIconUrl: publicUrl } : {})
    });
  } catch {
    try { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({ error: `Failed to upload ${label}` });
  }
}

router.post('/branding/logo', (req: AuthenticatedRequest, res: Response) => {
  uploadLogo.single('logo')(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid logo file' });
    handleVerifiedBrandingUpload(req, res, 'logo', 'logo_url', 'Branding logo');
  });
});

router.post('/branding/favicon', (req: AuthenticatedRequest, res: Response) => {
  uploadFavicon.single('favicon')(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid favicon file' });
    handleVerifiedBrandingUpload(req, res, 'favicon', 'favicon_url', 'Favicon');
  });
});

router.post('/branding/navbar-icon', (req: AuthenticatedRequest, res: Response) => {
  uploadNavbarIcon.single('navbar_icon')(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid navbar icon file' });
    handleVerifiedBrandingUpload(req, res, 'navbar_icon', 'navbar_icon_url', 'Navbar icon');
  });
});

router.post('/branding/reset', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await execute('DELETE FROM system_settings WHERE key IN ("logo_url", "favicon_url", "navbar_icon_url", "icon_url")');
    if (fs.existsSync(BRANDING_DIR)) {
      const files = fs.readdirSync(BRANDING_DIR);
      for (const f of files) {
        try { fs.unlinkSync(path.join(BRANDING_DIR, f)); } catch {}
      }
    }
    return res.json({ message: 'All branding assets reset to default!' });
  } catch {
    return res.status(500).json({ error: 'Failed to reset branding assets' });
  }
});

// Broadcast OTA Update to Connected ESP32 Phones
router.post('/firmware/ota-broadcast', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const binUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_binary_url"');

    const firmwareVersion = versionRow?.value || '1.3.0';
    const binaryUrl = binUrlRow?.value || '/api/firmware/download/latest';
    const sha256 = await getCachedFirmwareSha256();
    if (!sha256) {
      return res.status(404).json({ error: 'No verified firmware binary uploaded to broadcast.' });
    }

    const onlineDevices = await query<any>('SELECT device_id FROM phones WHERE is_online = 1');
    let dispatched = 0;

    for (const d of onlineDevices) {
      phoneSwitchService.sendToDevice(d.device_id, {
        type: 'ota_available',
        version: firmwareVersion,
        binaryUrl,
        downloadUrl: binaryUrl,
        sha256
      });
      dispatched++;
    }

    return res.json({
      message: `OTA update signal dispatched to ${dispatched} online phone(s)!`,
      count: dispatched,
      firmwareVersion,
      sha256
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

    const baseUrl = await getSafePublicBaseUrl(req);
    const result = await EmailService.sendTestEmail(recipient, baseUrl);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json({ success: true, message: result.message });
  } catch (err: any) {
    return res.status(500).json({ error: `SMTP test error: ${err.message}` });
  }
});

// 8. Dual Local TTS Management (Piper + Optional Kokoro + eSpeak-NG)
router.get('/tts', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await TtsAudioService.getTtsStatus();
    return res.json(status);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to inspect TTS engine status' });
  }
});

router.put(['/tts', '/tts/settings'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const voiceId = req.body.voiceId || req.body.voice;
    const engine = req.body.engine;
    if (!voiceId && !engine) {
      return res.status(400).json({ error: 'voiceId or engine is required' });
    }

    const saved = await TtsAudioService.setPreferredConfig({
      engine: engine ? String(engine) : undefined,
      voiceId: voiceId ? String(voiceId) : undefined
    });
    const status = await TtsAudioService.getTtsStatus();
    return res.json({
      message: `System TTS configured (${saved.engine} / ${saved.voiceId})`,
      ...status
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update TTS settings' });
  }
});

router.post('/tts/download', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const voiceId = req.body.voiceId || req.body.voice;
    const engine = req.body.engine;
    const result = TtsAudioService.startEngineOrVoiceDownload({
      engine: engine ? String(engine) : undefined,
      voiceId: voiceId ? String(voiceId) : undefined
    });
    const status = await TtsAudioService.getTtsStatus();
    return res.status(result.started ? 202 : 200).json({
      message: result.downloadState.message || 'TTS download started.',
      ...result,
      ...status
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to download TTS model' });
  }
});

router.get('/tts/download-status', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await TtsAudioService.getTtsStatus();
    return res.json(status);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to poll TTS download status' });
  }
});

router.post('/tts/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const text = String(
      req.body.text || 'DecaTone central office operator test. At the third stroke, your telephone line is ready.'
    )
      .trim()
      .slice(0, 400);
    const rawVoice = req.body.voiceId || req.body.voice || req.body.voiceModel || req.body.model;
    const voiceId = rawVoice ? String(rawVoice).trim() : undefined;
    const rawEngine = req.body.engine ? String(req.body.engine).trim().toLowerCase() : undefined;
    const overrideEngine =
      rawEngine && ['piper', 'kokoro', 'espeak', 'procedural'].includes(rawEngine)
        ? (rawEngine as TtsEngineType)
        : undefined;

    const wavBuffer = await TtsAudioService.synthesizeWav(text, voiceId, { overrideEngine });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', wavBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(wavBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to synthesize voice preview' });
  }
});

// 9. Numbering Policy / Dial-Plan Management
router.get('/dial-plan', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await getPhoneConfig();
    return res.json({
      phoneNumberMinLength: config.minNumberLength,
      phoneNumberMaxLength: config.maxNumberLength,
      numberAssignmentMode: config.assignmentMode,
      allowUserChoice: config.allowUserChoice,
      areaCodeEnabled: config.areaCodeEnabled,
      areaCodesList: config.allowedAreaCodes.join(','),
      defaultAreaCode: config.defaultAreaCode || '555',
      config
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load dial-plan configuration' });
  }
});

router.put('/dial-plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      phoneNumberMinLength,
      phoneNumberMaxLength,
      numberAssignmentMode,
      areaCodeEnabled,
      areaCodesList,
      defaultAreaCode
    } = req.body;

    const current = await getPhoneConfig();
    const minLen =
      phoneNumberMinLength !== undefined ? parseInt(String(phoneNumberMinLength), 10) : current.minNumberLength;
    const maxLen =
      phoneNumberMaxLength !== undefined ? parseInt(String(phoneNumberMaxLength), 10) : current.maxNumberLength;

    if (isNaN(minLen) || isNaN(maxLen) || minLen < 2 || maxLen > 15 || minLen > maxLen) {
      return res.status(400).json({
        error: 'Extension length bounds must satisfy 2 <= minLength <= maxLength <= 15'
      });
    }

    const mode = String(numberAssignmentMode || current.assignmentMode);
    if (!['user_choice', 'fixed_random', 'sequential'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid numberAssignmentMode' });
    }

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_length', String(minLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_min_length', String(minLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['phone_number_max_length', String(maxLen)]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['number_assignment_mode', mode]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
      'allow_user_number_choice',
      mode === 'user_choice' ? 'true' : 'false'
    ]);

    if (areaCodeEnabled !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
        'area_code_enabled',
        areaCodeEnabled ? 'true' : 'false'
      ]);
    }
    if (areaCodesList !== undefined) {
      const cleanedCodes = String(areaCodesList)
        .split(',')
        .map((c) => c.trim())
        .filter((c) => /^\d{2,5}$/.test(c))
        .join(',');
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
        'area_codes_list',
        cleanedCodes || '555'
      ]);
    }
    if (defaultAreaCode !== undefined) {
      const cleanDef = String(defaultAreaCode).trim();
      if (cleanDef && !/^\d{2,5}$/.test(cleanDef)) {
        return res.status(400).json({ error: 'Default area code must be 2 to 5 digits' });
      }
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['default_area_code', cleanDef || '555']);
    }

    const updated = await getPhoneConfig();
    return res.json({
      message: 'Dial-plan and numbering policy saved!',
      config: updated
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to save dial-plan settings' });
  }
});

// 10. Unified TLS Manager Endpoints & Legacy Status Diagnostic Endpoint
router.get(['/tls', '/ssl-status'], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await tlsManagerService.getStatus(req);
    return res.json({
      ...status,
      webCryptoSecureContextReady: status.isHttps || req.hostname === 'localhost' || req.hostname === '127.0.0.1'
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to query TLS status' });
  }
});

router.put('/tls', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await tlsManagerService.updateConfig(req.body || {});
    return res.json({
      message: status.restartRequired
        ? 'TLS settings updated! Restart DecaTone to switch active HTTP/HTTPS transport.'
        : 'TLS & proxy configuration saved and applied.',
      status
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to save TLS settings' });
  }
});

router.post('/tls/acme/renew', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const map = await tlsManagerService.getSettingsMap();
    const domain = req.body?.domain ?? map['tls_acme_domain'];
    const email = req.body?.email ?? map['tls_acme_email'];
    const staging = req.body?.staging ?? (map['tls_acme_staging'] === 'true');
    const result = await tlsManagerService.obtainOrRenewAcmeCertificate({
      domain,
      email,
      staging,
      force: true
    });
    const status = await tlsManagerService.getStatus(req);
    return res.json({ ...result, status });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'ACME renewal failed' });
  }
});

router.post('/tls/local-ca/regenerate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const map = await tlsManagerService.getSettingsMap();
    const customHosts = req.body?.localCaHosts ?? map['tls_local_ca_hosts'];
    const regenerated = tlsManagerService.regenerateLocalCa(customHosts);
    const status = await tlsManagerService.getStatus(req);
    return res.json({
      message: 'Local Root CA and SAN leaf certificate regenerated!',
      fingerprintSha256: regenerated.fingerprintSha256,
      hosts: regenerated.hosts,
      status
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to regenerate Local CA' });
  }
});

router.post('/system/restart', async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ message: 'Restarting DecaTone server process...' });
  setTimeout(() => process.exit(0), 600).unref();
});

// 11. Factory Reset / System Wipe (also tears down active calls, MQTT, rotates JWT secret & clears cookie)
router.post('/system/wipe', async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('EXECUTING DECATONE SYSTEM FACTORY RESET...');
    await phoneSwitchService.resetAllRuntimeState();
    homeAssistantMqttService.disconnect();
    tlsManagerService.stopAcmeChallengeHttpServer();

    await execute('DELETE FROM friend_preferences');
    await execute('DELETE FROM friends');
    await execute('DELETE FROM friend_requests');
    await execute('DELETE FROM speed_dials');
    await execute('DELETE FROM calls');
    await execute('DELETE FROM voicemails');
    await execute('DELETE FROM voicemail_greetings');
    await execute('DELETE FROM password_resets');
    await execute('DELETE FROM pending_device_enrollments');
    await execute('DELETE FROM phones');
    await execute('DELETE FROM users');
    await execute('DELETE FROM system_settings');
    await execute('DELETE FROM schema_migrations');

    if (fs.existsSync(UPLOADS_DIR)) {
      try {
        for (const file of fs.readdirSync(UPLOADS_DIR)) {
          fs.rmSync(path.join(UPLOADS_DIR, file), { recursive: true, force: true });
        }
      } catch {}
    }

    if (fs.existsSync(BRANDING_DIR)) {
      try {
        for (const file of fs.readdirSync(BRANDING_DIR)) {
          fs.rmSync(path.join(BRANDING_DIR, file), { recursive: true, force: true });
        }
      } catch {}
    }

    ensureDirectories();
    await runMigrations();
    await tlsManagerService.applyTrustProxy(req.app as any);
    rotateJwtSecret();

    const opts = getSessionCookieOptions(req);
    res.clearCookie('token', {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite
    });

    return res.json({
      success: true,
      message: 'DecaTone wiped cleanly! Sessions revoked and setup wizard reset.'
    });
  } catch (err: any) {
    return res.status(500).json({ error: `System wipe failed: ${err.message}` });
  }
});

// Home Assistant MQTT Integration Settings
router.get('/mqtt', async (_req: AuthenticatedRequest, res: Response) => {
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
  } catch {
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
      pass: pass !== undefined && pass !== '••••••••' ? pass : undefined,
      pin: pin || '512'
    });
    return res.json({ message: 'Home Assistant MQTT integration settings saved and applied!' });
  } catch {
    return res.status(500).json({ error: 'Failed to update MQTT settings' });
  }
});

// General Admin System Settings (validates branding URLs, dial-plan bounds, timezone, HA triggers, MQTT reconnect)
router.get('/settings', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any>('SELECT key, value FROM system_settings');
    const settingsMap: Record<string, string> = {};
    for (const r of rows) {
      if ((r.key === 'smtp_pass' || r.key === 'mqtt_pass') && r.value) {
        settingsMap[r.key] = '••••••••';
      } else {
        settingsMap[r.key] = r.value;
      }
    }
    return res.json({ settings: settingsMap });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch admin settings' });
  }
});

router.post('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object is required' });
    }

    // Validate URLs & constrained fields before mutating DB
    for (const urlKey of ['logo_url', 'favicon_url', 'navbar_icon_url', 'icon_url']) {
      if (urlKey in settings && settings[urlKey] !== undefined && settings[urlKey] !== null) {
        if (!isSafeBrandingUrl(String(settings[urlKey]))) {
          return res.status(400).json({ error: `Invalid URL scheme for ${urlKey}. Must start with /branding/ or https://` });
        }
      }
    }

    if ('system_timezone' in settings && settings.system_timezone) {
      try {
        Intl.DateTimeFormat('en-US', { timeZone: String(settings.system_timezone).trim() });
      } catch {
        return res.status(400).json({ error: `Invalid IANA timezone: ${settings.system_timezone}` });
      }
    }

    if ('weather_units' in settings && settings.weather_units && !['imperial', 'metric'].includes(String(settings.weather_units))) {
      return res.status(400).json({ error: 'weather_units must be imperial or metric' });
    }

    if ('ha_rotary_triggers_json' in settings && settings.ha_rotary_triggers_json) {
      try {
        const parsed = typeof settings.ha_rotary_triggers_json === 'string'
          ? JSON.parse(settings.ha_rotary_triggers_json)
          : settings.ha_rotary_triggers_json;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return res.status(400).json({ error: 'ha_rotary_triggers_json must be a JSON object mapping dial codes to labels' });
        }
      } catch {
        return res.status(400).json({ error: 'Malformed JSON in ha_rotary_triggers_json' });
      }
    }

    // Validate dial-plan bounds if any dial-plan keys are submitted in bulk
    if ('phone_number_min_length' in settings || 'phone_number_max_length' in settings || 'phone_number_length' in settings) {
      const currentCfg = await getPhoneConfig();
      const minLen = settings.phone_number_min_length !== undefined
        ? parseInt(String(settings.phone_number_min_length), 10)
        : settings.phone_number_length !== undefined
        ? parseInt(String(settings.phone_number_length), 10)
        : currentCfg.minNumberLength;
      const maxLen = settings.phone_number_max_length !== undefined
        ? parseInt(String(settings.phone_number_max_length), 10)
        : currentCfg.maxNumberLength;
      if (isNaN(minLen) || isNaN(maxLen) || minLen < 2 || maxLen > 15 || minLen > maxLen) {
        return res.status(400).json({ error: 'Extension length bounds must satisfy 2 <= minLength <= maxLength <= 15' });
      }
    }

    const existingLegalRows = await query<{ key: string; value: string }>(
      "SELECT key, value FROM system_settings WHERE key IN ('terms_of_service', 'privacy_policy')"
    );
    const prevLegal: Record<string, string> = {};
    for (const r of existingLegalRows) prevLegal[r.key] = r.value;

    let legalChanged = false;
    let mqttChanged = false;
    let trustProxyChanged = false;

    for (const [key, rawValue] of Object.entries(settings)) {
      if (!ALLOWED_SYSTEM_SETTINGS_KEYS.has(key)) {
        continue;
      }
      const strVal =
        rawValue === null || rawValue === undefined
          ? ''
          : typeof rawValue === 'object'
          ? JSON.stringify(rawValue)
          : String(rawValue);

      if ((key === 'smtp_pass' || key === 'mqtt_pass') && strVal === '••••••••') {
        continue;
      }
      if ((key === 'terms_of_service' || key === 'privacy_policy') && strVal !== (prevLegal[key] || '')) {
        legalChanged = true;
      }
      if (key.startsWith('mqtt_')) mqttChanged = true;
      if (key === 'trust_proxy') trustProxyChanged = true;

      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [key, strVal]);
    }

    if (mqttChanged) {
      homeAssistantMqttService.reloadFromSettings().catch(console.error);
    }
    if (trustProxyChanged) {
      await tlsManagerService.applyTrustProxy(req.app as any);
    }

    let bumpedTermsVersion: string | undefined;
    if (legalChanged && !('terms_version' in settings)) {
      const datePart = new Date().toISOString().slice(0, 10);
      const hashPart = crypto
        .createHash('sha256')
        .update(`${settings.terms_of_service ?? prevLegal.terms_of_service ?? ''}|${settings.privacy_policy ?? prevLegal.privacy_policy ?? ''}`)
        .digest('hex')
        .slice(0, 6);
      bumpedTermsVersion = `${datePart}.${hashPart}`;
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['terms_version', bumpedTermsVersion]);
    }

    return res.json({
      success: true,
      ...(bumpedTermsVersion ? { termsVersion: bumpedTermsVersion } : {}),
      message: 'System settings saved successfully!'
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to save system settings' });
  }
});

export default router;
