import crypto from 'crypto';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: string;
  tag: string;
  envelopeKey: string;
}

export class VoicemailCryptoService {
  // Derives a 256-bit user key from user ID and user salt/secret
  public static deriveUserKey(userId: number, salt: string): Buffer {
    return crypto.pbkdf2Sync(
      `decatone_user_${userId}_key`,
      salt,
      100000,
      32,
      'sha256'
    );
  }

  // Encrypts raw audio buffer using AES-256-GCM
  public static encryptAudio(audioBuffer: Buffer, userKey: Buffer): EncryptedPayload {
    const iv = crypto.randomBytes(12); // 96-bit IV standard for GCM
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

  // Decrypts ciphertext buffer using AES-256-GCM with authentication tag verification
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

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(chunkSize, 4);
    header.write('WAVE', 8);

    // "fmt " sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // "data" sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }
}

