import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { execute, query, queryOne } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { BACKUPS_DIR, BRANDING_DIR, ensureDirectories } from '../config/paths';
import { isDockerEnvironment, isValidBrandingImageBuffer } from '../routes/adminRoutes';
import { createBackupArchiveInternal, extractBackupArchiveSafe, isSafeTarEntry } from '../services/backupScheduler';
import { parseTrustProxyValue, tlsManagerService } from '../services/tlsManagerService';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';
import authRoutes from '../routes/authRoutes';
import phoneRoutes from '../routes/phoneRoutes';
import friendRoutes from '../routes/friendRoutes';
import adminRoutes from '../routes/adminRoutes';

function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function extractCookiePair(res: globalThis.Response): string {
  const hdrs = res.headers as any;
  const setCookies: string[] =
    typeof hdrs.getSetCookie === 'function'
      ? hdrs.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];
  assert(setCookies.length > 0, 'Expected Set-Cookie header in auth response');
  const httpOnlyPresent = setCookies.some((c) => /httponly/i.test(c));
  assert(httpOnlyPresent, 'Session cookie must carry HttpOnly attribute');
  return setCookies.map((c) => c.split(';')[0].trim()).join('; ');
}

async function runTests() {
  console.log('🧪 Starting System Management, OTA, Docker, WAL Backup, Branding & Legal Baseline Tests...');

  await runMigrations();

  // Test 1: Migration 11 & Migration 14 Phone Columns
  console.log('\n--- 1. Testing Migration 11 & 14 Columns & Tables ---');
  const tableInfo = await query<any>('PRAGMA table_info(phones)');
  const colNames = tableInfo.map((c: any) => c.name);

  for (const col of [
    'ota_auto_update_enabled',
    'ota_update_time',
    'ota_update_channel',
    'hook_flash_enabled',
    'device_token_hash',
    'device_public_key',
    'wrapped_vm_key'
  ]) {
    assert(colNames.includes(col), `Missing phones.${col} column`);
  }
  console.log('✓ Phone OTA, Hook-Flash, and E2EE Device Auth columns present');

  // Test 2: System Settings & Legal Baseline (2026.11)
  console.log('\n--- 2. Testing System Settings, Dial-Plan Keys & 2026.11 Legal Disclosures ---');
  const settingsRows = await query<any>('SELECT key, value FROM system_settings');
  const settingsMap = new Map<string, string>(settingsRows.map((r: any) => [r.key, r.value]));

  for (const key of [
    'server_auto_update_enabled',
    'auto_backup_enabled',
    'backup_retention_count',
    'favicon_url',
    'navbar_icon_url',
    'tts_voice',
    'terms_version',
    'phone_number_min_length',
    'phone_number_max_length',
    'number_assignment_mode',
    'terms_of_service',
    'privacy_policy'
  ]) {
    assert(settingsMap.has(key), `Missing ${key} setting in system_settings`);
  }

  const termsText = settingsMap.get('terms_of_service') || '';
  const privacyText = settingsMap.get('privacy_policy') || '';
  assert(termsText.includes('911') && termsText.includes('112') && termsText.includes('999'), 'Terms must include mandatory NO E911/112/999 emergency calling notice');
  assert(privacyText.includes('P-256') && privacyText.includes('AES-256-GCM'), 'Privacy Policy must accurately describe ECDH P-256 + AES-256-GCM E2EE/ECIES');
  assert(privacyText.includes('Open-Meteo'), 'Privacy Policy must disclose 711 Weather external lookup');
  console.log('✓ System Settings & 2026.11 Legal Documents verified');

  // Test 3: Docker Detection & Branding Magic Byte Security Filter
  console.log('\n--- 3. Testing Docker Detector & Branding Image Magic-Byte Filter ---');
  const detected = isDockerEnvironment();
  console.log(`✓ Docker detector executed cleanly (result: ${detected})`);

  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const svgXssAttempt = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
  assert(isValidBrandingImageBuffer(pngMagic) === true, 'Valid PNG signature must be accepted');
  assert(isValidBrandingImageBuffer(svgXssAttempt) === false, 'SVG/HTML payload must be rejected by magic-byte filter');
  console.log('✓ Branding magic-byte validator accepts PNG and blocks SVG/HTML XSS');

  // Test 4: Hot SQLite WAL Backup (VACUUM INTO + node-tar) & Traversal Filter
  console.log('\n--- 4. Testing Hot SQLite WAL Backup & Safe Tar Extraction ---');
  ensureDirectories();
  assert(fs.existsSync(BRANDING_DIR), 'Branding directory must exist');

  assert(isSafeTarEntry('decatone.db', { type: 'File' }) === true, 'Normal archive entry must be allowed');
  assert(isSafeTarEntry('../../etc/passwd', { type: 'File' }) === false, 'Path traversal entry must be blocked');
  assert(isSafeTarEntry('/etc/shadow', { type: 'File' }) === false, 'Absolute path entry must be blocked');
  assert(isSafeTarEntry('evil-link', { type: 'SymbolicLink' }) === false, 'Symlink entry must be blocked');

  const backup = await createBackupArchiveInternal();
  const archiveFullPath = path.join(BACKUPS_DIR, backup.filename);
  const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decatone-test-unpack-'));

  try {
    assert(fs.existsSync(archiveFullPath) && backup.sizeBytes > 100, 'Backup .tar.gz must exist and be non-empty');
    await extractBackupArchiveSafe(archiveFullPath, unpackDir);
    assert(fs.existsSync(path.join(unpackDir, 'decatone.db')), 'Extracted archive must contain VACUUM INTO decatone.db snapshot');
    assert(fs.existsSync(path.join(unpackDir, 'backup_metadata.json')), 'Extracted archive must contain backup_metadata.json');
    console.log(`✓ Hot SQLite WAL backup created & safely extracted (${backup.filename}, ${backup.sizeBytes} bytes)`);
  } finally {
    try { fs.rmSync(unpackDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(archiveFullPath)) fs.unlinkSync(archiveFullPath); } catch {}
  }

  // Test 5: Migration 15 Schema & Composite (area_code, phone_number)
  console.log('\n--- 5. Testing Migration 15 Schema & Composite Area Code Uniqueness ---');
  const idxAreaPhone = await queryOne<any>(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_area_phone'"
  );
  assert(!!idxAreaPhone, 'Missing Migration 15 idx_users_area_phone unique composite index');

  const userCols15 = (await query<any>('PRAGMA table_info(users)')).map((c: any) => c.name);
  assert(userCols15.includes('recovery_encrypted_private_key'), 'Missing users.recovery_encrypted_private_key');
  assert(userCols15.includes('recovery_key_salt'), 'Missing users.recovery_key_salt');

  try {
    await execute(
      "INSERT INTO users (username, password_hash, display_name, area_code, phone_number, role) VALUES ('area_u1', 'x', 'Area U1', '212', '5501', 'user')"
    );
    await execute(
      "INSERT INTO users (username, password_hash, display_name, area_code, phone_number, role) VALUES ('area_u2', 'x', 'Area U2', '415', '5501', 'user')"
    );
    let dupThrew = false;
    try {
      await execute(
        "INSERT INTO users (username, password_hash, display_name, area_code, phone_number, role) VALUES ('area_u3', 'x', 'Area U3', '212', '5501', 'user')"
      );
    } catch {
      dupThrew = true;
    }
    assert(dupThrew, 'Duplicate (area_code, phone_number) must be rejected by idx_users_area_phone');
    console.log('✓ Composite (area_code, phone_number) allows cross-area reuse and blocks same-area collisions');
  } finally {
    await execute("DELETE FROM users WHERE username IN ('area_u1', 'area_u2', 'area_u3')");
  }

  // Mount isolated Express HTTP server for TLS, TTS, Auth, Phone, Friends & WAL Restore integration tests
  const app = express();
  app.use(express.json({ limit: '5mb' }));
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
    const mode = await tlsManagerService.getEffectiveMode();
    const localCa = tlsManagerService.getLocalCaInfo();
    return res.json({
      tlsMode: mode,
      hasLocalCa: localCa.initialized,
      localCaFingerprintSha256: localCa.fingerprintSha256,
      caDownloadUrl: localCa.initialized ? '/api/tls/ca.crt' : null,
      protocol: req.protocol
    });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/phone', phoneRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/admin', adminRoutes);
  tlsManagerService.bindApp(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Test 6: Unified TLS Manager & Public CA Endpoints
    console.log('\n--- 6. Testing Unified TLS Manager, trust_proxy, Local CA & ACME Guards ---');
    assert((await tlsManagerService.getEffectiveMode()) === 'proxy', "Default tls_mode must be 'proxy'");
    assert(parseTrustProxyValue('false') === false, "Default trust_proxy 'false' must parse to boolean false");
    assert(parseTrustProxyValue('1') === 1, "trust_proxy '1' must parse to hop count 1");

    await tlsManagerService.updateConfig({ trustProxy: '1' });
    assert(app.get('trust proxy') === 1, 'updateConfig({ trustProxy: "1" }) must update Express trust proxy dynamically');
    await tlsManagerService.updateConfig({ trustProxy: 'false' });
    assert(app.get('trust proxy') === false, 'updateConfig({ trustProxy: "false" }) must restore false dynamically');

    let acmeRejected = false;
    try {
      await tlsManagerService.obtainOrRenewAcmeCertificate({ domain: '', email: 'ops@example.com' });
    } catch (e: any) {
      acmeRejected = /domain/i.test(e?.message || '');
    }
    assert(acmeRejected, 'ACME must reject missing domain');

    const localCa1 = tlsManagerService.ensureLocalCaAndLeafCertificates('test.local,127.0.0.1');
    assert(
      localCa1.caCertPem.includes('-----BEGIN CERTIFICATE-----') && localCa1.hosts.includes('test.local'),
      'Local CA + leaf SAN cert must initialize'
    );

    const caRes = await fetch(`${baseUrl}/api/tls/ca.crt`);
    assert(caRes.status === 200, 'GET /api/tls/ca.crt must return 200 when initialized');
    assert((caRes.headers.get('content-type') || '').includes('x-x509-ca-cert'), 'CA download must serve x-x509-ca-cert mime');
    const caPem = await caRes.text();
    assert(caPem.includes('-----BEGIN CERTIFICATE-----'), 'CA response must contain PEM certificate');

    const tlsInfoRes = await fetch(`${baseUrl}/api/tls/info`);
    assert(tlsInfoRes.status === 200, 'GET /api/tls/info must return 200');
    const tlsInfoBody: any = await tlsInfoRes.json();
    assert(tlsInfoBody.hasLocalCa === true && !!tlsInfoBody.localCaFingerprintSha256, '/api/tls/info must expose CA fingerprint');

    const localCa2 = tlsManagerService.regenerateLocalCa('regen.local');
    assert(
      localCa2.caCertPem.includes('-----BEGIN CERTIFICATE-----') &&
        localCa2.hosts.includes('regen.local') &&
        localCa2.fingerprintSha256 !== localCa1.fingerprintSha256,
      'regenerateLocalCa must rotate CA fingerprint and update SAN hosts'
    );
    console.log('✓ Unified TLS Manager (proxy trust_proxy, local CA SANs, /api/tls/*, ACME guard) verified');

    // Test 7 & 8: Auth Validation, Cookie + Bearer Null Guard, Recovery Key, Phone Enroll Immutability, Friends, TTS, Backup Restore/Delete
    console.log('\n--- 7 & 8. Testing Auth Security, Recovery Key, Phone Claim/Enroll, Friends, Dual TTS & WAL Restore ---');
    const adminBundle = await VoicemailCryptoService.generateUserKeyBundle('AdminStrongPass!99');
    const bobBundle = await VoicemailCryptoService.generateUserKeyBundle('BobStrongPass!99');
    const bobRewrappedBundle = await VoicemailCryptoService.generateUserKeyBundle('BobNewPass!99');

    // Validation rejections
    const shortPwRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'short_pw_user',
        password: '123',
        agreedToTerms: true,
        acknowledgedE911: true,
        encryptionPublicKey: adminBundle.encryptionPublicKey,
        encryptedPrivateKey: adminBundle.encryptedPrivateKey,
        keySalt: adminBundle.keySalt
      })
    });
    assert(shortPwRes.status === 400, 'Password shorter than 8 characters must be rejected with 400');

    const noE911Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'no_e911_user',
        password: 'ValidPassword!99',
        agreedToTerms: true,
        acknowledgedE911: false,
        encryptionPublicKey: adminBundle.encryptionPublicKey,
        encryptedPrivateKey: adminBundle.encryptedPrivateKey,
        keySalt: adminBundle.keySalt
      })
    });
    assert(noE911Res.status === 400, 'Registration without acknowledgedE911=true must return 400');

    const badPubRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'bad_pub_user',
        password: 'ValidPassword!99',
        agreedToTerms: true,
        acknowledgedE911: true,
        encryptionPublicKey: 'not-a-valid-p256-key',
        encryptedPrivateKey: adminBundle.encryptedPrivateKey,
        keySalt: adminBundle.keySalt
      })
    });
    assert(badPubRes.status === 400, 'Malformed P-256 encryptionPublicKey must be rejected with 400');

    // Register Admin & Bob
    const adminRegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin_sys_test',
        password: 'AdminStrongPass!99',
        agreedToTerms: true,
        acknowledgedE911: true,
        encryptionPublicKey: adminBundle.encryptionPublicKey,
        encryptedPrivateKey: adminBundle.encryptedPrivateKey,
        keySalt: adminBundle.keySalt
      })
    });
    assert(adminRegRes.status === 201, 'Admin registration must return 201');
    const adminCookie = extractCookiePair(adminRegRes);
    const adminRegJson: any = await adminRegRes.json();
    const adminId = adminRegJson.user.id;
    await execute("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);

    const bobRegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'bob_sys_test',
        password: 'BobStrongPass!99',
        agreedToTerms: true,
        acknowledgedE911: true,
        encryptionPublicKey: bobBundle.encryptionPublicKey,
        encryptedPrivateKey: bobBundle.encryptedPrivateKey,
        keySalt: bobBundle.keySalt
      })
    });
    assert(bobRegRes.status === 201, 'Bob registration must return 201');
    const bobCookie = extractCookiePair(bobRegRes);
    const bobRegJson: any = await bobRegRes.json();
    const bobId = bobRegJson.user.id;

    // Cookie auth + literal 'Bearer null' / 'Bearer undefined' bypass guard
    const meWithNullBearerRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: adminCookie, Authorization: 'Bearer null' }
    });
    assert(meWithNullBearerRes.status === 200, "GET /api/auth/me must ignore literal 'Bearer null' and accept session cookie");

    const meWithUndefBearerRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: adminCookie, Authorization: 'Bearer undefined' }
    });
    assert(meWithUndefBearerRes.status === 200, "GET /api/auth/me must ignore literal 'Bearer undefined' and accept session cookie");

    const meNoCookieNullBearerRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer null' }
    });
    assert(meNoCookieNullBearerRes.status === 401, "'Bearer null' without valid cookie must fail with 401");

    // Recovery Key + password reset vault preservation
    const recEncSample = Buffer.from(crypto.randomBytes(124)).toString('base64');
    const recSaltSample = crypto.randomBytes(16).toString('hex');
    const putRecRes = await fetch(`${baseUrl}/api/auth/recovery-key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ recoveryEncryptedPrivateKey: recEncSample, recoveryKeySalt: recSaltSample })
    });
    assert(putRecRes.status === 200 && ((await putRecRes.json()) as any).hasRecoveryKey === true, 'PUT /api/auth/recovery-key must succeed');

    const resetToken = crypto.randomBytes(24).toString('hex');
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
    await execute('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)', [bobId, resetToken, futureExpiry]);

    const verifyResetRes = await fetch(`${baseUrl}/api/auth/verify-reset-token?token=${resetToken}`);
    const verifyResetJson: any = await verifyResetRes.json();
    assert(
      verifyResetRes.status === 200 &&
        verifyResetJson.hasRecoveryKey === true &&
        verifyResetJson.recoveryEncryptedPrivateKey === recEncSample,
      'verify-reset-token must expose saved recovery vault bundle'
    );

    const doResetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        newPassword: 'BobNewStrongPassword!99',
        encryptionPublicKey: bobBundle.encryptionPublicKey,
        encryptedPrivateKey: bobRewrappedBundle.encryptedPrivateKey,
        keySalt: bobRewrappedBundle.keySalt
      })
    });
    const doResetJson: any = await doResetRes.json();
    assert(doResetRes.status === 200 && doResetJson.keypairRotated === false, 'Password reset preserving public key must set keypairRotated=false');

    const bobPostReset = await queryOne<any>('SELECT encryption_public_key, recovery_encrypted_private_key FROM users WHERE id = ?', [bobId]);
    assert(bobPostReset.encryption_public_key === bobBundle.encryptionPublicKey, 'Reset password must preserve encryption_public_key');
    assert(bobPostReset.recovery_encrypted_private_key === recEncSample, 'Reset password must preserve recovery vault bundle');

    // Old session cookie MUST be revoked after password reset (token_version bump), and fresh login works
    const bobRevokedRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: bobCookie } });
    assert(bobRevokedRes.status === 401, 'Pre-reset session cookie must be invalidated by token_version bump');

    const bobLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob_sys_test', password: 'BobNewStrongPassword!99' })
    });
    assert(bobLoginRes.status === 200, 'Bob must log in with new password after reset');
    const bobFreshCookie = extractCookiePair(bobLoginRes);

    // Paired phone enroll pubkey immutability & /claim auth
    const devEcdhLegit = crypto.createECDH('prime256v1');
    const legitDevPubB64 = devEcdhLegit.generateKeys().toString('base64');
    const devEcdhAttacker = crypto.createECDH('prime256v1');
    const attackerDevPubB64 = devEcdhAttacker.generateKeys().toString('base64');
    const testDeviceId = 'ESP32-IMMUT-TEST';

    const enrollRes1 = await fetch(`${baseUrl}/api/phone/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: testDeviceId, devicePublicKey: legitDevPubB64 })
    });
    const enrollJson1: any = await enrollRes1.json();
    assert(enrollRes1.status === 200 && enrollJson1.isPaired === false && !!enrollJson1.pairingCode, 'Unpaired device enroll must succeed');

    const unauthClaimRes = await fetch(`${baseUrl}/api/phone/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: testDeviceId, pairingCode: enrollJson1.pairingCode })
    });
    assert(unauthClaimRes.status === 401, 'Unauthenticated POST /api/phone/claim must fail with 401');

    // Claiming offline enrolled device as admin succeeds with provisionedOfflineDeviceToken
    const adminClaimRes = await fetch(`${baseUrl}/api/phone/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ deviceId: testDeviceId, pairingCode: enrollJson1.pairingCode, phoneLabel: 'Desk Set' })
    });
    assert(adminClaimRes.status === 200, 'Authenticated admin claiming device must succeed');

    const enrollOverwriteAttempt = await fetch(`${baseUrl}/api/phone/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: testDeviceId, devicePublicKey: attackerDevPubB64 })
    });
    const overwriteJson: any = await enrollOverwriteAttempt.json();
    assert(enrollOverwriteAttempt.status === 200 && overwriteJson.isPaired === true, 'Paired enroll must report isPaired=true');
    const phoneRowAfter = await queryOne<any>('SELECT device_public_key FROM phones WHERE device_id = ?', [testDeviceId]);
    assert(phoneRowAfter.device_public_key === legitDevPubB64, 'Unauthenticated enroll MUST NOT overwrite paired device_public_key');

    // Re-adding declined friend
    const frReq1 = await fetch(`${baseUrl}/api/friends/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ target: 'bob_sys_test' })
    });
    assert(frReq1.status === 200 || frReq1.status === 201, 'Initial friend request must succeed');
    const pendingRow = await queryOne<any>(
      "SELECT id FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'",
      [adminId, bobId]
    );
    assert(!!pendingRow, 'Pending friend_requests row must exist');

    const frDecline = await fetch(`${baseUrl}/api/friends/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bobFreshCookie },
      body: JSON.stringify({ requestId: pendingRow.id, action: 'decline' })
    });
    assert(frDecline.status === 200, 'Declining friend request must return 200');

    const frReReq = await fetch(`${baseUrl}/api/friends/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ target: 'bob_sys_test' })
    });
    assert(frReReq.status === 200 || frReReq.status === 201, 'Re-sending friend request after decline must succeed');

    // Dual TTS routes
    for (const eng of ['espeak', 'kokoro', 'piper']) {
      const ttsPut = await fetch(`${baseUrl}/api/admin/tts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ engine: eng })
      });
      assert(ttsPut.status === 200, `PUT /api/admin/tts engine=${eng} must succeed`);
      const ttsPutJson: any = await ttsPut.json();
      assert(ttsPutJson.configuredEngine === eng, `TTS config must reflect configuredEngine=${eng}`);
    }
    const ttsPollRes = await fetch(`${baseUrl}/api/admin/tts/download-status`, {
      headers: { Cookie: adminCookie }
    });
    const ttsPollJson: any = await ttsPollRes.json();
    assert(ttsPollRes.status === 200 && Array.isArray(ttsPollJson.voices) && !!ttsPollJson.downloadState, 'GET /api/admin/tts/download-status must expose voices & downloadState');

    // Safe WAL Backup Restore & Delete
    await execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('test_restore_marker', 'before_restore')");
    const bkpCreateRes = await fetch(`${baseUrl}/api/admin/backups/create`, {
      method: 'POST',
      headers: { Cookie: adminCookie }
    });
    const bkpCreateJson: any = await bkpCreateRes.json();
    assert(bkpCreateRes.status === 200 && !!bkpCreateJson.backup?.filename, 'POST /api/admin/backups/create must return created backup filename');
    const createdBkpFile = String(bkpCreateJson.backup.filename);

    await execute("UPDATE system_settings SET value = 'after_mutation' WHERE key = 'test_restore_marker'");
    const bkpRestoreRes = await fetch(`${baseUrl}/api/admin/backups/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ filename: createdBkpFile })
    });
    const bkpRestoreJson: any = await bkpRestoreRes.json();
    assert(bkpRestoreRes.status === 200 && bkpRestoreJson.success === true, 'POST /api/admin/backups/restore must restore WAL snapshot cleanly');
    const restoredMarker = await queryOne<{ value: string }>("SELECT value FROM system_settings WHERE key = 'test_restore_marker'");
    assert(restoredMarker?.value === 'before_restore', 'SQLite restore must recover pre-mutation row');

    const badDelRes = await fetch(`${baseUrl}/api/admin/backups/invalid-file.txt`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert(badDelRes.status === 400, 'DELETE /api/admin/backups with non-archive extension must fail with 400');

    const bkpDelRes = await fetch(`${baseUrl}/api/admin/backups/${encodeURIComponent(createdBkpFile)}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert(bkpDelRes.status === 200, 'DELETE /api/admin/backups/:filename must delete backup archive');
    assert(!fs.existsSync(path.join(BACKUPS_DIR, createdBkpFile)), 'Deleted backup archive must be removed from disk');

    console.log('✓ Auth security, Recovery Key preservation, Phone immutability, Declined friends, Dual TTS & WAL Restore/Delete verified');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await execute("DELETE FROM system_settings WHERE key = 'test_restore_marker'");
    await execute("DELETE FROM phones WHERE device_id = 'ESP32-IMMUT-TEST'");
    await execute("DELETE FROM pending_device_enrollments WHERE device_id = 'ESP32-IMMUT-TEST'");
    await execute("DELETE FROM users WHERE username IN ('admin_sys_test', 'bob_sys_test')");
  }

  console.log('\n🎉 ALL SYSTEM MANAGEMENT, TLS, TTS, AUTH, BACKUP & SECURITY TESTS PASSED!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
