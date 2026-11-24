import sqlite3 from 'sqlite3';
import path from 'path';
import { DATA_DIR, ensureDirectories } from '../config/paths';

ensureDirectories();

export const DB_PATH = path.join(DATA_DIR, 'decatone.db');

function configureDatabasePragmas(database: sqlite3.Database): void {
  database.serialize(() => {
    database.run('PRAGMA journal_mode = WAL;');
    database.run('PRAGMA busy_timeout = 5000;');
    database.run('PRAGMA synchronous = NORMAL;');
    database.run('PRAGMA foreign_keys = ON;');
  });
}

function openDatabaseInstance(): sqlite3.Database {
  const database = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Failed to open DecaTone SQLite database:', err);
    }
  });
  configureDatabasePragmas(database);
  return database;
}

let dbInstance: sqlite3.Database = openDatabaseInstance();

export function getDb(): sqlite3.Database {
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (!dbInstance) return;
  try {
    await execute('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {}
  await new Promise<void>((resolve, reject) => {
    dbInstance.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function reopenDatabase(): Promise<void> {
  dbInstance = openDatabaseInstance();
  await execute('SELECT 1');
}

export function execute(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    dbInstance.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    dbInstance.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve((rows as T[]) || []);
    });
  });
}

export function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  return new Promise((resolve, reject) => {
    dbInstance.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve((row as T) || null);
    });
  });
}
