import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import {
  BRANDING_DIR,
  DEFAULT_ASSETS_DIR,
  FIRMWARE_DIR,
  FRONTEND_DIST_DIR,
  REPO_ROOT,
  ensureDirectories
} from './config/paths';
import { runMigrations } from './db/migrations';
import { query, queryOne, execute } from './db/connection';
import { authenticateWebSocketRequest } from './middleware/authMiddleware';
import { phoneSwitchService, verifyDeviceToken } from './services/phoneSwitchService';
import { initBackupScheduler } from './services/backupScheduler';
import { initAutoUpdateScheduler } from './services/autoUpdateScheduler';
import { homeAssistantMqttService } from './services/homeAssistantMqttService';
import { tlsManagerService } from './services/tlsManagerService';
import { getCachedFirmwareSha256, invalidateFirmwareShaCache } from './services/firmwareCache';

export { getCachedFirmwareSha256, invalidateFirmwareShaCache };

import authRoutes from './routes/authRoutes';
import phoneRoutes from './routes/phoneRoutes';
import friendRoutes from './routes/friendRoutes';
import voicemailRoutes from './routes/voicemailRoutes';
import adminRoutes from './routes/adminRoutes';
import setupRoutes from './routes/setupRoutes';
import legalRoutes from './routes/legalRoutes';

const app = express();
const PORT = process.env.PORT || 4000;

ensureDirectories();
tlsManagerService.bindApp(app);

// Default trust_proxy to false until DB settings load (prevents X-Forwarded-For spoofing on direct Docker/host)
app.set('trust proxy', tlsManagerService.applyTrustProxy ? false : false);

// ACME HTTP-01 challenge handler before auth/CORS
app.use(tlsManagerService.acmeChallengeMiddleware());

// Hardened CORS Policy (instantiated once; never reflects credentials for literal '*')
const rawCorsList = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (rawCorsList.includes('*')) {
  console.warn('[Security] Ignoring wildcard CORS_ORIGIN=* because authenticated cookies require explicit origins.');
}

const configuredCorsOrigins = new Set(rawCorsList.filter((o) => o !== '*'));

