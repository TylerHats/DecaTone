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

  if (currentVersion < 2) {
    console.log('Running Migration 2: Adding Audio Profile & Sidetone Settings...');
    try {
      await execute(`ALTER TABLE phones ADD COLUMN audio_profile TEXT DEFAULT 'vintage_pots'`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN sidetone_level INTEGER DEFAULT 10`);
    } catch (e) {}
    await execute('INSERT INTO schema_migrations (version) VALUES (2)');
    console.log('Migration 2 applied successfully.');
  }

  if (currentVersion < 3) {
    console.log('Running Migration 3: Adding Legal Agreements & Voicemail Encryption...');

    // User encryption keys for zero-access voicemail storage
    try {
      await execute(`ALTER TABLE users ADD COLUMN encryption_public_key TEXT`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN encrypted_private_key TEXT`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN key_salt TEXT`);
    } catch (e) {}

    // Voicemail encryption metadata
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN is_encrypted INTEGER DEFAULT 1`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN encryption_iv TEXT`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN encryption_tag TEXT`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN encrypted_envelope_key TEXT`);
    } catch (e) {}

    // Default Legal Agreement & Privacy Policy Markdown
    const defaultTerms = `# DecaTone Terms of Service & Telephony Agreement

Last Updated: August 2026

## 1. 🚨 EMERGENCY SERVICES DISCLAIMER (NO 911 / 112 / 999 SERVICES)
**IMPORTANT NOTICE**: DecaTone is an open-source, private hobbyist Voice over IP (VoIP) and experimental telephony platform. **DecaTone IS NOT A TRADITIONAL TELECOMMUNICATIONS CARRIER AND DOES NOT PROVIDE ACCESS TO EMERGENCY CALLING SERVICES (SUCH AS 911, 112, 999, OR ANY EMERGENCY DISPATCHERS).** You must maintain an alternative telephone service (such as a mobile cellular device or traditional landline) to make emergency calls.

## 2. 🎙️ Call Recording & Voicemail Consent
By using this service and leaving voicemail messages for other users on this switchboard, you explicitly consent to the audio recording and digital encrypted storage of your voice message for delivery to the recipient.

## 3. 🚫 Acceptable Use Policy
You agree not to use DecaTone for any unlawful or abusive purposes, including but not limited to:
- Automated spam dialing, telemarketing, or robocalling.
- Harassment, stalking, threats, or illegal eavesdropping/wiretapping.
- Swatting, prank emergency calls, or spoofing caller identities.
- Attempting to compromise the switchboard, WebSocket connections, or other users' hardware phones.

The server administrator reserves the right to terminate, suspend, or disable any user account or hardware device found violating these terms.

## 4. 🛡️ Disclaimer of Warranties & Limitation of Liability
DecaTone software and services are provided strictly **"AS IS"** and without warranty of any kind, express or implied. Under no circumstances shall the software developers or server operators be liable for any direct, indirect, incidental, or consequential damages resulting from missed calls, server interruptions, lost voicemails, or hardware malfunctions.`;

    const defaultPrivacy = `# DecaTone Privacy Policy & Data Handling Notice

Last Updated: August 2026

## 1. Information Stored
DecaTone stores minimal data necessary to route calls and deliver voicemails:
- **Account Details**: Username, hashed password (using secure bcrypt/argon2 hashing), and display name.
- **Hardware Metadata**: Unique Device ID, MAC address, connection status, and signal strength (RSSI).
- **Call Detail Records (CDR)**: Caller number, callee number, timestamps, and call duration.
- **Voicemails**: Recorded voicemail audio messages.

## 2. 🔒 Zero-Access Voicemail & Call Privacy
- **Encrypted Voicemail**: Voicemails are encrypted on disk using AES-256-GCM encryption tied to recipient credentials. Server administrators and raw disk backups cannot listen to recipient voicemail audio in plaintext.
- **End-to-End Encrypted Voice Streams**: Active phone-to-phone voice streams are relayed with end-to-end negotiated session encryption.

## 3. Third-Party Sharing
This system is self-hosted and **never sells or shares your personal information, call metadata, or voicemail audio** with any third-party advertisers or data brokers.`;

    const legalSettings: Record<string, string> = {
      terms_of_service: defaultTerms,
      privacy_policy: defaultPrivacy,
      require_terms_on_signup: 'true'
    };

    for (const [key, value] of Object.entries(legalSettings)) {
      await execute('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [key, value]);
    }

    await execute('INSERT INTO schema_migrations (version) VALUES (3)');
    console.log('Migration 3 applied successfully.');
  }

  if (currentVersion < 4) {
    console.log('Running Migration 4: Adding Email, Notifications & Password Resets...');

    try {
      await execute(`ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE`);
    } catch (e) {}
    try {
      await execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN notify_on_voicemail INTEGER DEFAULT 1`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN notify_on_missed_call INTEGER DEFAULT 1`);
    } catch (e) {}

    await execute(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await execute('INSERT INTO schema_migrations (version) VALUES (4)');
    console.log('Migration 4 applied successfully.');
  }

  if (currentVersion < 5) {
    console.log('Running Migration 5: Adding Advanced Telephony & Hardware Tuning...');

    try {
      await execute(`ALTER TABLE phones ADD COLUMN hardware_profile TEXT DEFAULT 'western_electric_500'`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN bell_frequency_hz REAL DEFAULT 20.0`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN hook_flash_enabled INTEGER DEFAULT 1`);
    } catch (e) {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN intercom_enabled INTEGER DEFAULT 1`);
    } catch (e) {}

    await execute('INSERT INTO schema_migrations (version) VALUES (5)');
    console.log('Migration 5 applied successfully.');
  }
}



