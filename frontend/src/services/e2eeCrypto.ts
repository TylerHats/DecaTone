/**
 * DecaTone End-to-End Encryption (E2EE) & Zero-Access Vault Cryptography
 *
 * Dual-engine implementation compatible across HTTPS/localhost (native WebCrypto with
 * non-extractable CryptoKey persistence in IndexedDB) AND plain HTTP LAN deployments
 * (pure-JS @noble/curves + @noble/ciphers + @noble/hashes fallback, volatile RAM only).
 *
 * Byte formats match Backend Node.js & ESP32-S3 mbedTLS firmware identically:
 * - Curve: P-256 (uncompressed 65-byte raw public keys, 96-byte [d||X||Y] private bundles)
 * - KDFs: HKDF-SHA256 & PBKDF2-HMAC-SHA256 (150,000 iterations)
 * - AEAD: AES-256-GCM (12-byte IV, 16-byte authentication tag)
 * - Call Audio Frames: [0x01][keyId][iv12][tag16][ct] or [0x04][slot][keyId][iv12][tag16][ct]
 */

import { p256 } from '@noble/curves/nist.js';
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const LEGACY_SESSION_UNLOCKED_KEY = 'decatone_unlocked_key';
const VAULT_DB_NAME = 'decatone_vault_db';
const VAULT_DB_VERSION = 1;
const VAULT_STORE_NAME = 'identity_keys';
const VAULT_RECORD_ID = 'active';
const PBKDF2_ITERATIONS = 150000;
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// PGP/ZRTP-style unambiguous 256-word phonetic list for 2-word call Safety Codes
const SAFETY_WORDS: readonly string[] = [
  'Acorn', 'Admiral', 'Amber', 'Anchor', 'Apollo', 'Apricot', 'Arch', 'Arrow',
  'Aspen', 'Atlas', 'Aurora', 'Autumn', 'Badger', 'Bamboo', 'Banner', 'Basil',
  'Beacon', 'Beryl', 'Birch', 'Bison', 'Blaze', 'Bloom', 'Bolt', 'Bramble',
  'Brass', 'Breeze', 'Briar', 'Bridge', 'Bronze', 'Brook', 'Cactus', 'Cairn',
  'Calico', 'Canyon', 'Canvas', 'Capri', 'Carbon', 'Cedar', 'Chalet', 'Chime',
  'Cinder', 'Citron', 'Clover', 'Cobalt', 'Comet', 'Copper', 'Coral', 'Cornet',
  'Cosmic', 'Crane', 'Creek', 'Crest', 'Crimson', 'Crown', 'Crystal', 'Cypress',
  'Dagger', 'Daisy', 'Dancer', 'Dawn', 'Delta', 'Desert', 'Dial', 'Diamond',
  'Dolphin', 'Doric', 'Dragon', 'Drift', 'Drum', 'Dune', 'Dusk', 'Eagle',
  'Echo', 'Eclipse', 'Elder', 'Ember', 'Emerald', 'Enamel', 'Engine', 'Epoch',
  'Equinox', 'Ermine', 'Falcon', 'Fable', 'Fern', 'Fiesta', 'Finch', 'Fjord',
  'Flame', 'Flint', 'Flora', 'Forest', 'Forge', 'Fossil', 'Fox', 'Frost',
  'Gale', 'Garnet', 'Gazelle', 'Geyser', 'Ginger', 'Glacier', 'Glade', 'Gleam',
  'Globe', 'Gopher', 'Granite', 'Gravel', 'Grove', 'Harbor', 'Harvest', 'Hawk',
  'Hazel', 'Hearth', 'Helium', 'Heron', 'Hickory', 'Hollow', 'Horizon', 'Hound',
  'Indigo', 'Inlet', 'Iris', 'Iron', 'Island', 'Ivory', 'Ivy', 'Jackal',
  'Jade', 'Jaguar', 'Jasper', 'Javelin', 'Jet', 'Juniper', 'Kestrel', 'Kettle',
  'Keystone', 'Kiln', 'Kite', 'Knight', 'Lagoon', 'Lantern', 'Lark', 'Laurel',
  'Lava', 'Lemon', 'Leopard', 'Lichen', 'Lilac', 'Linden', 'Linnet', 'Lotus',
  'Lunar', 'Lynx', 'Magnet', 'Magpie', 'Maple', 'Marble', 'Marigold', 'Mariner',
  'Marrow', 'Marsh', 'Meadow', 'Mercury', 'Meteor', 'Mica', 'Miller', 'Mint',
  'Mirage', 'Mirth', 'Misty', 'Monarch', 'Moon', 'Moose', 'Mosaic', 'Moss',
  'Mulberry', 'Musket', 'Myrtle', 'Nautilus', 'Nebula', 'Nectar', 'Nickel', 'Nimbus',
  'Noble', 'North', 'Nutmeg', 'Oak', 'Oasis', 'Obsidian', 'Ocean', 'Ocelot',
  'Ochre', 'Olive', 'Onyx', 'Opal', 'Orchid', 'Oriole', 'Osprey', 'Otter',
  'Oxford', 'Ozone', 'Paddle', 'Pagoda', 'Palace', 'Palm', 'Panther', 'Paprika',
  'Parrot', 'Pebble', 'Pegasus', 'Pelican', 'Pepper', 'Peridot', 'Petal', 'Pewter',
  'Phoenix', 'Piazza', 'Picnic', 'Pigeon', 'Pine', 'Pinnacle', 'Pioneer', 'Piper',
  'Planet', 'Platinum', 'Plum', 'Plume', 'Polar', 'Poplar', 'Porcelain', 'Prairie',
  'Prism', 'Puffin', 'Pulse', 'Puma', 'Pyramid', 'Quail', 'Quartz', 'Quiver',
  'Rabbit', 'Radar', 'Radium', 'Rainbow', 'Ranger', 'Raven', 'Redwood', 'Reef'
];