app.use(
  cors((req, callback) => {
    const reqOrigin = req.headers.origin;
    if (!reqOrigin) {
      return callback(null, { origin: true, credentials: true });
    }
    if (configuredCorsOrigins.has(reqOrigin)) {
      return callback(null, { origin: true, credentials: true });
    }
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, { origin: true, credentials: true });
    }
    try {
      const originHost = new URL(reqOrigin).host.toLowerCase();
      const reqHost = String(req.headers.host || '').toLowerCase();
      if (reqHost && originHost === reqHost) {
        return callback(null, { origin: true, credentials: true });
      }
    } catch {}
    return callback(null, { origin: false, credentials: false });
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Anti-Caching Headers on dynamic /api/* and HTML shell responses (preserving immutable cache on Vite hashed /assets/*)
app.use((req, res, next) => {
  if (!req.path.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, post-check=0, pre-check=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

const BRANDING_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

// Serve Custom or Default Branding Assets Safely (async stat + exact MIME type)
app.use('/branding', async (req, res, next) => {
  const safeName = path.basename(req.path || '');
  if (!safeName || safeName === '/' || safeName === '.' || safeName === '..') {
    return res.status(404).send('Not found');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");

  const sendWithMime = (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    const mime = BRANDING_MIME_TYPES[ext];
    if (mime) {
      res.setHeader('Content-Type', mime);
    }
    return res.sendFile(filePath);
  };

  try {
    const fileInCustom = path.join(BRANDING_DIR, safeName);
    const stCustom = await fs.promises.stat(fileInCustom);
    if (stCustom.isFile()) return sendWithMime(fileInCustom);
  } catch {}

  try {
    const fileInDefault = path.join(DEFAULT_ASSETS_DIR, safeName);
    const stDefault = await fs.promises.stat(fileInDefault);
    if (stDefault.isFile()) return sendWithMime(fileInDefault);
  } catch {}

  try {
    const fallbackLogo = path.join(DEFAULT_ASSETS_DIR, 'logo.png');
    const stFallback = await fs.promises.stat(fallbackLogo);
    if (stFallback.isFile()) return sendWithMime(fallbackLogo);
  } catch {}

  next();
});

// Public TLS / Local Root CA Download & Info (for Browsers & ESP32 Provisioning)
app.get('/api/tls/ca.crt', (_req, res) => {
  const caInfo = tlsManagerService.getLocalCaInfo();
  if (!caInfo.initialized || !caInfo.pem) {
    return res.status(404).send('Local CA certificate is not initialized');
  }
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="decatone-local-ca.crt"');
  return res.send(caInfo.pem);
});

app.get('/api/tls/info', async (req, res) => {
  try {
    const mode = await tlsManagerService.getEffectiveMode();
    const localCa = tlsManagerService.getLocalCaInfo();
    return res.json({
      tlsMode: mode,
      hasLocalCa: localCa.initialized,
      localCaFingerprintSha256: localCa.fingerprintSha256,
      caDownloadUrl: localCa.initialized ? '/api/tls/ca.crt' : null,
      protocol: req.protocol
    });
  } catch {
    return res.status(500).json({ error: 'Failed to read TLS info' });
  }
});

// Public Branding Configuration Endpoint
app.get('/api/branding/public', async (_req, res) => {
  try {
    const rows = await query<any>(
      'SELECT key, value FROM system_settings WHERE key IN ("app_name", "logo_url", "favicon_url", "icon_url", "navbar_icon_url")'
    );
    const map: Record<string, string> = {};
    rows.forEach((r) => {
      map[r.key] = r.value;
    });

    return res.json({
      app_name: map['app_name'] || 'DecaTone',
      logo_url: map['logo_url'] || '/branding/logo.png',
      favicon_url: map['favicon_url'] || '/branding/favicon.png',
      icon_url: map['icon_url'] || '/branding/icon.png',
      navbar_icon_url: map['navbar_icon_url'] || '/branding/navbar_icon.png'
    });
  } catch {
    return res.json({
      app_name: 'DecaTone',
      logo_url: '/branding/logo.png',
      favicon_url: '/branding/favicon.png',
      icon_url: '/branding/icon.png',
      navbar_icon_url: '/branding/navbar_icon.png'
    });
  }
});

// Dynamic Web App Manifest
app.get(['/manifest.json', '/api/manifest.json'], async (_req, res) => {
  try {
    const appNameRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "app_name"');
    const logoUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "logo_url"');

    const appName = appNameRow?.value || 'DecaTone';
    const logoUrl = logoUrlRow?.value || '/branding/logo.png';

    res.setHeader('Content-Type', 'application/json');
    return res.json({
      short_name: appName,
      name: `${appName} Telephone Switch`,
      icons: [
        { src: logoUrl, type: 'image/png', sizes: '192x192', purpose: 'any maskable' },
        { src: logoUrl, type: 'image/png', sizes: '512x512', purpose: 'any maskable' }
      ],
      start_url: '/',
      background_color: '#0d1117',
      theme_color: '#0ea5e9',
      display: 'standalone',
      orientation: 'portrait'
    });
  } catch {
    return res.json({
      short_name: 'DecaTone',
      name: 'DecaTone Telephone Switch',
      icons: [{ src: '/branding/logo.png', type: 'image/png', sizes: '192x192', purpose: 'any maskable' }],
      start_url: '/',
      display: 'standalone'
    });
  }
});

// Health Check with Reverse Proxy & Protocol Diagnostic Info
app.get('/api/health', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers.host;

  res.json({
    status: 'ok',
    service: 'DecaTone Backend API & Telephone Switchboard',
    detectedProtocol: protocol,
    detectedHost: host,
    isBehindProxy: !!req.headers['x-forwarded-proto'],
    timestamp: new Date()
  });
});

// ESP32-S3 Firmware OTA Info & Authenticated Download Endpoints
app.get('/api/firmware/info', async (_req, res) => {
  try {
    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const overrideRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "custom_firmware_override"');
    const binPath = path.join(FIRMWARE_DIR, 'firmware_latest.bin');
    const sha256 = await getCachedFirmwareSha256(binPath);
    const exists = sha256 !== null;

    return res.json({
      version: versionRow?.value || '1.3.0',
      hasBinary: exists,
      sha256,
      isCustomOverride: overrideRow?.value === '1',
      downloadUrl: exists ? '/api/firmware/download/latest' : null
    });
  } catch {
    return res.status(500).json({ error: 'Failed to query firmware info' });
  }
});

app.get('/api/firmware/download/latest', async (req, res) => {
  try {
    const binPath = path.join(FIRMWARE_DIR, 'firmware_latest.bin');
    const sha256 = await getCachedFirmwareSha256(binPath);
    if (!sha256) {
      return res.status(404).send('No firmware binary uploaded');
    }

    // 1. Check authenticated web user session (Cookie: token or Authorization: Bearer <jwt>)
    const authUser = await authenticateWebSocketRequest(req);
    let authorized = !!authUser;

    // 2. Check hardware X-Device-Token or Authorization: Bearer <deviceToken>
    const headerDevToken = typeof req.headers['x-device-token'] === 'string' ? req.headers['x-device-token'].trim() : '';
    const authHeader = typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : '';
    const bearerCandidate = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    const providedDeviceToken = headerDevToken || (!authorized ? bearerCandidate : '');

    if (!authorized && providedDeviceToken) {
      const tokenRows = await query<{ device_token_hash: string }>(
        'SELECT device_token_hash FROM phones WHERE device_token_hash IS NOT NULL'
      );
      for (const row of tokenRows) {
        if (verifyDeviceToken(providedDeviceToken, row.device_token_hash)) {
          authorized = true;
          break;
        }
      }
      if (!authorized) {
        return res.status(401).json({ error: 'Invalid device token or session' });
      }
    }

    // 3. Only permit unauthenticated firmware downloads when ota_open_download is explicitly enabled
    if (!authorized) {
      const requireAuthRow = await queryOne<{ value: string }>(
        'SELECT value FROM system_settings WHERE key = "ota_require_auth"'
      );
      const openDownloadRow = await queryOne<{ value: string }>(
        'SELECT value FROM system_settings WHERE key = "ota_open_download"'
      );

      if (requireAuthRow?.value !== 'true' && openDownloadRow?.value === 'true') {
        authorized = true;
      }
    }

    if (!authorized) {
      return res.status(401).json({ error: 'Authentication or valid X-Device-Token required to download firmware' });
    }

    res.setHeader('X-Firmware-SHA256', sha256);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="firmware.bin"');
    fs.createReadStream(binPath).pipe(res);
  } catch {
    return res.status(500).send('Failed to serve firmware binary');
  }
});

// API Routes
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/phone', phoneRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/voicemail', voicemailRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/legal', legalRoutes);

// Serve Frontend Static Files in production if built
if (fs.existsSync(FRONTEND_DIST_DIR)) {
  app.use(
    '/assets',
    express.static(path.join(FRONTEND_DIST_DIR, 'assets'), {
      etag: true,
      lastModified: true,
      maxAge: '365d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    })
  );

  app.use(
    express.static(FRONTEND_DIST_DIR, {
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
      }
    })
  );

  app.get('*', (req, res) => {
    if (
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/uploads') &&
      !req.path.startsWith('/branding') &&
      !req.path.startsWith('/assets') &&
      !req.path.startsWith('/ws')
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
    } else {
      res.status(404).send('Asset not found');
    }
  });
}

// Start Server
async function startServer() {
  try {
    await runMigrations();
    const trustProxyEffective = await tlsManagerService.applyTrustProxy(app);

    // Initialize Automated Scheduled Database Backups & Idle Auto-Updater
    initBackupScheduler();
    initAutoUpdateScheduler();

    // Auto-sync DB installed_version with root package.json version (unless tracking alpha commit SHA)
    try {
      const rootPkgPath = path.join(REPO_ROOT, 'package.json');
      if (fs.existsSync(rootPkgPath)) {
        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
        const chRow = await queryOne<{ value: string }>(
          'SELECT value FROM system_settings WHERE key = ?',
          ['server_auto_update_channel']
        );
        const verRow = await queryOne<{ value: string }>(
          'SELECT value FROM system_settings WHERE key = ?',
          ['installed_version']
        );
        const isAlphaSha =
          chRow?.value === 'alpha' && /^[0-9a-f]{7,40}$/i.test(String(verRow?.value || '').trim());

        if (rootPkg?.version && !isAlphaSha) {
          await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
            'installed_version',
            `v${rootPkg.version}`
          ]);
        }
      }
    } catch {}

    // Initialize Home Assistant MQTT client
    await homeAssistantMqttService.init();

    const httpsCreds = await tlsManagerService.getActiveHttpsCredentials();
    let server: http.Server | https.Server;
    let isHttps = false;

    if (httpsCreds) {
      server = https.createServer({ cert: httpsCreds.cert, key: httpsCreds.key }, app);
      isHttps = true;
      server.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(` 🔒 DecaTone Native HTTPS Server (${httpsCreds.source}) on port ${PORT}`);
        console.log(`====================================================`);
      });
    } else {
      server = http.createServer(app);
      server.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(` 🚀 DecaTone HTTP Server running on port ${PORT}`);
        console.log(` Trust Proxy: ${JSON.stringify(trustProxyEffective)}`);
        console.log(` Web Portal: http://localhost:${PORT}`);
        console.log(` WebSocket Signaling: ws://localhost:${PORT}/ws/phone`);
        console.log(`====================================================`);
      });
    }

    await tlsManagerService.attachServer(server, isHttps);

    process.on('SIGHUP', () => {
      tlsManagerService.reloadCertificates().catch(() => {});
    });

    // Attach WebSocket Phone Switchboard & E2EE Audio Router
    phoneSwitchService.init(server);
  } catch (err) {
    console.error('Failed to start DecaTone server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}
