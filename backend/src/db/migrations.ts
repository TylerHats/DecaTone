import { execute, queryOne } from './connection';

export async function runMigrations() {
  // Create schema_migrations table
  await execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const currentVersionRow = await queryOne<{ max_version: number }>(
    'SELECT MAX(version) as max_version FROM schema_migrations'
  );
  const currentVersion = currentVersionRow?.max_version || 0;

  if (currentVersion < 1) {
    console.log('Running Migration 1: Initial DecaTone Schema...');

    // Users Table
    await execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        phone_number TEXT UNIQUE,
        area_code TEXT,
        role TEXT DEFAULT 'user',
        is_disabled INTEGER DEFAULT 0,
        disabled_reason TEXT,
        call_privacy TEXT DEFAULT 'anyone',
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ESP32-S3 Hardware Phones Table
    await execute(`
      CREATE TABLE IF NOT EXISTS phones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        device_id TEXT UNIQUE NOT NULL,
        mac_address TEXT,
        ip_address TEXT,
        firmware_version TEXT DEFAULT '1.0.0',
        rssi INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        hook_state TEXT DEFAULT 'on_hook',
        call_state TEXT DEFAULT 'idle',
        earpiece_volume INTEGER DEFAULT 80,
        mic_sensitivity INTEGER DEFAULT 80,
        ring_style TEXT DEFAULT 'traditional',
        ring_cadence_custom TEXT DEFAULT '2000,4000',
        ring_timeout_sec INTEGER DEFAULT 25,
        last_seen DATETIME,
        paired_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Friends Table
    await execute(`
      CREATE TABLE IF NOT EXISTS friends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'accepted',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, friend_id)
      )
    `);

    // Friend Requests Table
    await execute(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sender_id, receiver_id)
      )
    `);

    // Rotary Speed Dial Slots (1 to 9)
    await execute(`
      CREATE TABLE IF NOT EXISTS speed_dials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot_digit INTEGER NOT NULL CHECK(slot_digit BETWEEN 1 AND 9),
        target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_phone_number TEXT NOT NULL,
        label TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, slot_digit)
      )
    `);

    // Call Logs Table
    await execute(`
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        callee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        caller_number TEXT NOT NULL,
        callee_number TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_sec INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME
      )
    `);

    // Voicemails Table
    await execute(`
      CREATE TABLE IF NOT EXISTS voicemails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        caller_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        caller_number TEXT NOT NULL,
        audio_url TEXT NOT NULL,
        duration_sec INTEGER DEFAULT 0,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Voicemail Greetings Table
    await execute(`
      CREATE TABLE IF NOT EXISTS voicemail_greetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        audio_url TEXT NOT NULL,
        is_custom INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // System Settings Table
    await execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Populate Initial Default System Settings
    const defaultSettings: Record<string, string> = {
      app_name: 'DecaTone',
      logo_url: '/branding/logo.png',
      installed_version: '1.0.0',
      update_channel: 'stable',
      phone_number_length: '3',
      area_code_enabled: 'false',
      area_codes_list: '555,212,312,415,800',
      default_area_code: '555',
      allow_user_number_choice: 'true',
      number_assignment_mode: 'user_choice',
      auto_backup_enabled: 'false',
      auto_backup_interval: 'daily',
      backup_retention_count: '10',
      firmware_latest_version: '1.0.0',
      firmware_binary_url: '',
      smtp_host: '',
      smtp_port: '587',
      smtp_user: '',
      smtp_pass: '',
      smtp_from: '',
      smtp_secure: 'false'
    };

    for (const [key, value] of Object.entries(defaultSettings)) {
      await execute('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [key, value]);
    }

    await execute('INSERT INTO schema_migrations (version) VALUES (1)');
    console.log('Migration 1 applied successfully.');
  }
}