// Volatile in-memory raw key bundle (never persisted to sessionStorage or localStorage)
let memoryUnlockedKeyBundle: Uint8Array | null = null;
// Non-extractable WebCrypto identity handles restored from IndexedDB
let vaultEcdhKey: CryptoKey | null = null;
let vaultEcdsaKey: CryptoKey | null = null;
let vaultPublicKeyB64: string | null = null;

export function hasSubtleCrypto(): boolean {
  return typeof window !== 'undefined' && Boolean(window.crypto?.subtle);
}

function randomBytes(length: number): Uint8Array {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    return window.crypto.getRandomValues(new Uint8Array(length));
  }
  throw new Error('Secure random number generator is unavailable in this environment');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToFixedBytes(b64url: string, length = 32): Uint8Array {
  const raw = base64ToBytes(b64url);
  if (raw.length === length) return raw;
  const out = new Uint8Array(length);
  if (raw.length < length) {
    out.set(raw, length - raw.length);
  } else {
    out.set(raw.subarray(raw.length - length));
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byteVal = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byteVal)) {
      throw new Error('Invalid hex character');
    }
    out[i] = byteVal;
  }
  return out;
}

function decodeHexOrBase64(val: string, expectedBytes?: number): Uint8Array {
  const trimmed = val.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    if (!expectedBytes || trimmed.length === expectedBytes * 2) {
      return hexToBytes(trimmed);
    }
  }
  return base64ToBytes(trimmed);
}

/**
 * Generates an unambiguous 160-bit Crockford Base32 Recovery Key formatted as 8x4 chars.
 */
export function generateRecoveryKey(): string {
  const raw = randomBytes(20); // 160 bits -> 32 base32 chars
  let chars = '';
  let buffer = 0;
  let bitsLeft = 0;
  for (let i = 0; i < raw.length; i++) {
    buffer = (buffer << 8) | raw[i];
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      chars += CROCKFORD_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    groups.push(chars.slice(i, i + 4));
  }
  return groups.join('-');
}

export function normalizeRecoveryKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

/**
 * Exports a WebCrypto ECDH P-256 private key into the canonical 96-byte [d(32B) || X(32B) || Y(32B)] bundle.
 */
export async function exportPrivateKeyBundle96(privateKey: CryptoKey): Promise<Uint8Array> {
  if (!hasSubtleCrypto()) {
    throw new Error('WebCrypto subtle API unavailable');
  }
  const jwk = await window.crypto.subtle.exportKey('jwk', privateKey);
  if (!jwk.d || !jwk.x || !jwk.y) {
    throw new Error('Failed to export P-256 JWK components');
  }
  const d = base64UrlToFixedBytes(jwk.d, 32);
  const x = base64UrlToFixedBytes(jwk.x, 32);
  const y = base64UrlToFixedBytes(jwk.y, 32);

  const bundle = new Uint8Array(96);
  bundle.set(d, 0);
  bundle.set(x, 32);
  bundle.set(y, 64);
  return bundle;
}

function validateAndImportBundle96Noble(bundle96: Uint8Array): {
  priv32: Uint8Array;
  pub65: Uint8Array;
} {
  if (bundle96.length !== 96) {
    throw new Error(`Invalid private key bundle length: expected 96 bytes, got ${bundle96.length}`);
  }
  const priv32 = bundle96.subarray(0, 32);
  const derivedPub65 = p256.getPublicKey(priv32, false);
  const declaredPub65 = new Uint8Array(65);
  declaredPub65[0] = 0x04;
  declaredPub65.set(bundle96.subarray(32, 96), 1);

  for (let i = 0; i < 65; i++) {
    if (derivedPub65[i] !== declaredPub65[i]) {
      throw new Error('Corrupted P-256 private key bundle (public coordinate mismatch)');
    }
  }
  return { priv32: new Uint8Array(priv32), pub65: derivedPub65 };
}

async function importBundle96AsCryptoKeys(
  bundle96: Uint8Array,
  extractable = false
): Promise<{ ecdhKey: CryptoKey; ecdsaKey: CryptoKey }> {
  if (bundle96.length !== 96) {
    throw new Error(`Invalid private key bundle length: expected 96 bytes, got ${bundle96.length}`);
  }
  const d = bytesToBase64Url(bundle96.subarray(0, 32));
  const x = bytesToBase64Url(bundle96.subarray(32, 64));
  const y = bytesToBase64Url(bundle96.subarray(64, 96));

  const jwkBase: JsonWebKey = { kty: 'EC', crv: 'P-256', x, y, d, ext: extractable };
  const [ecdhKey, ecdsaKey] = await Promise.all([
    window.crypto.subtle.importKey('jwk', jwkBase, { name: 'ECDH', namedCurve: 'P-256' }, extractable, ['deriveBits']),
    window.crypto.subtle.importKey('jwk', jwkBase, { name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign'])
  ]);
  return { ecdhKey, ecdsaKey };
}

/**
 * Imports a 96-byte [d(32B) || X(32B) || Y(32B)] bundle into a WebCrypto ECDH P-256 private CryptoKey.
 */
export async function importPrivateKeyBundle96(bundle96: Uint8Array): Promise<CryptoKey> {
  if (!hasSubtleCrypto()) {
    throw new Error('WebCrypto subtle API unavailable');
  }
  const { ecdhKey } = await importBundle96AsCryptoKeys(bundle96, true);
  return ecdhKey;
}

export function publicKeyBase64FromBundle96(bundle96: Uint8Array): string {
  if (bundle96.length !== 96) {
    throw new Error('Invalid 96-byte key bundle');
  }
  const pub65 = new Uint8Array(65);
  pub65[0] = 0x04;
  pub65.set(bundle96.subarray(32, 96), 1);
  return bytesToBase64(pub65);
}

function validateRawPubKey65(publicKeyBase64: string): Uint8Array {
  const rawBytes = base64ToBytes(publicKeyBase64);
  if (rawBytes.length !== 65 || rawBytes[0] !== 0x04 || !p256.utils.isValidPublicKey(rawBytes)) {
    throw new Error('Invalid P-256 uncompressed public key');
  }
  return rawBytes;
}

export async function importRawPublicKeyP256(publicKeyBase64: string): Promise<CryptoKey> {
  const rawBytes = validateRawPubKey65(publicKeyBase64);
  return window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

// ============================================================================
// Dual-Engine Cryptographic Primitives (WebCrypto + @noble/* Fallback)
// ============================================================================

async function sha256Digest(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const buf = await window.crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
    return new Uint8Array(buf);
  }
  return sha256(bytes);
}

async function aesGcmEncrypt32(rawKey32: Uint8Array | CryptoKey, iv12: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  if (hasSubtleCrypto() && rawKey32 instanceof CryptoKey) {
    const enc = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv12), tagLength: 128 },
      rawKey32,
      toArrayBuffer(plain)
    );
    return new Uint8Array(enc);
  }
  if (!(rawKey32 instanceof Uint8Array)) {
    throw new Error('Invalid AES key');
  }
  return gcm(rawKey32, iv12).encrypt(plain);
}

