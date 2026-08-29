import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { runMigrations } from './db/migrations';
import { queryOne, execute } from './db/connection';
import { phoneSwitchService } from './services/phoneSwitchService';
import { initBackupScheduler } from './services/backupScheduler';

import authRoutes from './routes/authRoutes';
import phoneRoutes from './routes/phoneRoutes';
import friendRoutes from './routes/friendRoutes';
import voicemailRoutes from './routes/voicemailRoutes';
import adminRoutes from './routes/adminRoutes';
import setupRoutes from './routes/setupRoutes';
import legalRoutes from './routes/legalRoutes';

const app = express();
const PORT = process.env.PORT || 4000;

// Enable reverse proxy SSL termination & protocol detection
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Global Anti-Caching Headers across all responses
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, post-check=0, pre-check=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Static Asset Directories
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
const customBrandingDir = path.join(dataDir, 'branding');
const defaultAssetsDir = path.join(__dirname, '../../assets');
const firmwareDir = path.join(dataDir, 'firmware');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(customBrandingDir)) fs.mkdirSync(customBrandingDir, { recursive: true });
if (!fs.existsSync(firmwareDir)) fs.mkdirSync(firmwareDir, { recursive: true });

// Serve Uploads (Voicemails, Greetings, User Media)
app.use('/uploads', express.static(uploadsDir));

// Serve Custom or Default Branding Logo
app.use('/branding', (req, res, next) => {
  const fileInCustom = path.join(customBrandingDir, req.path);
  if (fs.existsSync(fileInCustom) && fs.statSync(fileInCustom).isFile()) {
    return res.sendFile(fileInCustom);
  }
  const fileInDefault = path.join(defaultAssetsDir, req.path);
  if (fs.existsSync(fileInDefault) && fs.statSync(fileInDefault).isFile()) {
    return res.sendFile(fileInDefault);
  }
  // Fallback to default logo.png
  const fallbackLogo = path.join(defaultAssetsDir, 'logo.png');
  if (fs.existsSync(fallbackLogo)) {
    return res.sendFile(fallbackLogo);
  }
  next();
});

// Serve Project Assets
app.use('/assets', express.static(defaultAssetsDir));

// Public Branding Configuration Endpoint
app.get('/api/branding/public', async (req, res) => {
  try {
    const appNameRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "app_name"');
    const logoUrlRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "logo_url"');

    return res.json({
      app_name: appNameRow?.value || 'DecaTone',
      logo_url: logoUrlRow?.value || '/branding/logo.png'
    });
  } catch (err) {
    return res.json({ app_name: 'DecaTone', logo_url: '/branding/logo.png' });
  }
});

// Dynamic Web App Manifest
app.get(['/manifest.json', '/api/manifest.json'], async (req, res) => {
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
  } catch (err) {
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
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  res.json({
    status: 'ok',
    service: 'DecaTone Backend API & Telephone Switchboard',
    detectedProtocol: protocol,
    detectedHost: host,
    isBehindProxy: req.headers['x-forwarded-proto'] ? true : false,
    timestamp: new Date()
  });
});

// ESP32-S3 Firmware OTA Info & Download Endpoints
app.get('/api/firmware/info', async (req, res) => {
  try {
    const versionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "firmware_latest_version"');
    const binPath = path.join(firmwareDir, 'firmware_latest.bin');
    const exists = fs.existsSync(binPath);

    return res.json({
      version: versionRow?.value || '1.0.0',
      hasBinary: exists,
      downloadUrl: exists ? '/api/firmware/download/latest' : null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to query firmware info' });
  }
});

app.get('/api/firmware/download/latest', (req, res) => {
  const binPath = path.join(firmwareDir, 'firmware_latest.bin');
  if (!fs.existsSync(binPath)) {
    return res.status(404).send('No firmware binary uploaded');
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="firmware.bin"');
  fs.createReadStream(binPath).pipe(res);
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
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use('/assets', express.static(path.join(frontendDist, 'assets'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  }));

  app.use(express.static(frontendDist, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  }));

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
      res.sendFile(path.join(frontendDist, 'index.html'));
    } else {
      res.status(404).send('Asset not found');
    }
  });
}

// Start Server
async function startServer() {
  try {
    console.log('Initializing DecaTone database migrations...');
    await runMigrations();

    // Initialize automated scheduled backup daemon
    initBackupScheduler();

    // Auto-sync DB installed_version with current package.json version
    try {
      const rootPkgPath = path.join(__dirname, '../../package.json');
      if (fs.existsSync(rootPkgPath)) {
        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
        if (rootPkg && rootPkg.version) {
          await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['installed_version', `v${rootPkg.version}`]);
        }
      }
    } catch (e) {}

    const certPath = process.env.SSL_CERT || path.join(dataDir, 'cert.pem');
    const keyPath = process.env.SSL_KEY || path.join(dataDir, 'key.pem');

    let server: http.Server | https.Server;

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const httpsOptions = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };
      server = https.createServer(httpsOptions, app);
      server.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(` 🔒 DecaTone Native HTTPS Server running on port ${PORT}`);
        console.log(`====================================================`);
      });
    } else {
      server = http.createServer(app);
      server.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(` 🚀 DecaTone HTTP Server running on port ${PORT}`);
        console.log(` Reverse Proxy SSL Detection Enabled ('trust proxy')`);
        console.log(` Web Portal: http://localhost:${PORT}`);
        console.log(` WebSocket Signaling: ws://localhost:${PORT}/ws/phone`);
        console.log(`====================================================`);
      });
    }

    // Attach WebSocket Phone Switchboard & Audio Router
    phoneSwitchService.init(server);
  } catch (err) {
    console.error('Failed to start DecaTone server:', err);
    process.exit(1);
  }
}

startServer();
