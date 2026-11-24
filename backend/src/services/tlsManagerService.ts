import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import * as acme from 'acme-client';
import forge from 'node-forge';
import { DATA_DIR, TLS_DIR, ensureDirectories } from '../config/paths';
import { execute, query, queryOne } from '../db/connection';

export type TlsMode = 'proxy' | 'acme' | 'local_ca';

interface TlsCredentials {
  cert: Buffer;
  key: Buffer;
  source: 'env' | 'acme' | 'local_ca' | 'custom_pem';
}

const ACME_DIR = path.join(TLS_DIR, 'acme');
const ACME_ACCOUNT_KEY_PATH = path.join(ACME_DIR, 'account.key');
const ACME_CERT_PATH = path.join(ACME_DIR, 'cert.pem');
const ACME_KEY_PATH = path.join(ACME_DIR, 'key.pem');

const LOCAL_CA_CERT_PATH = path.join(TLS_DIR, 'local-ca.crt');
const LOCAL_CA_KEY_PATH = path.join(TLS_DIR, 'local-ca.key');
const LOCAL_LEAF_CERT_PATH = path.join(TLS_DIR, 'local-leaf.crt');
const LOCAL_LEAF_KEY_PATH = path.join(TLS_DIR, 'local-leaf.key');
const LOCAL_LEAF_HOSTS_META_PATH = path.join(TLS_DIR, 'local-leaf-hosts.json');

function ensureTlsSubdirs(): void {
  ensureDirectories();
  if (!fs.existsSync(TLS_DIR)) fs.mkdirSync(TLS_DIR, { recursive: true });
  if (!fs.existsSync(ACME_DIR)) fs.mkdirSync(ACME_DIR, { recursive: true });
}

export function parseTrustProxyValue(raw: string | undefined | null): boolean | number | string {
  const val = String(raw ?? '').trim();
  if (!val || val.toLowerCase() === 'false' || val === '0') {
    return false;
  }
  if (val.toLowerCase() === 'true') {
    return 1;
  }
  if (/^\d+$/.test(val)) {
    const hops = parseInt(val, 10);
    return hops > 0 ? hops : false;
  }
  // Custom IP, comma-separated IPs/CIDRs, or Express preset ('loopback', 'uniquelocal')
  return val;
}

function getLocalLanAddresses(): { ips: string[]; hostnames: string[] } {
  const ips = new Set<string>(['127.0.0.1']);
  const hostnames = new Set<string>(['localhost', '*.local']);

  const hostName = os.hostname();
  if (hostName) {
    hostnames.add(hostName);
    if (!hostName.includes('.')) {
      hostnames.add(`${hostName}.local`);
    }
  }

  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      if (!list) continue;
      for (const iface of list) {
        if (!iface || iface.internal) continue;
        if (iface.family === 'IPv4') {
          ips.add(iface.address);
        }
      }
    }
  } catch {}

  return {
    ips: Array.from(ips).sort(),
    hostnames: Array.from(hostnames).sort()
  };
}

