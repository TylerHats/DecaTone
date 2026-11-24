import fs from 'fs';
import path from 'path';
import os from 'os';
import * as tar from 'tar';
import { BACKUPS_DIR, BRANDING_DIR, UPLOADS_DIR, ensureDirectories } from '../config/paths';
import { DB_PATH, queryOne, execute } from '../db/connection';

export function isSafeTarEntry(entryPath: string, entry: any): boolean {
  const normalized = entryPath.replace(/\\/g, '/');
  if (
    path.isAbsolute(normalized) ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    return false;
  }
  const entryType = entry?.type;
  if (entryType === 'SymbolicLink' || entryType === 'Link') {
    return false;
  }
  if (typeof entry?.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
    return false;
  }
  return true;
}

export async function extractBackupArchiveSafe(archivePath: string, unpackDir: string): Promise<void> {
  await tar.x({
    file: archivePath,
    cwd: unpackDir,
    strict: true,
    filter: (entryPath, entry) => isSafeTarEntry(entryPath, entry)
  });
}

export function purgeExcessBackups(retentionCount: number) {
  if (retentionCount <= 0) return;
  try {
    ensureDirectories();
    const files = fs.readdirSync(BACKUPS_DIR);
    const backups = files
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(BACKUPS_DIR, f);
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
  ensureDirectories();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `decatone-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(BACKUPS_DIR, filename);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decatone-backup-stage-'));

  try {
    // 1. Hot consistent SQLite WAL snapshot via VACUUM INTO
    const stagedDbPath = path.join(stageDir, 'decatone.db');
    if (fs.existsSync(stagedDbPath)) {
      fs.unlinkSync(stagedDbPath);
    }
    await execute('VACUUM INTO ?', [stagedDbPath]);

    // 2. Metadata file
    const installedVerRow = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['installed_version']
    );
    fs.writeFileSync(
      path.join(stageDir, 'backup_metadata.json'),
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          version: installedVerRow?.value || '1.3.0',
          type: 'full_compressed_wal_snapshot'
        },
        null,
        2
      )
    );

    // 3. Copy custom branding
    const stagedBranding = path.join(stageDir, 'branding');
    fs.mkdirSync(stagedBranding, { recursive: true });
    if (fs.existsSync(BRANDING_DIR)) {
      fs.cpSync(BRANDING_DIR, stagedBranding, { recursive: true, dereference: false });
    }

    // 4. Copy uploads directory (greetings and sealed .enc voicemails)
    const stagedUploads = path.join(stageDir, 'uploads');
    fs.mkdirSync(stagedUploads, { recursive: true });
    if (fs.existsSync(UPLOADS_DIR)) {
      fs.cpSync(UPLOADS_DIR, stagedUploads, { recursive: true, dereference: false });
    }

    // 5. Compress stage directory safely via node-tar (no shell exec)
    const entries = fs.readdirSync(stageDir);
    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: stageDir,
        portable: true,
        filter: (entryPath, stat) => isSafeTarEntry(entryPath, stat)
      },
      entries
    );

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
    } catch {}
  }
}

export function initBackupScheduler() {
  const checkInterval = 15 * 60 * 1000; // Check every 15 minutes to honor auto_backup_time accurately
  const timer = setInterval(async () => {
    try {
      const enabledRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "auto_backup_enabled"');
      if (enabledRow?.value !== 'true') return;

      const lastBackupRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "last_auto_backup_at"');
      const intervalRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "auto_backup_interval"');
      const timeRow = await queryOne<any>('SELECT value FROM system_settings WHERE key = "auto_backup_time"');

      const interval = intervalRow?.value || 'daily';
      const targetTime = (timeRow?.value || '02:00').trim();
      const [targetH, targetM] = targetTime.split(':').map(n => parseInt(n, 10) || 0);

      const lastBackupTime = lastBackupRow?.value ? new Date(lastBackupRow.value).getTime() : 0;
      const nowDate = new Date();
      const now = nowDate.getTime();

      if (interval === 'hourly') {
        if (now - lastBackupTime >= 60 * 60 * 1000) {
          await runScheduledBackup();
        }
        return;
      }

      const minGapMs = interval === 'weekly' ? 6.5 * 24 * 60 * 60 * 1000 : 20 * 60 * 60 * 1000;
      if (now - lastBackupTime < minGapMs) return;

      const currentMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
      const targetMinutes = targetH * 60 + targetM;
      const diffMinutes = (currentMinutes - targetMinutes + 1440) % 1440;

      // Trigger within 45 minutes after scheduled auto_backup_time (or if never backed up and overdue > 2x interval)
      const maxOverdue = interval === 'weekly' ? 8 * 24 * 60 * 60 * 1000 : 36 * 60 * 60 * 1000;
      if (diffMinutes <= 45 || (lastBackupTime > 0 && now - lastBackupTime >= maxOverdue)) {
        await runScheduledBackup();
      }
    } catch (err) {
      console.error('[Auto Backup Error]', err);
    }
  }, checkInterval);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

async function runScheduledBackup() {
  console.log('[Auto Backup] Running scheduled automated backup...');
  await createBackupArchiveInternal();
  await execute(
    'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
    ['last_auto_backup_at', new Date().toISOString()]
  );
  console.log('[Auto Backup] Scheduled backup complete.');
}