async function aesGcmDecrypt32(
  rawKey32: Uint8Array | CryptoKey,
  iv12: Uint8Array,
  cipherAndTag: Uint8Array
): Promise<Uint8Array> {
  if (hasSubtleCrypto() && rawKey32 instanceof CryptoKey) {
    const dec = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv12), tagLength: 128 },
      rawKey32,
      toArrayBuffer(cipherAndTag)
    );
    return new Uint8Array(dec);
  }
  if (!(rawKey32 instanceof Uint8Array)) {
    throw new Error('Invalid AES key');
  }
  return gcm(rawKey32, iv12).decrypt(cipherAndTag);
}

async function derivePbkdf2WrapKey(password: string, keySaltHex: string): Promise<CryptoKey | Uint8Array> {
  const pwBytes = utf8ToBytes(password);
  const saltBytes = hexToBytes(keySaltHex);
  if (hasSubtleCrypto()) {
    const pwKey = await window.crypto.subtle.importKey('raw', toArrayBuffer(pwBytes), 'PBKDF2', false, ['deriveKey']);
    return window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: toArrayBuffer(saltBytes), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      pwKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  return pbkdf2Async(sha256, pwBytes, saltBytes, { c: PBKDF2_ITERATIONS, dkLen: 32 });
}

async function deriveHkdfAesGcmKey(
  sharedSecret: ArrayBuffer | Uint8Array,
  saltBytes: Uint8Array,
  infoBytes: Uint8Array,
  usages: KeyUsage[] = ['encrypt', 'decrypt']
): Promise<CryptoKey | Uint8Array> {
  const secretBytes = sharedSecret instanceof Uint8Array ? sharedSecret : new Uint8Array(sharedSecret);
  if (hasSubtleCrypto()) {
    const hkdfBaseKey = await window.crypto.subtle.importKey('raw', toArrayBuffer(secretBytes), 'HKDF', false, [
      'deriveKey'
    ]);
    return window.crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(saltBytes), info: toArrayBuffer(infoBytes) },
      hkdfBaseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }
  return hkdf(sha256, secretBytes, saltBytes, infoBytes, 32);
}

async function deriveHkdfRaw32(
  ikmBytes: Uint8Array,
  saltBytes: Uint8Array,
  infoBytes: Uint8Array
): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const baseKey = await window.crypto.subtle.importKey('raw', toArrayBuffer(ikmBytes), 'HKDF', false, ['deriveBits']);
    const bits = await window.crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(saltBytes), info: toArrayBuffer(infoBytes) },
      baseKey,
      256
    );
    return new Uint8Array(bits);
  }
  return hkdf(sha256, ikmBytes, saltBytes, infoBytes, 32);
}

function generateP256BundleAndPub(): { bundle96: Uint8Array; pub65: Uint8Array } {
  const { secretKey } = p256.keygen();
  const pub65 = p256.getPublicKey(secretKey, false);
  const bundle96 = new Uint8Array(96);
  bundle96.set(secretKey, 0);
  bundle96.set(pub65.subarray(1, 65), 32);
  return { bundle96, pub65 };
}

function ecdhSharedXNoble(priv32: Uint8Array, peerPub65: Uint8Array): Uint8Array {
  const compressed = p256.getSharedSecret(priv32, peerPub65, true);
  return compressed.subarray(1, 33);
}

// ============================================================================
// Password & Recovery Key Wrapping (Shared Wire Format)
// ============================================================================

async function wrapBundle96WithSecret(
  bundle96: Uint8Array,
  secret: string,
  existingSaltHex?: string
): Promise<{ keySalt: string; encryptedPrivateKey: string; encryptionPublicKey: string }> {
  const saltBytes = existingSaltHex ? hexToBytes(existingSaltHex) : randomBytes(16);
  const keySalt = bytesToHex(saltBytes);
  const wrapKey = await derivePbkdf2WrapKey(secret, keySalt);
  const iv = randomBytes(12);

  const encryptedBytes = await aesGcmEncrypt32(wrapKey, iv, bundle96);
  const cipher96 = encryptedBytes.subarray(0, 96);
  const tag16 = encryptedBytes.subarray(96, 112);

  // Canonical DB wire format: [iv(12B) || tag(16B) || ciphertext(96B)] = 124 bytes
  const wire124 = new Uint8Array(124);
  wire124.set(iv, 0);
  wire124.set(tag16, 12);
  wire124.set(cipher96, 28);

  return {
    keySalt,
    encryptedPrivateKey: bytesToBase64(wire124),
    encryptionPublicKey: publicKeyBase64FromBundle96(bundle96)
  };
}

