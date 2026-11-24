import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { execute, query, queryOne } from '../db/connection';
import { GREETINGS_DIR, VOICEMAILS_DIR, ensureDirectories } from '../config/paths';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';

const router = Router();
router.use(authenticateToken);

ensureDirectories();

const ALLOWED_WAV_MIMETYPES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/vnd.wave'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirectories();
    cb(null, GREETINGS_DIR);
  },
  filename: (req: AuthenticatedRequest, _file, cb) => {
    cb(null, `greeting_${req.user!.id}_${Date.now()}.wav`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (ext === '.wav' || ALLOWED_WAV_MIMETYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Only uncompressed .wav audio files are supported for voicemail greetings'));
    }
  }
});

// List User's Voicemails (Metadata ONLY — never dumps multi-MB audio_url!)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const voicemails = await query<any>(
      `SELECT vm.id,
              vm.user_id,
              vm.caller_user_id,
              vm.caller_number,
              vm.duration_sec,
              vm.is_read,
              vm.is_encrypted,
              vm.ephemeral_public_key,
              vm.created_at,
              u.username as caller_username,
              u.display_name as caller_display_name,
              u.avatar_url as caller_avatar
       FROM voicemails vm
       LEFT JOIN users u ON u.id = vm.caller_user_id
       WHERE vm.user_id = ?
       ORDER BY vm.id DESC`,
      [req.user!.id]
    );

    return res.json({ voicemails });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch voicemails' });
  }
});

// Get User Greeting Info
router.get('/greeting', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const greeting = await queryOne<any>(
      'SELECT audio_url, is_custom, updated_at FROM voicemail_greetings WHERE user_id = ?',
      [req.user!.id]
    );

    return res.json({
      hasCustomGreeting: !!greeting?.is_custom,
      audioUrl: greeting?.is_custom ? '/api/voicemail/greeting/audio' : null,
      updatedAt: greeting?.updated_at || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch greeting info' });
  }
});

// Stream User Greeting Audio
router.get('/greeting/audio', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const greeting = await queryOne<any>(
      'SELECT audio_url FROM voicemail_greetings WHERE user_id = ?',
      [req.user!.id]
    );

    if (!greeting || !greeting.audio_url) {
      return res.status(404).send('No custom greeting recorded');
    }

    const filename = path.basename(greeting.audio_url);
    const filePath = path.join(GREETINGS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Greeting audio file not found on disk');
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    return res.status(500).send('Error streaming greeting audio');
  }
});

// Zero-Access Encrypted Voicemail Payload (Client decrypts locally with WebCrypto P-256 private key)
router.get('/:id/encrypted', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid voicemail ID' });
    }

    const vm = await queryOne<any>(
      'SELECT * FROM voicemails WHERE id = ? AND user_id = ?',
      [id, req.user!.id]
    );

    if (!vm) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    if (typeof vm.audio_url === 'string' && vm.audio_url.startsWith('data:audio/pcm;base64,')) {
      const b64 = vm.audio_url.replace('data:audio/pcm;base64,', '');
      const pcmBuffer = Buffer.from(b64, 'base64');
      const wav = VoicemailCryptoService.createWavBuffer(pcmBuffer);
      return res.json({
        id: vm.id,
        isEncrypted: false,
        wavBase64: wav.toString('base64')
      });
    }

    const filename = path.basename(vm.audio_url);
    const filePath = path.join(VOICEMAILS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Voicemail ciphertext missing from storage' });
    }

    const rawBuf = await fs.promises.readFile(filePath);

    if (!vm.is_encrypted || !vm.ephemeral_public_key) {
      // Legacy pre-ECIES row fallback: decrypt server-derivable legacy row if needed so old messages aren't orphaned
      if (vm.is_encrypted && vm.encryption_iv && vm.encryption_tag) {
        const userRow = await queryOne<{ key_salt: string }>('SELECT key_salt FROM users WHERE id = ?', [req.user!.id]);
        if (userRow?.key_salt) {
          const legacyKey = VoicemailCryptoService.deriveUserKey(req.user!.id, userRow.key_salt);
          const wav = VoicemailCryptoService.decryptAudio(rawBuf, legacyKey, vm.encryption_iv, vm.encryption_tag);
          legacyKey.fill(0);
          return res.json({
            id: vm.id,
            isEncrypted: false,
            wavBase64: wav.toString('base64')
          });
        }
      }
      return res.json({
        id: vm.id,
        isEncrypted: false,
        wavBase64: rawBuf.toString('base64')
      });
    }

    return res.json({
      id: vm.id,
      isEncrypted: true,
      ephemeralPublicKey: vm.ephemeral_public_key,
      iv: vm.encryption_iv,
      tag: vm.encryption_tag,
      ciphertextBase64: rawBuf.toString('base64')
    });
  } catch (err) {
    console.error('[Voicemail Encrypted Fetch Error]:', err);
    return res.status(500).json({ error: 'Failed to load encrypted voicemail payload' });
  }
});

