import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';

const router = Router();
router.use(authenticateToken);

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
const greetingsDir = path.join(uploadsDir, 'greetings');
const voicemailsDir = path.join(uploadsDir, 'voicemails');

if (!fs.existsSync(greetingsDir)) fs.mkdirSync(greetingsDir, { recursive: true });
if (!fs.existsSync(voicemailsDir)) fs.mkdirSync(voicemailsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, greetingsDir);
  },
  filename: (req: AuthenticatedRequest, file, cb) => {
    const ext = path.extname(file.originalname) || '.wav';
    cb(null, `greeting_${req.user!.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// List User's Voicemails
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const voicemails = await query<any>(
      `SELECT vm.*, 
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

// Stream Decrypted Voicemail Audio (Zero-Access Decryption)
router.get('/:id/audio', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vm = await queryOne<any>(
      'SELECT vm.*, u.key_salt FROM voicemails vm JOIN users u ON u.id = vm.user_id WHERE vm.id = ? AND vm.user_id = ?',
      [id, req.user!.id]
    );

    if (vm.audio_url.startsWith('data:audio/pcm;base64,')) {
      const b64 = vm.audio_url.replace('data:audio/pcm;base64,', '');
      const pcmBuffer = Buffer.from(b64, 'base64');

      // Generate valid RIFF/WAVE header (16kHz 16-bit linear PCM mono)
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20); // PCM
      wavHeader.writeUInt16LE(1, 22); // mono
      wavHeader.writeUInt32LE(16000, 24); // 16kHz
      wavHeader.writeUInt32LE(16000 * 2, 28); // 32kB/s
      wavHeader.writeUInt16LE(2, 32); // block align
      wavHeader.writeUInt16LE(16, 34); // 16-bit
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(pcmBuffer.length, 40);

      const fullWav = Buffer.concat([wavHeader, pcmBuffer]);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', fullWav.length);
      res.setHeader('Cache-Control', 'private, no-cache, no-store');
      return res.send(fullWav);
    }

    const filename = path.basename(vm.audio_url);
    const filePath = path.join(voicemailsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file missing from storage' });
    }

    const rawFileBuffer = fs.readFileSync(filePath);

    // If encrypted, decrypt in memory using recipient user's derived key
    if (vm.is_encrypted && vm.encryption_iv && vm.encryption_tag && vm.key_salt) {
      const userKey = VoicemailCryptoService.deriveUserKey(req.user!.id, vm.key_salt);
      const decryptedWav = VoicemailCryptoService.decryptAudio(
        rawFileBuffer,
        userKey,
        vm.encryption_iv,
        vm.encryption_tag
      );

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', decryptedWav.length);
      res.setHeader('Cache-Control', 'private, no-cache, no-store');
      return res.send(decryptedWav);
    } else {
      // Legacy unencrypted fallback
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

// Delete Voicemail
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vm = await queryOne<any>('SELECT audio_url FROM voicemails WHERE id = ? AND user_id = ?', [id, req.user!.id]);

    if (vm && vm.audio_url) {
      const filename = path.basename(vm.audio_url);
      const filePath = path.join(voicemailsDir, filename);
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


// Upload Custom Greeting
router.post('/greeting/upload', upload.single('audio'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioUrl = `/uploads/greetings/${req.file.filename}`;

    await execute(
      `INSERT OR REPLACE INTO voicemail_greetings (user_id, audio_url, is_custom, updated_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)`,
      [req.user!.id, audioUrl]
    );

    return res.json({
      message: 'Custom voicemail greeting saved!',
      audioUrl
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to upload voicemail greeting' });
  }
});

// Reset Greeting to Default
router.post('/greeting/reset', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await queryOne<any>('SELECT audio_url FROM voicemail_greetings WHERE user_id = ?', [req.user!.id]);
    if (existing && existing.audio_url) {
      const filename = path.basename(existing.audio_url);
      const filePath = path.join(greetingsDir, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await execute('DELETE FROM voicemail_greetings WHERE user_id = ?', [req.user!.id]);
    return res.json({ message: 'Voicemail greeting reset to default' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset greeting' });
  }
});

export default router;