function parseCertificateDates(pemPath: string): { validTo: string; daysRemaining: number; subject: string; issuer: string; fingerprint256: string } | null {
  try {
    if (!fs.existsSync(pemPath)) return null;
    const pem = fs.readFileSync(pemPath);
    const x509 = new crypto.X509Certificate(pem);
    const validToDate = new Date(x509.validTo);
    const daysRemaining = Math.floor((validToDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      validTo: validToDate.toISOString(),
      daysRemaining,
      subject: x509.subject,
      issuer: x509.issuer,
      fingerprint256: x509.fingerprint256
    };
  } catch {
    return null;
  }
}

class TlsManagerService {
  private expressApp: Express | null = null;
  private liveServer: http.Server | https.Server | null = null;
  private activeIsHttps = false;
  private acmeHttpServer: http.Server | null = null;
  private activeChallenges = new Map<string, string>();
  private acmeLastError: string | null = null;
  private acmeRenewing = false;
  private acmeChallengePortBound = false;
  private initialBootMode: TlsMode = 'proxy';
  private schedulerTimer: NodeJS.Timeout | null = null;

  public bindApp(app: Express): void {
    this.expressApp = app;
  }

  public async getSettingsMap(): Promise<Record<string, string>> {
    try {
      const rows = await query<{ key: string; value: string }>(
        `SELECT key, value FROM system_settings WHERE key IN (
          'tls_mode',
          'tls_acme_domain',
          'tls_acme_email',
          'tls_acme_staging',
          'tls_local_ca_hosts',
          'trust_proxy'
        )`
      );
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      return map;
    } catch {
      return {};
    }
  }

  public async getEffectiveMode(): Promise<TlsMode> {
    const envMode = (process.env.TLS_MODE || '').trim().toLowerCase();
    if (envMode === 'proxy' || envMode === 'acme' || envMode === 'local_ca') {
      return envMode;
    }
    const map = await this.getSettingsMap();
    const dbMode = (map['tls_mode'] || 'proxy').trim().toLowerCase();
    if (dbMode === 'acme' || dbMode === 'local_ca') {
      return dbMode;
    }
    return 'proxy';
  }

  public async applyTrustProxy(appOverride?: Express): Promise<boolean | number | string> {
    const targetApp = appOverride || this.expressApp;
    const envRaw = (process.env.TRUST_PROXY ?? '').trim();
    let effectiveRaw: string;
    if (envRaw.length > 0) {
      effectiveRaw = envRaw;
    } else {
      const map = await this.getSettingsMap();
      effectiveRaw = map['trust_proxy'] ?? 'false';
    }
    const parsed = parseTrustProxyValue(effectiveRaw);
    if (targetApp) {
      targetApp.set('trust proxy', parsed);
    }
    return parsed;
  }

  /**
   * Express middleware serving ACME HTTP-01 challenges at /.well-known/acme-challenge/:token
   */
  public acmeChallengeMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const prefix = '/.well-known/acme-challenge/';
      if (req.path.startsWith(prefix)) {
        const token = req.path.slice(prefix.length).trim();
        const keyAuth = this.activeChallenges.get(token);
        if (keyAuth) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.status(200).send(keyAuth);
        }
        return res.status(404).send('Challenge token not found');
      }
      next();
    };
  }

  private async ensureAcmeChallengeHttpServer(): Promise<{ started: boolean; error?: string }> {
    if (this.acmeHttpServer && this.acmeHttpServer.listening) {
      return { started: true };
    }
    const listenPort = parseInt(process.env.ACME_HTTP_PORT || '80', 10) || 80;
    const appPort = String(process.env.PORT || '4000');
    if (String(listenPort) === appPort) {
      return { started: true };
    }

    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        const urlPath = req.url || '/';
        const prefix = '/.well-known/acme-challenge/';
        if (urlPath.startsWith(prefix)) {
          const token = urlPath.slice(prefix.length).split('?')[0].trim();
          const keyAuth = this.activeChallenges.get(token);
          if (keyAuth) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(keyAuth);
            return;
          }
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const hostHeader = String(req.headers.host || '').split(':')[0];
        if (hostHeader && this.activeIsHttps) {
          res.writeHead(301, { Location: `https://${hostHeader}${urlPath}` });
          res.end();
        } else {
          res.writeHead(404);
          res.end('DecaTone ACME Challenge Responder');
        }
      });

      srv.once('error', (err: any) => {
        this.acmeChallengePortBound = false;
        const msg =
          err?.code === 'EACCES'
            ? `Port ${listenPort} requires elevated privileges (or map -p 80:80 in Docker / forward external 80 -> ${appPort}).`
            : err?.code === 'EADDRINUSE'
            ? `Port ${listenPort} is already in use by another process.`
            : err?.message || `Failed to bind ACME challenge port ${listenPort}`;
        resolve({ started: false, error: msg });
      });

      srv.listen(listenPort, () => {
        this.acmeHttpServer = srv;
        this.acmeChallengePortBound = true;
        resolve({ started: true });
      });
    });
  }

  public stopAcmeChallengeHttpServer(): void {
    if (this.acmeHttpServer) {
      try {
        this.acmeHttpServer.close();
      } catch {}
      this.acmeHttpServer = null;
      this.acmeChallengePortBound = false;
    }
  }

  /**
   * Generates or reloads the persistent 10-year Local Root CA and SAN leaf certificate
   */
  public ensureLocalCaAndLeafCertificates(customHostsCsv?: string): {
    caCertPem: string;
    leafCertPem: string;
    leafKeyPem: string;
    fingerprintSha256: string;
    hosts: string[];
    regeneratedLeaf: boolean;
  } {
    ensureTlsSubdirs();
    const pki = forge.pki;

    // 1. Ensure persistent Local Root CA exists
    let caCert: forge.pki.Certificate;
    let caKey: forge.pki.rsa.PrivateKey;

    if (fs.existsSync(LOCAL_CA_CERT_PATH) && fs.existsSync(LOCAL_CA_KEY_PATH)) {
      caCert = pki.certificateFromPem(fs.readFileSync(LOCAL_CA_CERT_PATH, 'utf8'));
      caKey = pki.privateKeyFromPem(fs.readFileSync(LOCAL_CA_KEY_PATH, 'utf8')) as forge.pki.rsa.PrivateKey;
    } else {
      const caKeys = pki.rsa.generateKeyPair(2048);
      caKey = caKeys.privateKey;
      caCert = pki.createCertificate();
      caCert.publicKey = caKeys.publicKey;
      caCert.serialNumber = crypto.randomBytes(16).toString('hex');
      const now = new Date();
      caCert.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000);
      caCert.validity.notAfter = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000);

      const caAttrs = [
        { name: 'commonName', value: 'DecaTone Local Root CA' },
        { name: 'organizationName', value: 'DecaTone Self-Hosted Switchboard' }
      ];
      caCert.setSubject(caAttrs);
      caCert.setIssuer(caAttrs);
      caCert.setExtensions([
        { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
        { name: 'subjectKeyIdentifier' }
      ]);
      caCert.sign(caKey, forge.md.sha256.create());

      fs.writeFileSync(LOCAL_CA_KEY_PATH, pki.privateKeyToPem(caKey), { mode: 0o600 });
      fs.writeFileSync(LOCAL_CA_CERT_PATH, pki.certificateToPem(caCert), { mode: 0o644 });
    }

    const caCertPem = fs.readFileSync(LOCAL_CA_CERT_PATH, 'utf8');
    const fingerprintSha256 = new crypto.X509Certificate(caCertPem).fingerprint256;

    // 2. Gather current LAN SAN hostnames & IPs
    const lan = getLocalLanAddresses();
    const customEntries = String(customHostsCsv || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const dnsSet = new Set<string>(lan.hostnames);
    const ipSet = new Set<string>(lan.ips);
    for (const h of customEntries) {
      if (net.isIP(h)) ipSet.add(h);
      else dnsSet.add(h);
    }

    const combinedHosts = [...Array.from(dnsSet).sort(), ...Array.from(ipSet).sort()];

    // Check if existing leaf cert matches current SANs & has > 30 days validity
    let needLeafRegen = !fs.existsSync(LOCAL_LEAF_CERT_PATH) || !fs.existsSync(LOCAL_LEAF_KEY_PATH);
    if (!needLeafRegen) {
      const leafInfo = parseCertificateDates(LOCAL_LEAF_CERT_PATH);
      if (!leafInfo || leafInfo.daysRemaining < 30) {
        needLeafRegen = true;
      }
      try {
        const prevHosts = JSON.parse(fs.readFileSync(LOCAL_LEAF_HOSTS_META_PATH, 'utf8'));
        if (!Array.isArray(prevHosts) || JSON.stringify(prevHosts) !== JSON.stringify(combinedHosts)) {
          needLeafRegen = true;
        }
      } catch {
        needLeafRegen = true;
      }
    }

    if (needLeafRegen) {
      const leafKeys = pki.rsa.generateKeyPair(2048);
      const leafCert = pki.createCertificate();
      leafCert.publicKey = leafKeys.publicKey;
      leafCert.serialNumber = crypto.randomBytes(16).toString('hex');
      const now = new Date();
      leafCert.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000);
      leafCert.validity.notAfter = new Date(now.getTime() + 800 * 24 * 60 * 60 * 1000);

      const primaryCn = customEntries[0] || ipSet.values().next().value || 'localhost';
      leafCert.setSubject([
        { name: 'commonName', value: primaryCn },
        { name: 'organizationName', value: 'DecaTone LAN Switchboard' }
      ]);
      leafCert.setIssuer(caCert.subject.attributes);

      const altNames: any[] = [];
      for (const d of dnsSet) altNames.push({ type: 2, value: d });
      for (const ip of ipSet) altNames.push({ type: 7, ip });

      leafCert.setExtensions([
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames },
        { name: 'authorityKeyIdentifier', keyIdentifier: true }
      ]);
      leafCert.sign(caKey, forge.md.sha256.create());

      const leafKeyPem = pki.privateKeyToPem(leafKeys.privateKey);
      const fullChainPem = pki.certificateToPem(leafCert) + '\n' + caCertPem;
      fs.writeFileSync(LOCAL_LEAF_KEY_PATH, leafKeyPem, { mode: 0o600 });
      fs.writeFileSync(LOCAL_LEAF_CERT_PATH, fullChainPem, { mode: 0o644 });
      fs.writeFileSync(LOCAL_LEAF_HOSTS_META_PATH, JSON.stringify(combinedHosts), { mode: 0o644 });
    }

    return {
      caCertPem,
      leafCertPem: fs.readFileSync(LOCAL_LEAF_CERT_PATH, 'utf8'),
      leafKeyPem: fs.readFileSync(LOCAL_LEAF_KEY_PATH, 'utf8'),
      fingerprintSha256,
      hosts: combinedHosts,
      regeneratedLeaf: needLeafRegen
    };
  }

  public regenerateLocalCa(customHostsCsv?: string) {
    ensureTlsSubdirs();
    for (const p of [LOCAL_CA_CERT_PATH, LOCAL_CA_KEY_PATH, LOCAL_LEAF_CERT_PATH, LOCAL_LEAF_KEY_PATH, LOCAL_LEAF_HOSTS_META_PATH]) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
    const result = this.ensureLocalCaAndLeafCertificates(customHostsCsv);
    this.reloadCertificates();
    return result;
  }

  public getLocalCaInfo(): { initialized: boolean; pem: string | null; fingerprintSha256: string | null; hosts: string[]; expiresAt: string | null } {
    if (!fs.existsSync(LOCAL_CA_CERT_PATH)) {
      return { initialized: false, pem: null, fingerprintSha256: null, hosts: [], expiresAt: null };
    }
    const pem = fs.readFileSync(LOCAL_CA_CERT_PATH, 'utf8');
    const info = parseCertificateDates(LOCAL_CA_CERT_PATH);
    let hosts: string[] = [];
    try {
      hosts = JSON.parse(fs.readFileSync(LOCAL_LEAF_HOSTS_META_PATH, 'utf8'));
    } catch {}
    return {
      initialized: true,
      pem,
      fingerprintSha256: info?.fingerprint256 || null,
      hosts,
      expiresAt: info?.validTo || null
    };
  }

  /**
   * Obtains or renews an ACME Let's Encrypt certificate via HTTP-01 challenge.
   */
  public async obtainOrRenewAcmeCertificate(opts: {
    domain: string;
    email: string;
    staging?: boolean;
    force?: boolean;
  }): Promise<{ renewed: boolean; expiresAt?: string; daysRemaining?: number; message: string }> {
    ensureTlsSubdirs();
    const cleanDomain = String(opts.domain || '').trim().toLowerCase();
    const cleanEmail = String(opts.email || '').trim();
    if (!cleanDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
      throw new Error('A valid public domain name (e.g. phone.example.com) is required for Let\'s Encrypt ACME.');
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('A valid contact email address is required for Let\'s Encrypt registration.');
    }

    if (!opts.force && fs.existsSync(ACME_CERT_PATH) && fs.existsSync(ACME_KEY_PATH)) {
      const existing = parseCertificateDates(ACME_CERT_PATH);
      if (existing && existing.daysRemaining >= 30 && existing.subject.toLowerCase().includes(cleanDomain)) {
        return {
          renewed: false,
          expiresAt: existing.validTo,
          daysRemaining: existing.daysRemaining,
          message: `Certificate still valid (${existing.daysRemaining} days remaining).`
        };
      }
    }

    if (this.acmeRenewing) {
      throw new Error('ACME certificate issuance/renewal is already in progress.');
    }

    this.acmeRenewing = true;
    this.acmeLastError = null;
    const challengeBind = await this.ensureAcmeChallengeHttpServer();
    if (!challengeBind.started) {
      console.warn(`[TLS ACME] Challenge port notice: ${challengeBind.error} (relying on Express /.well-known route).`);
    }

    try {
      let accountKey: Buffer;
      if (fs.existsSync(ACME_ACCOUNT_KEY_PATH)) {
        accountKey = fs.readFileSync(ACME_ACCOUNT_KEY_PATH);
      } else {
        accountKey = await acme.crypto.createPrivateKey();
        fs.writeFileSync(ACME_ACCOUNT_KEY_PATH, accountKey, { mode: 0o600 });
      }

      const client = new acme.Client({
        directoryUrl: opts.staging
          ? acme.directory.letsencrypt.staging
          : acme.directory.letsencrypt.production,
        accountKey
      });

      const [domainKey, csr] = await acme.crypto.createCsr({
        commonName: cleanDomain,
        altNames: [cleanDomain]
      });

      const certChain = await client.auto({
        csr,
        email: cleanEmail,
        termsOfServiceAgreed: true,
        challengePriority: ['http-01'],
        challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
          this.activeChallenges.set(challenge.token, keyAuthorization);
        },
        challengeRemoveFn: async (_authz, challenge) => {
          this.activeChallenges.delete(challenge.token);
        }
      });

      fs.writeFileSync(ACME_KEY_PATH, domainKey, { mode: 0o600 });
      fs.writeFileSync(ACME_CERT_PATH, certChain, { mode: 0o644 });

      const info = parseCertificateDates(ACME_CERT_PATH);
      this.reloadCertificates();
      console.log(`[TLS ACME] ✅ Obtained Let's Encrypt certificate for ${cleanDomain} (expires ${info?.validTo})`);

      return {
        renewed: true,
        expiresAt: info?.validTo,
        daysRemaining: info?.daysRemaining,
        message: `Let's Encrypt certificate issued for ${cleanDomain}!`
      };
    } catch (err: any) {
      const msg = err?.message || 'ACME challenge failed';
      this.acmeLastError = challengeBind.error ? `${msg} (${challengeBind.error})` : msg;
      throw new Error(this.acmeLastError);
    } finally {
      this.acmeRenewing = false;
      this.activeChallenges.clear();
    }
  }

  /**
   * Returns active HTTPS credentials if native HTTPS termination should be used on startup/reload.
   */
  public async getActiveHttpsCredentials(): Promise<TlsCredentials | null> {
    const envCert = process.env.SSL_CERT ? path.resolve(process.env.SSL_CERT) : '';
    const envKey = process.env.SSL_KEY ? path.resolve(process.env.SSL_KEY) : '';
    if (envCert && envKey && fs.existsSync(envCert) && fs.existsSync(envKey)) {
      return {
        cert: fs.readFileSync(envCert),
        key: fs.readFileSync(envKey),
        source: 'env'
      };
    }

    const mode = await this.getEffectiveMode();
    const map = await this.getSettingsMap();

    if (mode === 'acme') {
      if (fs.existsSync(ACME_CERT_PATH) && fs.existsSync(ACME_KEY_PATH)) {
        return {
          cert: fs.readFileSync(ACME_CERT_PATH),
          key: fs.readFileSync(ACME_KEY_PATH),
          source: 'acme'
        };
      }
      // Attempt non-blocking issuance on boot if domain+email are already saved
      if (map['tls_acme_domain'] && map['tls_acme_email']) {
        try {
          await this.obtainOrRenewAcmeCertificate({
            domain: map['tls_acme_domain'],
            email: map['tls_acme_email'],
            staging: map['tls_acme_staging'] === 'true'
          });
          if (fs.existsSync(ACME_CERT_PATH) && fs.existsSync(ACME_KEY_PATH)) {
            return {
              cert: fs.readFileSync(ACME_CERT_PATH),
              key: fs.readFileSync(ACME_KEY_PATH),
              source: 'acme'
            };
          }
        } catch (err: any) {
          console.warn('[TLS ACME] Boot issuance deferred:', err.message);
        }
      }
      return null;
    }

    if (mode === 'local_ca') {
      const local = this.ensureLocalCaAndLeafCertificates(map['tls_local_ca_hosts']);
      return {
        cert: Buffer.from(local.leafCertPem, 'utf8'),
        key: Buffer.from(local.leafKeyPem, 'utf8'),
        source: 'local_ca'
      };
    }

    // Legacy setup-ssl.sh custom cert fallback in proxy mode ONLY if user placed DATA_DIR/cert.pem + key.pem
    const legacyCert = path.join(DATA_DIR, 'cert.pem');
    const legacyKey = path.join(DATA_DIR, 'key.pem');
    if (fs.existsSync(legacyCert) && fs.existsSync(legacyKey)) {
      return {
        cert: fs.readFileSync(legacyCert),
        key: fs.readFileSync(legacyKey),
        source: 'custom_pem'
      };
    }

    return null;
  }

  public async attachServer(server: http.Server | https.Server, isHttps: boolean): Promise<void> {
    this.liveServer = server;
    this.activeIsHttps = isHttps;
    this.initialBootMode = await this.getEffectiveMode();

    const mode = this.initialBootMode;
    if (mode === 'acme') {
      this.ensureAcmeChallengeHttpServer().catch(() => {});
    }

    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = setInterval(() => {
      this.runPeriodicMaintenance().catch((err) => console.error('[TLS Maintenance Error]:', err));
    }, 12 * 60 * 60 * 1000);
    if (typeof this.schedulerTimer.unref === 'function') {
      this.schedulerTimer.unref();
    }
  }

  private async runPeriodicMaintenance(): Promise<void> {
    const mode = await this.getEffectiveMode();
    const map = await this.getSettingsMap();

    if (mode === 'acme' && map['tls_acme_domain'] && map['tls_acme_email']) {
      await this.obtainOrRenewAcmeCertificate({
        domain: map['tls_acme_domain'],
        email: map['tls_acme_email'],
        staging: map['tls_acme_staging'] === 'true',
        force: false
      });
    } else if (mode === 'local_ca') {
      const res = this.ensureLocalCaAndLeafCertificates(map['tls_local_ca_hosts']);
      if (res.regeneratedLeaf) {
        await this.reloadCertificates();
      }
    }
  }

  public async reloadCertificates(): Promise<boolean> {
    if (!this.liveServer || !this.activeIsHttps) return false;
    const creds = await this.getActiveHttpsCredentials();
    if (!creds) return false;
    try {
      (this.liveServer as https.Server).setSecureContext({
        cert: creds.cert,
        key: creds.key
      });
      console.log(`[TLS Manager] 🔁 Reloaded live HTTPS certificate (${creds.source}).`);
      return true;
    } catch (err) {
      console.error('[TLS Manager] Failed to hot-reload certificate:', err);
      return false;
    }
  }

  public async getStatus(req?: Request) {
    const mode = await this.getEffectiveMode();
    const map = await this.getSettingsMap();
    const trustProxyEnv = (process.env.TRUST_PROXY ?? '').trim();
    const rawTrustProxy = trustProxyEnv.length > 0 ? trustProxyEnv : (map['trust_proxy'] ?? 'false');

    const acmeCertInfo = parseCertificateDates(ACME_CERT_PATH);
    const localCaInfo = this.getLocalCaInfo();
    const localLeafInfo = parseCertificateDates(LOCAL_LEAF_CERT_PATH);
    const customCertInfo = parseCertificateDates(
      process.env.SSL_CERT ? path.resolve(process.env.SSL_CERT) : path.join(DATA_DIR, 'cert.pem')
    );

    const forwardedProto = req ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
    const effectiveProtocol = forwardedProto || (this.activeIsHttps ? 'https' : 'http');

    const wantsHttps = mode === 'acme' || mode === 'local_ca';
    const restartRequired = wantsHttps !== this.activeIsHttps && !(mode === 'proxy' && !this.activeIsHttps);

    return {
      mode,
      activeProtocol: this.activeIsHttps ? 'https' : 'http',
      effectiveProtocol,
      isHttps: effectiveProtocol === 'https',
      isBehindReverseProxy: !!forwardedProto,
      trustProxyRaw: rawTrustProxy,
      trustProxyEffective: parseTrustProxyValue(rawTrustProxy),
      trustProxyEnvLocked: trustProxyEnv.length > 0,
      tlsModeEnvLocked: !!(process.env.TLS_MODE || '').trim(),
      restartRequired,
      customPemPresent: !!customCertInfo,
      customPem: customCertInfo,
      acme: {
        domain: map['tls_acme_domain'] || '',
        email: map['tls_acme_email'] || '',
        staging: map['tls_acme_staging'] === 'true',
        hasCertificate: !!acmeCertInfo,
        expiresAt: acmeCertInfo?.validTo || null,
        daysRemaining: acmeCertInfo?.daysRemaining ?? null,
        subject: acmeCertInfo?.subject || null,
        issuer: acmeCertInfo?.issuer || null,
        lastError: this.acmeLastError,
        renewing: this.acmeRenewing,
        challengePortBound: this.acmeChallengePortBound
      },
      localCa: {
        initialized: localCaInfo.initialized,
        fingerprintSha256: localCaInfo.fingerprintSha256,
        caExpiresAt: localCaInfo.expiresAt,
        hosts: localCaInfo.hosts,
        customHosts: map['tls_local_ca_hosts'] || '',
        leafExpiresAt: localLeafInfo?.validTo || null,
        leafDaysRemaining: localLeafInfo?.daysRemaining ?? null,
        caDownloadUrl: '/api/tls/ca.crt'
      }
    };
  }

  public async updateConfig(params: {
    mode?: TlsMode;
    trustProxy?: string | boolean | number;
    acmeDomain?: string;
    acmeEmail?: string;
    acmeStaging?: boolean;
    localCaHosts?: string;
  }) {
    if (params.trustProxy !== undefined) {
      const valStr = typeof params.trustProxy === 'boolean'
        ? (params.trustProxy ? '1' : 'false')
        : String(params.trustProxy).trim() || 'false';
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['trust_proxy', valStr]);
      await this.applyTrustProxy();
    }

    if (params.acmeDomain !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
        'tls_acme_domain',
        String(params.acmeDomain).trim().toLowerCase()
      ]);
    }
    if (params.acmeEmail !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
        'tls_acme_email',
        String(params.acmeEmail).trim()
      ]);
    }
    if (params.acmeStaging !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
        'tls_acme_staging',
        params.acmeStaging ? 'true' : 'false'
      ]);
    }
    if (params.localCaHosts !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', [
        'tls_local_ca_hosts',
        String(params.localCaHosts).trim()
      ]);
    }

    if (params.mode && ['proxy', 'acme', 'local_ca'].includes(params.mode)) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['tls_mode', params.mode]);

      if (params.mode === 'proxy') {
        this.stopAcmeChallengeHttpServer();
      } else if (params.mode === 'local_ca') {
        const map = await this.getSettingsMap();
        this.ensureLocalCaAndLeafCertificates(params.localCaHosts ?? map['tls_local_ca_hosts']);
        await this.reloadCertificates();
      } else if (params.mode === 'acme') {
        await this.ensureAcmeChallengeHttpServer();
        const map = await this.getSettingsMap();
        const domain = params.acmeDomain ?? map['tls_acme_domain'];
        const email = params.acmeEmail ?? map['tls_acme_email'];
        const staging = params.acmeStaging ?? (map['tls_acme_staging'] === 'true');
        if (domain && email) {
          await this.obtainOrRenewAcmeCertificate({ domain, email, staging });
        }
      }
    }

    return this.getStatus();
  }
}

export const tlsManagerService = new TlsManagerService();