// Legacy Audio Endpoint (returns 404 when missing, 400 on Zero-Access ECIES rows)
router.get('/:id/audio', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid voicemail ID' });
    }

    const vm = await queryOne<any>(
      'SELECT vm.*, u.key_salt FROM voicemails vm JOIN users u ON u.id = vm.user_id WHERE vm.id = ? AND vm.user_id = ?',
      [id, req.user!.id]
    );

    if (!vm) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    if (vm.ephemeral_public_key) {
      return res.status(400).json({
        error: 'Zero-access ECIES voicemail cannot be decrypted by the server. Fetch ciphertext via /api/voicemail/:id/encrypted and decrypt locally.'
      });
    }

    if (typeof vm.audio_url === 'string' && vm.audio_url.startsWith('data:audio/pcm;base64,')) {
      const b64 = vm.audio_url.replace('data:audio/pcm;base64,', '');
      const pcmBuffer = Buffer.from(b64, 'base64');
      const fullWav = VoicemailCryptoService.createWavBuffer(pcmBuffer);

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', fullWav.length);
      res.setHeader('Cache-Control', 'private, no-cache, no-store');
      return res.send(fullWav);
    }

    const filename = path.basename(vm.audio_url);
    const filePath = path.join(VOICEMAILS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file missing from storage' });
    }

    const rawFileBuffer = await fs.promises.readFile(filePath);

    if (vm.is_encrypted && vm.encryption_iv && vm.encryption_tag && vm.key_salt) {
      const userKey = VoicemailCryptoService.deriveUserKey(req.user!.id, vm.key_salt);
      const decryptedWav = VoicemailCryptoService.decryptAudio(
        rawFileBuffer,
        userKey,
        vm.encryption_iv,
        vm.encryption_tag
      );
      userKey.fill(0);

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', decryptedWav.length);
      res.setHeader('Cache-Control', 'private, no-cache, no-store');
      return res.send(decryptedWav);
    } else {
      res.setHeader('Content-Type', 'audio/wav');
      return res.send(rawFileBuffer);
    }
  } catch (err) {
    console.error('[Voicemail Decryption Error]:', err);
    return res.status(500).json({ error: 'Failed to decrypt voicemail audio' });
  }
});

// Mark Voicemail Read
router.put('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await execute('UPDATE voicemails SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user!.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update voicemail' });
  }
});

// Delete Voicemail (guards against data: URLs before unlinking)
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vm = await queryOne<any>('SELECT audio_url FROM voicemails WHERE id = ? AND user_id = ?', [id, req.user!.id]);

    if (!vm) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    if (vm.audio_url && !String(vm.audio_url).startsWith('data:')) {
      const filename = path.basename(vm.audio_url);
      const filePath = path.join(VOICEMAILS_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await execute('DELETE FROM voicemails WHERE id = ? AND user_id = ?', [id, req.user!.id]);
    return res.json({ message: 'Voicemail deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete voicemail' });
  }
});

// Upload Custom Greeting (validates .wav extension/MIME + RIFF....WAVE magic header)
router.post('/greeting/upload', (req: AuthenticatedRequest, res: Response) => {
  upload.single('audio')(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'Invalid greeting upload' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No WAV audio file provided' });
      }

      const headerBuf = Buffer.alloc(12);
      const fd = fs.openSync(req.file.path, 'r');
      try {
        fs.readSync(fd, headerBuf, 0, 12, 0);
      } finally {
        fs.closeSync(fd);
      }

      if (!VoicemailCryptoService.isValidWavHeader(headerBuf)) {
        try {
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } catch {}
        return res.status(400).json({
          error: 'Uploaded file is not a valid RIFF WAVE (.wav) audio file'
        });
      }

      // Remove old greeting file if present
      const prev = await queryOne<any>('SELECT audio_url FROM voicemail_greetings WHERE user_id = ?', [req.user!.id]);
      if (prev?.audio_url && !String(prev.audio_url).startsWith('data:')) {
        const oldFile = path.join(GREETINGS_DIR, path.basename(prev.audio_url));
        if (oldFile !== req.file.path && fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch {}
        }
      }

      await execute(
        `INSERT OR REPLACE INTO voicemail_greetings (user_id, audio_url, is_custom, updated_at)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP)`,
        [req.user!.id, req.file.filename]
      );

      return res.json({
        message: 'Custom voicemail greeting saved!',
        audioUrl: '/api/voicemail/greeting/audio'
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to upload voicemail greeting' });
    }
  });
});

// Reset Greeting to Default
router.post('/greeting/reset', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await queryOne<any>('SELECT audio_url FROM voicemail_greetings WHERE user_id = ?', [req.user!.id]);
    if (existing && existing.audio_url && !String(existing.audio_url).startsWith('data:')) {
      const filename = path.basename(existing.audio_url);
      const filePath = path.join(GREETINGS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await execute('DELETE FROM voicemail_greetings WHERE user_id = ?', [req.user!.id]);
    return res.json({ message: 'Voicemail greeting reset to default' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset greeting' });
  }
});

export default router;
