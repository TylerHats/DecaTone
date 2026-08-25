import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { queryOne, execute } from '../db/connection';

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
const backupsDir = path.join(dataDir, 'backups');
const customBrandingDir = path.join(dataDir, 'branding');
const uploadsDir = path.join(__dirname, '../../uploads');

if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

function execPromise(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

export function purgeExcessBackups(retentionCount: number) {
  if (retentionCount <= 0) return;
  try {
    if (!fs.existsSync(backupsDir)) return;
    const files = fs.readdirSync(backupsDir);
    const backups = files
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(backupsDir, f);
        const stat = fs.statSync(filePath);
        return { filename: f, filePath, created_at: stat.mtime };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (backups.length > retentionCount) {
      const toDelete = backups.slice(retentionCount);
      for (const b of toDelete) {
        if (fs.existsSync(b.filePath)) {
          fs.unlinkSync(b.filePath);
          console.log(`[Backup Retention] Purged old backup archive: ${b.filename}`);
        }
      }
    }
  } catch (err) {
    console.error('[Backup Retention Error] Failed to purge old backups:', err);
  }
}

export async function createBackupArchiveInternal(): Promise<{ filename: string; sizeBytes: number; created_at: Date }> {
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `decatone-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(backupsDir, filename);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decatone-backup-stage-'));

  try {
    // 1. Copy decatone.db
    const dbPath = path.join(dataDir, 'decatone.db');
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, path.join(stageDir, 'decatone.db'));
    }

    // 2. Metadata file
    fs.writeFileSync(
      path.join(stageDir, 'backup_metadata.json'),
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          version: '1.0.0',
          type: 'full_compressed'
        },
        null,
        2
      )
    );

    // 3. Copy custom branding if exists
    if (fs.existsSync(customBrandingDir)) {
      fs.cpSync(customBrandingDir, path.join(stageDir, 'branding'), { recursive: true });
    } else {
      fs.mkdirSync(path.join(stageDir, 'branding'), { recursive: true });
    }

    // 4. Copy uploads directory (voicemails, custom greetings) if exists
    if (fs.existsSync(uploadsDir)) {
      fs.cpSync(uploadsDir, path.join(stageDir, 'uploads'), { recursive: true });
    } else {
      fs.mkdirSync(path.join(stageDir, 'uploads'), { recursive: true });
    }

    // 5. Compress stage directory into tar.gz
    const cmd = `tar -czf "${archivePath}" -C "${stageDir}" .`;
    await execPromise(cmd);

    const stat = fs.statSync(archivePath);

    // Apply retention policy
    const retentionRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "backup_retention_count"');
    const retentionCount = parseInt(retentionRow?.value || '10', 10);
    purgeExcessBackups(retentionCount);

    return {
      filename,
      sizeBytes: stat.size,
      created_at: stat.mtime
    };
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

export function initBackupScheduler() {
  const checkInterval = 60 * 60 * 1000; // Check every hour
  setInterval(async () => {
    try {
      const enabledRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "auto_backup_enabled"');
      if (enabledRow?.value !== 'true') return;

      const lastBackupRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "last_auto_backup_at"');
      const intervalRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "auto_backup_interval"');
      const interval = intervalRow?.value || 'daily';

      const lastBackupTime = lastBackupRow?.value ? new Date(lastBackupRow.value).getTime() : 0;
      const now = Date.now();

      let intervalMs = 24 * 60 * 60 * 1000; // Daily default
      if (interval === 'hourly') intervalMs = 60 * 60 * 1000;
      else if (interval === 'weekly') intervalMs = 7 * 24 * 60 * 60 * 1000;

      if (now - lastBackupTime >= intervalMs) {
        console.log('[Auto Backup] Running scheduled automated backup...');
        await createBackupArchiveInternal();
        await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['last_auto_backup_at', new Date().toISOString()]);
        console.log('[Auto Backup] Scheduled backup complete.');
      }
    } catch (err) {
      console.error('[Auto Backup Error]', err);
    }
  }, checkInterval);
}