async function unwrapBundle96WithSecret(
  secret: string,
  saltHex: string,
  encryptedPrivateKey: string
): Promise<Uint8Array> {
  const wire = base64ToBytes(encryptedPrivateKey);
  if (wire.length !== 124) {
    throw new Error('Invalid encrypted private key format');
  }

  const iv12 = wire.subarray(0, 12);
  const tag16 = wire.subarray(12, 28);
  const cipher96 = wire.subarray(28, 124);

  const combinedCipher = new Uint8Array(112);
  combinedCipher.set(cipher96, 0);
  combinedCipher.set(tag16, 96);

  const wrapKey = await derivePbkdf2WrapKey(secret, saltHex);
  let bundle96: Uint8Array;
  try {
    bundle96 = await aesGcmDecrypt32(wrapKey, iv12, combinedCipher);
  } catch {
    throw new Error('Incorrect passphrase/recovery key or unable to unwrap encryption key');
  }
  validateAndImportBundle96Noble(bundle96);
  return bundle96;
}

export async function wrapBundle96WithPassword(
  bundle96: Uint8Array,
  password: string,
  existingSaltHex?: string
): Promise<{ keySalt: string; encryptedPrivateKey: string; encryptionPublicKey: string }> {
  return wrapBundle96WithSecret(bundle96, password, existingSaltHex);
}

export async function wrapBundle96WithRecoveryKey(
  bundle96: Uint8Array,
  recoveryKey: string
): Promise<{ recoveryKeySalt: string; recoveryEncryptedPrivateKey: string }> {
  const wrapped = await wrapBundle96WithSecret(bundle96, normalizeRecoveryKey(recoveryKey));
  return {
    recoveryKeySalt: wrapped.keySalt,
    recoveryEncryptedPrivateKey: wrapped.encryptedPrivateKey
  };
}

export async function unwrapBundle96WithRecoveryKey(
  recoveryKey: string,
  recoveryKeySalt: string,
  recoveryEncryptedPrivateKey: string,
  expectedPublicKeyBase64?: string | null
): Promise<Uint8Array> {
  const bundle96 = await unwrapBundle96WithSecret(
    normalizeRecoveryKey(recoveryKey),
    recoveryKeySalt,
    recoveryEncryptedPrivateKey
  );
  if (expectedPublicKeyBase64 && publicKeyBase64FromBundle96(bundle96) !== expectedPublicKeyBase64) {
    throw new Error('Recovery key does not match your account identity key');
  }
  await cacheUnlockedKeyBundleAsync(bundle96);
  return bundle96;
}

