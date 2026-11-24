import crypto from 'crypto';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: string;
  tag: string;
  envelopeKey: string;
}

export interface SealedVoicemailPayload {
  ciphertext: Buffer;
  iv: string;
  tag: string;
  ephemeralPublicKey: string;
}

export interface UserKeyBundle {
  encryptionPublicKey: string;
  encryptedPrivateKey: string;
  keySalt: string;
}

export interface WrappedDeviceVmKey {
  ephemeralPublicKey: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function pbkdf2Async(password: string | Buffer, salt: Buffer, iterations: number, keylen: number, digest: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keylen, digest, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

function padTo32Bytes(buf: Buffer): Buffer {
  if (buf.length === 32) return Buffer.from(buf);
  const out = Buffer.alloc(32);
  if (buf.length > 32) {
    buf.subarray(buf.length - 32).copy(out);
  } else {
    buf.copy(out, 32 - buf.length);
  }
  return out;
}

export class VoicemailCryptoService {
  public static readonly PBKDF2_ITERATIONS = 150000;
  public static readonly VM_ECIES_SALT = 'decatone-vm-ecies-v1';
  public static readonly VM_ECIES_INFO = 'voicemail-aes256gcm';
  public static readonly DEV_WRAP_SALT = 'decatone-dev-wrap-v1';
  public static readonly DEV_WRAP_INFO = 'device-vm-key';

  /**
   * Asynchronously generates a fresh P-256 keypair and wraps the 96-byte [d(32B)||X(32B)||Y(32B)]
   * private bundle using PBKDF2-SHA256 (150,000 iterations) + AES-256-GCM.
   * Immediately zeroes all sensitive key material in RAM.
   */
  public static async generateUserKeyBundle(password: string): Promise<UserKeyBundle> {
    const ecdh = crypto.createECDH('prime256v1');
    const pub65 = ecdh.generateKeys(); // 65 bytes: 0x04 || X(32B) || Y(32B)
    const rawPriv = ecdh.getPrivateKey();
    const d32 = padTo32Bytes(rawPriv);
    rawPriv.fill(0);

    const bundle96 = Buffer.alloc(96);
    d32.copy(bundle96, 0);
    pub65.subarray(1, 65).copy(bundle96, 32);
    d32.fill(0);

    const saltBuf = crypto.randomBytes(16);
    const keySalt = saltBuf.toString('hex');

    const wrapKey = await pbkdf2Async(
      Buffer.from(password, 'utf8'),
      saltBuf,
      this.PBKDF2_ITERATIONS,
      32,
      'sha256'
    );

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, iv);
    const ciphertext = Buffer.concat([cipher.update(bundle96), cipher.final()]);
    const tag = cipher.getAuthTag();

    bundle96.fill(0);
    wrapKey.fill(0);

    // Wire format: Base64 of [iv(12B) || tag(16B) || ciphertext(96B)]
    const packed = Buffer.concat([iv, tag, ciphertext]);

    return {
      encryptionPublicKey: pub65.toString('base64'),
      encryptedPrivateKey: packed.toString('base64'),
      keySalt
    };
  }

  /**
   * Unwraps a password-protected user private key bundle (used for client-compatible verification/tests).
   */
  public static async unwrapUserKeyBundle(
    encryptedPrivateKeyBase64: string,
    keySaltHex: string,
    password: string
  ): Promise<{ d: Buffer; publicKey: Buffer; bundle96: Buffer }> {
    const packed = Buffer.from(encryptedPrivateKeyBase64, 'base64');
    if (packed.length < 12 + 16 + 32) {
      throw new Error('Invalid encrypted private key bundle length');
    }

    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);

    const wrapKey = await pbkdf2Async(
      Buffer.from(password, 'utf8'),
      Buffer.from(keySaltHex, 'hex'),
      this.PBKDF2_ITERATIONS,
      32,
      'sha256'
    );

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, iv);
      decipher.setAuthTag(tag);
      const bundle96 = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const d = Buffer.from(bundle96.subarray(0, 32));
      const publicKey = Buffer.concat([Buffer.from([0x04]), bundle96.subarray(32, 96)]);
      return { d, publicKey, bundle96 };
    } finally {
      wrapKey.fill(0);
    }
  }

  /**
   * Zero-Access Voicemail ECIES Sealing:
   * Seals a WAV buffer to the recipient's P-256 public key using ephemeral ECDH + HKDF-SHA256 + AES-256-GCM.
   * Zeroes sharedSecret, derived AES key, and input wavBuffer immediately in RAM.
   */
  public static sealAudioForRecipient(wavBuffer: Buffer, recipientPublicKeyBase64: string): SealedVoicemailPayload {
    const recipientPub = Buffer.from(recipientPublicKeyBase64, 'base64');
    if (recipientPub.length !== 65 || recipientPub[0] !== 0x04) {
      throw new Error('Invalid recipient P-256 uncompressed public key');
    }

    const eph = crypto.createECDH('prime256v1');
    const ephPub65 = eph.generateKeys();
    const rawSecret = eph.computeSecret(recipientPub);
    const sharedSecret = padTo32Bytes(rawSecret);
    rawSecret.fill(0);

    const derivedAb = crypto.hkdfSync(
      'sha256',
      sharedSecret,
      Buffer.from(this.VM_ECIES_SALT, 'utf8'),
      Buffer.from(this.VM_ECIES_INFO, 'utf8'),
      32
    );
    const aesKey = Buffer.from(derivedAb);

    const iv12 = crypto.randomBytes(12);
    try {
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv12);
      const ciphertext = Buffer.concat([cipher.update(wavBuffer), cipher.final()]);
      const tag16 = cipher.getAuthTag();

      // Zero ephemeral private scalar if accessible
      try {
        const ephPriv = eph.getPrivateKey();
        ephPriv.fill(0);
      } catch {}

      return {
        ciphertext,
        iv: iv12.toString('hex'),
        tag: tag16.toString('hex'),
        ephemeralPublicKey: ephPub65.toString('base64')
      };
    } finally {
      sharedSecret.fill(0);
      aesKey.fill(0);
      wavBuffer.fill(0);
    }
  }

  /**
   * Decrypts an ECIES-sealed voicemail using the recipient's 32-byte private scalar or 96-byte bundle.
   * Used by client/simulator/test verification.
   */
  public static openSealedAudio(
    ciphertext: Buffer,
    ivHex: string,
    tagHex: string,
    ephemeralPublicKeyBase64: string,
    recipientPrivateKeyOrBundle: Buffer
  ): Buffer {
    const privScalar =
      recipientPrivateKeyOrBundle.length === 96
        ? recipientPrivateKeyOrBundle.subarray(0, 32)
        : recipientPrivateKeyOrBundle;

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(privScalar);

    const ephPub = Buffer.from(ephemeralPublicKeyBase64, 'base64');
    const rawSecret = ecdh.computeSecret(ephPub);
    const sharedSecret = padTo32Bytes(rawSecret);
    rawSecret.fill(0);

    const derivedAb = crypto.hkdfSync(
      'sha256',
      sharedSecret,
      Buffer.from(this.VM_ECIES_SALT, 'utf8'),
      Buffer.from(this.VM_ECIES_INFO, 'utf8'),
      32
    );
    const aesKey = Buffer.from(derivedAb);

    try {
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } finally {
      sharedSecret.fill(0);
      aesKey.fill(0);
    }
  }

  /**
   * Wraps user voicemail private key material (96B bundle or 32B scalar) for a paired hardware device's P-256 public key.
   */
  public static wrapVmKeyForDevice(vmKeyMaterial: Buffer, devicePublicKeyBase64: string): WrappedDeviceVmKey {
    const devPub = Buffer.from(devicePublicKeyBase64, 'base64');
    if (devPub.length !== 65 || devPub[0] !== 0x04) {
      throw new Error('Invalid device P-256 public key');
    }

    const eph = crypto.createECDH('prime256v1');
    const ephPub65 = eph.generateKeys();
    const rawSecret = eph.computeSecret(devPub);
    const sharedSecret = padTo32Bytes(rawSecret);
    rawSecret.fill(0);

    const derivedAb = crypto.hkdfSync(
      'sha256',
      sharedSecret,
      Buffer.from(this.DEV_WRAP_SALT, 'utf8'),
      Buffer.from(this.DEV_WRAP_INFO, 'utf8'),
      32
    );
    const aesKey = Buffer.from(derivedAb);
    const iv12 = crypto.randomBytes(12);

    try {
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv12);
      const ciphertext = Buffer.concat([cipher.update(vmKeyMaterial), cipher.final()]);
      const tag16 = cipher.getAuthTag();
      return {
        ephemeralPublicKey: ephPub65.toString('base64'),
        iv: iv12.toString('hex'),
        tag: tag16.toString('hex'),
        ciphertext: ciphertext.toString('base64')
      };
    } finally {
      sharedSecret.fill(0);
      aesKey.fill(0);
    }
  }

  /**
   * Unwraps a wrappedVmKey payload on a device using its 32-byte private key.
   */
  public static unwrapVmKeyOnDevice(wrapped: WrappedDeviceVmKey | string, devicePrivateKey32: Buffer): Buffer {
    const parsed: WrappedDeviceVmKey = typeof wrapped === 'string' ? JSON.parse(wrapped) : wrapped;
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(devicePrivateKey32);

    const ephPub = Buffer.from(parsed.ephemeralPublicKey, 'base64');
    const rawSecret = ecdh.computeSecret(ephPub);
    const sharedSecret = padTo32Bytes(rawSecret);
    rawSecret.fill(0);

    const derivedAb = crypto.hkdfSync(
      'sha256',
      sharedSecret,
      Buffer.from(this.DEV_WRAP_SALT, 'utf8'),
      Buffer.from(this.DEV_WRAP_INFO, 'utf8'),
      32
    );
    const aesKey = Buffer.from(derivedAb);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(parsed.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
      return Buffer.concat([
        decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
        decipher.final()
      ]);
    } finally {
      sharedSecret.fill(0);
      aesKey.fill(0);
    }
  }

  // Legacy key derivation fallback for pre-Migration 14 voicemails
  public static deriveUserKey(userId: number, salt: string): Buffer {
    return crypto.pbkdf2Sync(
      `decatone_user_${userId}_key`,
      salt,
      100000,
      32,
      'sha256'
    );
  }

  public static encryptAudio(audioBuffer: Buffer, userKey: Buffer): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', userKey, iv);

    const ciphertext = Buffer.concat([
      cipher.update(audioBuffer),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      envelopeKey: ''
    };
  }

  public static decryptAudio(
    ciphertext: Buffer,
    userKey: Buffer,
    ivHex: string,
    tagHex: string
  ): Buffer {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', userKey, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
  }

  // Generates standard 44-byte WAV header wrapping 16kHz 16-bit Mono PCM
  public static createWavBuffer(pcmData: Buffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const chunkSize = 36 + dataSize;

    header.write('RIFF', 0);
    header.writeUInt32LE(chunkSize, 4);
    header.write('WAVE', 8);

    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }

  /**
   * Validates RIFF....WAVE magic header on an uploaded audio buffer or file start.
   */
  public static isValidWavHeader(buf: Buffer): boolean {
    if (!buf || buf.length < 12) return false;
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
  }

  /**
   * Decodes any PCM / IEEE Float RIFF WAV buffer and linearly resamples to 16kHz 16-bit mono s16le PCM.
   */
  public static decodeWavTo16kMonoPcm(wavBuffer: Buffer): Buffer {
    if (!this.isValidWavHeader(wavBuffer)) {
      throw new Error('Invalid RIFF WAVE header');
    }

    let audioFormat = 1;
    let numChannels = 1;
    let sampleRate = 16000;
    let bitsPerSample = 16;
    let dataChunk: Buffer | null = null;

    let offset = 12;
    while (offset + 8 <= wavBuffer.length) {
      const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
      const chunkSize = wavBuffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = Math.min(wavBuffer.length, chunkStart + chunkSize);

      if (chunkId === 'fmt ' && chunkEnd - chunkStart >= 16) {
        audioFormat = wavBuffer.readUInt16LE(chunkStart);
        numChannels = Math.max(1, wavBuffer.readUInt16LE(chunkStart + 2));
        sampleRate = Math.max(1000, wavBuffer.readUInt32LE(chunkStart + 4));
        bitsPerSample = wavBuffer.readUInt16LE(chunkStart + 14);
      } else if (chunkId === 'data') {
        dataChunk = wavBuffer.subarray(chunkStart, chunkEnd);
        break;
      }

      offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    if (!dataChunk || dataChunk.length === 0) {
      return Buffer.alloc(0);
    }

    // Fast path: already 16kHz mono 16-bit PCM
    if (audioFormat === 1 && numChannels === 1 && sampleRate === 16000 && bitsPerSample === 16) {
      return Buffer.from(dataChunk);
    }

    const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
    const frameSize = bytesPerSample * numChannels;
    const totalFrames = Math.floor(dataChunk.length / frameSize);
    if (totalFrames <= 0) return Buffer.alloc(0);

    const monoFloats = new Float32Array(totalFrames);
    for (let f = 0; f < totalFrames; f++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const pos = f * frameSize + ch * bytesPerSample;
        let val = 0;
        if (audioFormat === 3 && bitsPerSample === 32 && pos + 4 <= dataChunk.length) {
          val = dataChunk.readFloatLE(pos);
        } else if (bitsPerSample === 8) {
          val = (dataChunk.readUInt8(pos) - 128) / 128.0;
        } else if (bitsPerSample === 16 && pos + 2 <= dataChunk.length) {
          val = dataChunk.readInt16LE(pos) / 32768.0;
        } else if (bitsPerSample === 24 && pos + 3 <= dataChunk.length) {
          const b0 = dataChunk[pos];
          const b1 = dataChunk[pos + 1];
          const b2 = dataChunk[pos + 2];
          let int24 = b0 | (b1 << 8) | (b2 << 16);
          if (int24 & 0x800000) int24 |= ~0xffffff;
          val = int24 / 8388608.0;
        } else if (bitsPerSample === 32 && pos + 4 <= dataChunk.length) {
          val = dataChunk.readInt32LE(pos) / 2147483648.0;
        }
        sum += val;
      }
      monoFloats[f] = sum / numChannels;
    }

    return this.resampleFloatMonoTo16kS16le(monoFloats, sampleRate);
  }

  public static resampleS16leMono(pcmBuffer: Buffer, sourceRate: number, targetRate = 16000): Buffer {
    if (sourceRate === targetRate || pcmBuffer.length < 2) {
      return Buffer.from(pcmBuffer);
    }
    const inSamples = Math.floor(pcmBuffer.length / 2);
    const floats = new Float32Array(inSamples);
    for (let i = 0; i < inSamples; i++) {
      floats[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
    }
    return this.resampleFloatMonoTo16kS16le(floats, sourceRate, targetRate);
  }

  public static resampleFloatMonoTo16kS16le(monoFloats: Float32Array, sourceRate: number, targetRate = 16000): Buffer {
    if (monoFloats.length === 0) return Buffer.alloc(0);
    if (sourceRate === targetRate) {
      const out = Buffer.alloc(monoFloats.length * 2);
      for (let i = 0; i < monoFloats.length; i++) {
        const s = Math.max(-1, Math.min(1, monoFloats[i]));
        out.writeInt16LE(Math.round(s * 32767), i * 2);
      }
      return out;
    }

    const ratio = sourceRate / targetRate;
    const outLength = Math.max(1, Math.floor(monoFloats.length / ratio));
    const out = Buffer.alloc(outLength * 2);

    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(monoFloats.length - 1, idx0 + 1);
      const frac = srcIdx - idx0;
      const sample = monoFloats[idx0] * (1 - frac) + monoFloats[idx1] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      out.writeInt16LE(Math.round(clamped * 32767), i * 2);
    }

    return out;
  }
}