// ============================================================================
// Non-Extractable IndexedDB Vault & Volatile RAM Cache (Zero sessionStorage)
// ============================================================================

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
          db.createObjectStore(VAULT_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistVaultToIndexedDb(bundle96: Uint8Array): Promise<void> {
  if (!hasSubtleCrypto()) return;
  try {
    const pubB64 = publicKeyBase64FromBundle96(bundle96);
    const { ecdhKey, ecdsaKey } = await importBundle96AsCryptoKeys(bundle96, false);
    vaultEcdhKey = ecdhKey;
    vaultEcdsaKey = ecdsaKey;
    vaultPublicKeyB64 = pubB64;

    const db = await openVaultDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      tx.objectStore(VAULT_STORE_NAME).put({
        id: VAULT_RECORD_ID,
        publicKeyB64: pubB64,
        ecdhPrivateKey: ecdhKey,
        ecdsaPrivateKey: ecdsaKey,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // IndexedDB unavailable (e.g. private browsing)
  }
}

async function deleteVaultFromIndexedDb(): Promise<void> {
  try {
    const db = await openVaultDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      tx.objectStore(VAULT_STORE_NAME).delete(VAULT_RECORD_ID);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore storage cleanup errors
  }
}

export async function restoreVaultFromIndexedDb(expectedPublicKeyBase64?: string | null): Promise<boolean> {
  try {
    sessionStorage.removeItem(LEGACY_SESSION_UNLOCKED_KEY);
  } catch {
    // Ignore
  }

  if (memoryUnlockedKeyBundle?.length === 96) {
    if (!expectedPublicKeyBase64 || publicKeyBase64FromBundle96(memoryUnlockedKeyBundle) === expectedPublicKeyBase64) {
      return true;
    }
    clearUnlockedKey();
    return false;
  }

  if (!hasSubtleCrypto()) return false;
  const db = await openVaultDb();
  if (!db) return false;

  const record = await new Promise<any>((resolve) => {
    try {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const req = tx.objectStore(VAULT_STORE_NAME).get(VAULT_RECORD_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });

  if (!record || !record.ecdhPrivateKey || !record.ecdsaPrivateKey || !record.publicKeyB64) {
    return false;
  }

  if (expectedPublicKeyBase64 && record.publicKeyB64 !== expectedPublicKeyBase64) {
    await deleteVaultFromIndexedDb();
    return false;
  }

  vaultEcdhKey = record.ecdhPrivateKey;
  vaultEcdsaKey = record.ecdsaPrivateKey;
  vaultPublicKeyB64 = record.publicKeyB64;
  return true;
}

export function purgeLegacyStorageKeys(): void {
  try {
    localStorage.removeItem('decatone_token');
    sessionStorage.removeItem(LEGACY_SESSION_UNLOCKED_KEY);
  } catch {
    // Ignore
  }
}

export async function cacheUnlockedKeyBundleAsync(bundle96: Uint8Array): Promise<void> {
  if (bundle96.length !== 96) return;
  const copy = new Uint8Array(96);
  copy.set(bundle96);
  memoryUnlockedKeyBundle = copy;
  vaultPublicKeyB64 = publicKeyBase64FromBundle96(copy);
  await persistVaultToIndexedDb(copy);
}

export function cacheUnlockedKeyBundle(bundle96: Uint8Array): void {
  void cacheUnlockedKeyBundleAsync(bundle96);
}

export function getUnlockedKeyBundle(): Uint8Array | null {
  if (memoryUnlockedKeyBundle && memoryUnlockedKeyBundle.length === 96) {
    return memoryUnlockedKeyBundle;
  }
  return null;
}

export function hasRawKeyInMemory(): boolean {
  return memoryUnlockedKeyBundle !== null && memoryUnlockedKeyBundle.length === 96;
}

export function isPrivateKeyUnlocked(): boolean {
  return hasRawKeyInMemory() || vaultEcdhKey !== null;
}

export function clearUnlockedKey(): void {
  if (memoryUnlockedKeyBundle) {
    memoryUnlockedKeyBundle.fill(0);
    memoryUnlockedKeyBundle = null;
  }
  vaultEcdhKey = null;
  vaultEcdsaKey = null;
  vaultPublicKeyB64 = null;
  try {
    sessionStorage.removeItem(LEGACY_SESSION_UNLOCKED_KEY);
  } catch {
    // Ignore
  }
  void deleteVaultFromIndexedDb();
}

// ============================================================================
// User Key Lifecycle (Signup, Login Unlock, Change Password, Reset)
// ============================================================================

export async function generateUserKeyBundle(password: string, recoveryKey?: string): Promise<{
  encryptionPublicKey: string;
  encryptedPrivateKey: string;
  keySalt: string;
  recoveryKeySalt?: string;
  recoveryEncryptedPrivateKey?: string;
}> {
  let bundle96: Uint8Array;
  let rawPub65: Uint8Array;

  if (hasSubtleCrypto()) {
    const keyPair = await window.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    rawPub65 = new Uint8Array(await window.crypto.subtle.exportKey('raw', keyPair.publicKey));
    bundle96 = await exportPrivateKeyBundle96(keyPair.privateKey);
  } else {
    const gen = generateP256BundleAndPub();
    bundle96 = gen.bundle96;
    rawPub65 = gen.pub65;
  }

  const wrapped = await wrapBundle96WithPassword(bundle96, password);
  await cacheUnlockedKeyBundleAsync(bundle96);

  let recWrapped: { recoveryKeySalt: string; recoveryEncryptedPrivateKey: string } | undefined;
  if (recoveryKey && normalizeRecoveryKey(recoveryKey).length >= 16) {
    recWrapped = await wrapBundle96WithRecoveryKey(bundle96, recoveryKey);
  }

  return {
    encryptionPublicKey: bytesToBase64(rawPub65),
    encryptedPrivateKey: wrapped.encryptedPrivateKey,
    keySalt: wrapped.keySalt,
    ...(recWrapped || {})
  };
}

export async function unlockPrivateKeyWithPassword(
  password: string,
  keySalt: string,
  encryptedPrivateKey: string
): Promise<Uint8Array> {
  const bundle96 = await unwrapBundle96WithSecret(password, keySalt, encryptedPrivateKey);
  await cacheUnlockedKeyBundleAsync(bundle96);
  return bundle96;
}

export async function rewrapUserKeyBundleForPasswordChange(
  currentPassword: string,
  newPassword: string,
  currentKeySalt?: string | null,
  currentEncryptedPrivateKey?: string | null
): Promise<{
  encryptionPublicKey: string;
  encryptedPrivateKey: string;
  keySalt: string;
}> {
  let bundle96 = getUnlockedKeyBundle();
  if (!bundle96 && currentKeySalt && currentEncryptedPrivateKey) {
    bundle96 = await unlockPrivateKeyWithPassword(currentPassword, currentKeySalt, currentEncryptedPrivateKey);
  }
  if (!bundle96) {
    return generateUserKeyBundle(newPassword);
  }
  const wrapped = await wrapBundle96WithPassword(bundle96, newPassword);
  await cacheUnlockedKeyBundleAsync(bundle96);
  return wrapped;
}

// ============================================================================
// Voicemail ECIES Decryption & Hardware Device Key Wrapping
// ============================================================================

async function deriveSharedSecretWithActiveIdentity(peerPub65: Uint8Array): Promise<Uint8Array> {
  if (hasSubtleCrypto() && vaultEcdhKey) {
    const peerPubKey = await window.crypto.subtle.importKey(
      'raw',
      toArrayBuffer(peerPub65),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
    const bits = await window.crypto.subtle.deriveBits({ name: 'ECDH', public: peerPubKey }, vaultEcdhKey, 256);
    return new Uint8Array(bits);
  }

  const bundle96 = getUnlockedKeyBundle();
  if (!bundle96) {
    throw new Error('Private key is locked. Please unlock your Zero-Access Vault with your password.');
  }

  if (hasSubtleCrypto()) {
    const privKey = await importPrivateKeyBundle96(bundle96);
    const peerPubKey = await window.crypto.subtle.importKey(
      'raw',
      toArrayBuffer(peerPub65),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
    const bits = await window.crypto.subtle.deriveBits({ name: 'ECDH', public: peerPubKey }, privKey, 256);
    return new Uint8Array(bits);
  }

  return ecdhSharedXNoble(bundle96.subarray(0, 32), peerPub65);
}

export async function decryptVoicemailPayload(payload: {
  ephemeralPublicKey: string;
  iv: string;
  tag: string;
  ciphertextBase64?: string;
  ciphertext?: string;
}): Promise<ArrayBuffer> {
  if (!isPrivateKeyUnlocked()) {
    throw new Error('Private key is locked. Please unlock your Zero-Access Vault with your password.');
  }

  const cipherB64 = payload.ciphertextBase64 ?? payload.ciphertext;
  if (!cipherB64) {
    throw new Error('Missing encrypted voicemail ciphertext');
  }

  const ephPub65 = validateRawPubKey65(payload.ephemeralPublicKey);
  const sharedSecret = await deriveSharedSecretWithActiveIdentity(ephPub65);
  const aesKey = await deriveHkdfAesGcmKey(
    sharedSecret,
    utf8ToBytes('decatone-vm-ecies-v1'),
    utf8ToBytes('voicemail-aes256gcm'),
    ['decrypt']
  );

  const ivBytes = decodeHexOrBase64(payload.iv, 12);
  const tagBytes = decodeHexOrBase64(payload.tag, 16);
  const cipherBytes = base64ToBytes(cipherB64);

  const combined = new Uint8Array(cipherBytes.length + tagBytes.length);
  combined.set(cipherBytes, 0);
  combined.set(tagBytes, cipherBytes.length);

  const plainBytes = await aesGcmDecrypt32(aesKey, ivBytes, combined);
  return toArrayBuffer(plainBytes);
}

/**
 * Wraps the user's raw 96-byte private key bundle for a paired ESP32-S3 hardware phone.
 * Requires the raw 96-byte key in RAM (`hasRawKeyInMemory()`); returns null if locked or after reload.
 */
export async function wrapUserKeyForDevice(devicePublicKeyBase64: string): Promise<string | null> {
  const bundle96 = getUnlockedKeyBundle();
  if (!bundle96 || !devicePublicKeyBase64) {
    return null;
  }

  const devicePub65 = validateRawPubKey65(devicePublicKeyBase64);
  let ephPub65: Uint8Array;
  let sharedSecret: Uint8Array;

  if (hasSubtleCrypto()) {
    const devicePubKey = await importRawPublicKeyP256(devicePublicKeyBase64);
    const ephKeyPair = await window.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits'
    ]);
    ephPub65 = new Uint8Array(await window.crypto.subtle.exportKey('raw', ephKeyPair.publicKey));
    const bits = await window.crypto.subtle.deriveBits({ name: 'ECDH', public: devicePubKey }, ephKeyPair.privateKey, 256);
    sharedSecret = new Uint8Array(bits);
  } else {
    const gen = generateP256BundleAndPub();
    ephPub65 = gen.pub65;
    sharedSecret = ecdhSharedXNoble(gen.bundle96.subarray(0, 32), devicePub65);
  }

  const aesKey = await deriveHkdfAesGcmKey(
    sharedSecret,
    utf8ToBytes('decatone-dev-wrap-v1'),
    utf8ToBytes('device-vm-key'),
    ['encrypt']
  );

  const iv12 = randomBytes(12);
  const encryptedBytes = await aesGcmEncrypt32(aesKey, iv12, bundle96);
  const cipher96 = encryptedBytes.subarray(0, 96);
  const tag16 = encryptedBytes.subarray(96, 112);

  return JSON.stringify({
    ephemeralPublicKey: bytesToBase64(ephPub65),
    iv: bytesToHex(iv12),
    tag: bytesToHex(tag16),
    ciphertext: bytesToBase64(cipher96)
  });
}

// ============================================================================
// Call E2EE Ephemeral Identity Signing, Safety Words & Multi-Party Framing
// ============================================================================

export async function signEphemeralKey(callId: string, ephPublicKeyB64: string): Promise<{
  identityPublicKey: string;
  signature: string;
} | null> {
  const msg = utf8ToBytes(`decatone-e2ee-v1:${callId}:${ephPublicKeyB64}`);

  if (hasSubtleCrypto() && vaultEcdsaKey && vaultPublicKeyB64) {
    const sigBuf = await window.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vaultEcdsaKey, toArrayBuffer(msg));
    return {
      identityPublicKey: vaultPublicKeyB64,
      signature: bytesToBase64(new Uint8Array(sigBuf))
    };
  }

  const bundle96 = getUnlockedKeyBundle();
  if (!bundle96) return null;

  const identityPublicKey = publicKeyBase64FromBundle96(bundle96);
  if (hasSubtleCrypto()) {
    const { ecdsaKey } = await importBundle96AsCryptoKeys(bundle96, false);
    const sigBuf = await window.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ecdsaKey, toArrayBuffer(msg));
    return {
      identityPublicKey,
      signature: bytesToBase64(new Uint8Array(sigBuf))
    };
  }

  const sig64 = p256.sign(msg, bundle96.subarray(0, 32));
  return {
    identityPublicKey,
    signature: bytesToBase64(sig64)
  };
}

export async function verifyPeerEphemeralKey(params: {
  callId: string;
  ephPublicKeyB64: string;
  signature?: string | null;
  identityPublicKey?: string | null;
  expectedIdentityPublicKey?: string | null;
}): Promise<'verified' | 'unverified' | 'mismatch'> {
  const { callId, ephPublicKeyB64, signature, identityPublicKey, expectedIdentityPublicKey } = params;
  if (!signature || !identityPublicKey) {
    return 'unverified';
  }
  if (expectedIdentityPublicKey && expectedIdentityPublicKey !== identityPublicKey) {
    return 'mismatch';
  }

  try {
    const rawPub65 = validateRawPubKey65(identityPublicKey);
    const sigBytes = base64ToBytes(signature);
    if (sigBytes.length !== 64) {
      return 'mismatch';
    }
    const msg = utf8ToBytes(`decatone-e2ee-v1:${callId}:${ephPublicKeyB64}`);

    if (hasSubtleCrypto()) {
      const pubKey = await window.crypto.subtle.importKey(
        'raw',
        toArrayBuffer(rawPub65),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      const valid = await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pubKey,
        toArrayBuffer(sigBytes),
        toArrayBuffer(msg)
      );
      return valid ? 'verified' : 'mismatch';
    }

    const valid = p256.verify(sigBytes, msg, rawPub65, { lowS: false });
    return valid ? 'verified' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

export async function computeSafetyWords(mediaKey32: Uint8Array, callId: string): Promise<string> {
  const derived = await deriveHkdfRaw32(mediaKey32, utf8ToBytes(callId), utf8ToBytes('decatone-sas-v1'));
  const w1 = SAFETY_WORDS[derived[0] & 0xff];
  const w2 = SAFETY_WORDS[derived[1] & 0xff];
  return `${w1} ${w2}`;
}

export class CallE2eeSession {
  private readonly callId: string;
  private keyLeader: boolean;
  private ephCryptoPair: CryptoKeyPair | null = null;
  private ephBundle96: Uint8Array | null = null;
  private publicKeyB64: string = '';
  private keyId: number = 1;
  private mediaKeyBytes: Uint8Array | null = null;
  private mediaActiveKey: CryptoKey | Uint8Array | null = null;
  private mediaKeysById = new Map<number, CryptoKey | Uint8Array>();
  private safetyCode: string | null = null;
  private safetyHex: string | null = null;
  private readonly ivSalt4: Uint8Array;
  private txCounterHi = 0;
  private txCounterLo = 0;

  constructor(callId: string, isKeyLeader: boolean) {
    this.callId = String(callId || 'call');
    this.keyLeader = isKeyLeader;
    this.ivSalt4 = randomBytes(4);
  }

  public isLeader(): boolean {
    return this.keyLeader;
  }

  public promoteToLeader(): void {
    this.keyLeader = true;
  }

  public isReady(): boolean {
    return this.mediaActiveKey !== null;
  }

  public getPublicKeyBase64(): string {
    return this.publicKeyB64;
  }

  public getSafetyCode(): string | null {
    return this.safetyCode;
  }

  public getSafetyHex(): string | null {
    return this.safetyHex;
  }

  public async init(): Promise<void> {
    if (hasSubtleCrypto()) {
      this.ephCryptoPair = await window.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
        'deriveBits'
      ]);
      const rawPub65 = new Uint8Array(await window.crypto.subtle.exportKey('raw', this.ephCryptoPair.publicKey));
      this.publicKeyB64 = bytesToBase64(rawPub65);
    } else {
      const gen = generateP256BundleAndPub();
      this.ephBundle96 = gen.bundle96;
      this.publicKeyB64 = bytesToBase64(gen.pub65);
    }

    if (this.keyLeader) {
      const rawMediaKey = randomBytes(32);
      await this.installMediaKey(1, rawMediaKey);
    }
  }

  private async installMediaKey(keyId: number, rawMediaKey: Uint8Array): Promise<string> {
    const keyCopy = new Uint8Array(32);
    keyCopy.set(rawMediaKey.subarray(0, 32));
    this.keyId = keyId & 0xff;
    this.mediaKeyBytes = keyCopy;

    let keyHandle: CryptoKey | Uint8Array;
    if (hasSubtleCrypto()) {
      keyHandle = await window.crypto.subtle.importKey(
        'raw',
        toArrayBuffer(keyCopy),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      keyHandle = keyCopy;
    }

    this.mediaActiveKey = keyHandle;
    // Keep up to 4 active/previous keys in ring buffer for rekeying tolerance
    if (this.mediaKeysById.has(this.keyId)) {
      this.mediaKeysById.delete(this.keyId);
    }
    this.mediaKeysById.set(this.keyId, keyHandle);
    while (this.mediaKeysById.size > 4) {
      const oldestKeyId = this.mediaKeysById.keys().next().value;
      if (oldestKeyId !== undefined) {
        this.mediaKeysById.delete(oldestKeyId);
      }
    }

    const hashBytes = await sha256Digest(keyCopy);
    const p0 = hashBytes[0].toString(16).padStart(2, '0').toUpperCase();
    const p1 = hashBytes[1].toString(16).padStart(2, '0').toUpperCase();
    const p2 = hashBytes[2].toString(16).padStart(2, '0').toUpperCase();
    this.safetyHex = `${p0}-${p1}-${p2}`;
    this.safetyCode = await computeSafetyWords(keyCopy, this.callId);
    return this.safetyCode;
  }

  private async deriveCallSharedSecret(peerPublicKeyBase64: string): Promise<Uint8Array> {
    const peerPub65 = validateRawPubKey65(peerPublicKeyBase64);
    if (hasSubtleCrypto() && this.ephCryptoPair) {
      const peerPubKey = await importRawPublicKeyP256(peerPublicKeyBase64);
      const bits = await window.crypto.subtle.deriveBits(
        { name: 'ECDH', public: peerPubKey },
        this.ephCryptoPair.privateKey,
        256
      );
      return new Uint8Array(bits);
    }
    if (this.ephBundle96) {
      return ecdhSharedXNoble(this.ephBundle96.subarray(0, 32), peerPub65);
    }
    throw new Error('CallE2eeSession keypair not initialized');
  }

  public async wrapMediaKeyForPeer(peerPublicKeyBase64: string): Promise<{
    keyId: number;
    iv: string;
    tag: string;
    wrappedKey: string;
    senderPublicKey: string;
  }> {
    if (!this.mediaKeyBytes) {
      throw new Error('CallE2eeSession leader media key is not initialized');
    }

    const sharedSecret = await this.deriveCallSharedSecret(peerPublicKeyBase64);
    const wrapKey = await deriveHkdfAesGcmKey(
      sharedSecret,
      utf8ToBytes(this.callId),
      utf8ToBytes('decatone-call-key-v1'),
      ['encrypt']
    );

    const plain33 = new Uint8Array(33);
    plain33[0] = this.keyId & 0xff;
    plain33.set(this.mediaKeyBytes, 1);

    const iv12 = randomBytes(12);
    const encryptedBytes = await aesGcmEncrypt32(wrapKey, iv12, plain33);
    const cipher33 = encryptedBytes.subarray(0, 33);
    const tag16 = encryptedBytes.subarray(33, 49);

    return {
      keyId: this.keyId,
      iv: bytesToBase64(iv12),
      tag: bytesToBase64(tag16),
      wrappedKey: bytesToBase64(cipher33),
      senderPublicKey: this.publicKeyB64
    };
  }

  public async receiveWrappedMediaKey(payload: {
    keyId?: number;
    iv: string;
    tag: string;
    wrappedKey: string;
    senderPublicKey: string;
  }): Promise<string> {
    const sharedSecret = await this.deriveCallSharedSecret(payload.senderPublicKey);
    const wrapKey = await deriveHkdfAesGcmKey(
      sharedSecret,
      utf8ToBytes(this.callId),
      utf8ToBytes('decatone-call-key-v1'),
      ['decrypt']
    );

    const iv12 = base64ToBytes(payload.iv);
    const tag16 = base64ToBytes(payload.tag);
    const cipher33 = base64ToBytes(payload.wrappedKey);

    const combined = new Uint8Array(cipher33.length + tag16.length);
    combined.set(cipher33, 0);
    combined.set(tag16, cipher33.length);

    const plain = await aesGcmDecrypt32(wrapKey, iv12, combined);
    if (plain.length !== 33) {
      throw new Error(`Invalid unwrapped call key payload length: ${plain.length}`);
    }

    const receivedKeyId = plain[0];
    const mediaKey = plain.subarray(1, 33);
    return this.installMediaKey(receivedKeyId, mediaKey);
  }

  private nextFrameIv(): Uint8Array {
    this.txCounterLo = (this.txCounterLo + 1) >>> 0;
    if (this.txCounterLo === 0) {
      this.txCounterHi = (this.txCounterHi + 1) >>> 0;
    }

    const iv = new Uint8Array(12);
    iv.set(this.ivSalt4, 0);
    const view = new DataView(iv.buffer);
    view.setUint32(4, this.txCounterHi, false);
    view.setUint32(8, this.txCounterLo, false);
    return iv;
  }

  public async encryptPcmFrame(int16Buffer: Int16Array): Promise<Uint8Array> {
    if (!this.mediaActiveKey) {
      throw new Error('Media key not established');
    }

    const iv12 = this.nextFrameIv();
    const pcmBytes = new Uint8Array(int16Buffer.buffer, int16Buffer.byteOffset, int16Buffer.byteLength);
    const encryptedBytes = await aesGcmEncrypt32(this.mediaActiveKey, iv12, pcmBytes);
    const cipherLen = encryptedBytes.length - 16;
    const cipher = encryptedBytes.subarray(0, cipherLen);
    const tag16 = encryptedBytes.subarray(cipherLen, encryptedBytes.length);

    // [0x01][keyId(1B)][iv(12B)][tag(16B)][ciphertext...]
    const frame = new Uint8Array(30 + cipherLen);
    frame[0] = 0x01;
    frame[1] = this.keyId & 0xff;
    frame.set(iv12, 2);
    frame.set(tag16, 14);
    frame.set(cipher, 30);
    return frame;
  }

  public async decryptPcmFrameWithSlot(
    frameBytes: Uint8Array
  ): Promise<{ senderSlot: number; pcm: Int16Array } | null> {
    if (frameBytes.length < 32) return null;

    let senderSlot = 0;
    let offset = 1;
    if (frameBytes[0] === 0x04) {
      if (frameBytes.length <= 31) return null;
      senderSlot = frameBytes[1];
      offset = 2;
    } else if (frameBytes[0] !== 0x01) {
      return null;
    }

    const frameKeyId = frameBytes[offset];
    const key = this.mediaKeysById.get(frameKeyId) || this.mediaActiveKey;
    if (!key) return null;

    const iv12 = frameBytes.subarray(offset + 1, offset + 13);
    const tag16 = frameBytes.subarray(offset + 13, offset + 29);
    const cipher = frameBytes.subarray(offset + 29);
    if (cipher.length === 0) return null;

    const combined = new Uint8Array(cipher.length + 16);
    combined.set(cipher, 0);
    combined.set(tag16, cipher.length);

    try {
      const decryptedBytes = await aesGcmDecrypt32(key, iv12, combined);
      const validByteLen = decryptedBytes.byteLength - (decryptedBytes.byteLength % 2);
      const pcmBuf = decryptedBytes.buffer.slice(decryptedBytes.byteOffset, decryptedBytes.byteOffset + validByteLen);
      return { senderSlot, pcm: new Int16Array(pcmBuf) };
    } catch {
      return null;
    }
  }

  public async decryptPcmFrame(frameBytes: Uint8Array): Promise<Int16Array | null> {
    const res = await this.decryptPcmFrameWithSlot(frameBytes);
    return res ? res.pcm : null;
  }
}
