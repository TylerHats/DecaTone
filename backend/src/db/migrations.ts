import { execute, queryOne } from './connection';

export const UPDATED_DEFAULT_TERMS = `# DecaTone Terms of Service & Telephony Agreement

Last Updated: November 2026 (Version 2026.11)

## 1. MANDATORY EMERGENCY CALLING DISCLAIMER — NO E911 / 112 / 999 / 000 ACCESS
**CRITICAL SAFETY NOTICE**: DecaTone is a self-hosted, private, experimental Voice over IP (VoIP) and vintage rotary telephone switchboard platform. **DecaTone IS NOT A PUBLIC SWITCHED TELEPHONE NETWORK (PSTN) CARRIER OR INTERCONNECTED VOIP PROVIDER AND DOES NOT SUPPORT OR ROUTE EMERGENCY CALLS TO 911, E911, 112, 999, 000, OR ANY PUBLIC SAFETY ANSWERING POINT (PSAP).**

- Dialing emergency numbers on a DecaTone rotary telephone or web softphone will play a local intercept warning and **will never reach emergency responders**.
- DecaTone telephones depend on local electrical power, Wi-Fi connectivity, and server availability; they will not function during power or network outages.
- **Physical Handset Warning Label Advisory**: You agree to affix a clear, visible warning sticker on or adjacent to every physical telephone connected to DecaTone informing household members, guests, children, and visitors that **"911 / Emergency Calls Cannot Be Placed From This Telephone"** and directing them to a mobile phone or traditional landline.

## 2. End-to-End Encrypted Voice Calls & Zero-Access Voicemails
- **Peer & Group Calls (E2EE)**: Direct extension-to-extension calls, household intercom calls, and multi-party group calls negotiate ephemeral **ECDH P-256** keys and encrypt voice media end-to-end using **AES-256-GCM** directly between participating hardware adapters and web softphones. The switchboard relays encrypted audio frames without holding call media decryption keys.
- **Voicemail Recording & Live Screening**: When a call is routed to voicemail, audio is processed briefly in volatile server RAM so the switchboard can detect call hangup, optionally relay live voicemail screening audio to the recipient's own off-hook handset, and package the recording. Immediately upon hangup, the recording is sealed using **ECIES (ephemeral ECDH P-256 + HKDF-SHA256 + AES-256-GCM)** to the recipient's public key and all plaintext buffers and ephemeral secrets in server RAM are zeroed before disk storage. Stored voicemail files and server backups cannot be decrypted by server administrators.
- **Automated Service Lines**: Server-generated utility lines—including **411** (Speaking Clock), **711** (Weather Hotline), **111** (Ringback Test), **119** (Audio Loopback Echo Test), **567** (Modem Handshake Simulator), and acoustic bell calibration—are generated or processed directly by the server without end-to-end peer encryption.

## 3. Two-Party / All-Party Consent, Voicemail & Party-Line Notice
- **Voicemail & Live Screening Consent**: By remaining on the line after a voicemail greeting and tone, callers consent to the recording of their voice message and potential live voicemail screening by the called extension owner.
- **Household Party-Line & Group Calls**: Picking up an additional telephone paired to the same account during an active call joins the conversation as a household party-line extension and emits an audible join chirp tone to participants. Inviting a third extension via rotary conference codes also emits an audible tone.
- **Legal Compliance**: Recording, monitoring, or joining telephone conversations may be subject to one-party or two-party/all-party consent wiretapping laws in your jurisdiction. You are solely responsible for informing call participants and complying with all applicable local, state, national, and international laws.

## 4. Acceptable Use Policy
You agree not to use DecaTone for any unlawful, harmful, or abusive purpose, including:
- Harassment, threats, stalking, automated spam dialing, or unauthorized wiretapping/eavesdropping.
- Spoofing extension identities, probing device credentials, or attempting to disrupt switchboard services or other users' hardware adapters.

Server administrators reserve the right to suspend, disable, or remove accounts or devices that violate these terms.

## 5. Account Self-Service, Data Export & Deletion
You may export your account metadata or permanently delete your account, call preferences, custom greetings, and encrypted voicemail files at any time from Account Settings.

## 6. Disclaimer of Warranties & Limitation of Liability
DecaTone software, firmware, and switchboard services are provided strictly **"AS IS"** and **"AS AVAILABLE"** without warranties of any kind, express or implied. To the maximum extent permitted by law, neither the DecaTone open-source authors nor the server operator shall be liable for any direct, indirect, incidental, consequential, or special damages arising from service interruptions, hardware faults, missed calls, or inability to place emergency calls.`;

export const UPDATED_DEFAULT_PRIVACY = `# DecaTone Privacy Policy & Data Handling Notice

Last Updated: November 2026 (Version 2026.11)

## 1. Data Collected & Stored by This Switchboard
DecaTone collects only the data required to operate private extensions, pair rotary telephone hardware, route calls, and deliver voicemails:
- **Account & Profile Data**: Username, bcrypt password hash, optional display name and email address, assigned extension/area code, Do Not Disturb (DND) schedules, speed dials, friend connections, and timestamps of Terms/E911 acknowledgments.
- **Cryptographic Key Material**: Your P-256 public key, random PBKDF2 salt, and your client/password-wrapped encrypted private key bundle (\`AES-256-GCM\` under \`PBKDF2-SHA256\` with 150,000 iterations), plus optional device-wrapped voicemail keys for paired ESP32 handsets.
- **Hardware & Diagnostic Telemetry**: Paired device ID, MAC address, local IP address, firmware version, Wi-Fi RSSI, hook/call state, rotary dial pulse speed/break-ratio telemetry, acoustic bell resonance frequency, noise floor, and heap/PSRAM health metrics.
- **Call Detail Records (CDRs) & Voicemail Metadata**: Caller and callee extension numbers, call start/end timestamps, duration, call disposition (\`connected\`, \`missed\`, \`voicemail\`, \`busy\`), and encrypted voicemail files on disk.

## 2. End-to-End Call Encryption & Zero-Access Voicemails
- **Peer & Multi-Party Voice Calls**: Voice packets on extension-to-extension, intercom, and group calls are encrypted end-to-end between endpoints using **ECDH P-256 + AES-256-GCM** (\`0x01\` binary framing). The server routes encrypted packets without access to media keys.
- **Voicemail Transient Memory & Disk Sealing**: During active voicemail recording (and optional live screening on the recipient's own paired phone), caller PCM audio passes transiently through volatile server memory (\`0x02\` framing). Immediately upon call completion, the server seals the audio to the recipient's P-256 public key using **ECIES (\`HKDF-SHA256\` + \`AES-256-GCM\`)**, zeroes the plaintext buffers and shared secret in RAM, and writes only the \`.enc\` ciphertext to disk. Server administrators and backup archives cannot decrypt stored voicemails without the user's password or paired device private key.
- **Server Service Lines**: Calls to built-in automated lines (\`411\`, \`711\`, \`111\`, \`119\`, \`567\`) are synthesized or echoed directly by the server (\`0x00\` framing).

## 3. Session Cookies, Browser Storage & RAM Key Handling
- **Authentication Sessions**: DecaTone uses an \`httpOnly\` \`SameSite=Lax\` session cookie (and optional memory/session bearer token) strictly for user authentication—never for advertising or cross-site tracking. Changing or resetting your password increments your \`token_version\` and immediately revokes prior sessions.
- **Browser LocalStorage & Session Memory**: Client UI preferences may be stored in \`localStorage\`, while unwrapped voicemail private keys are held in volatile client memory during active sessions to decrypt voicemails locally in your browser.

## 4. Local Speech Synthesis & External Network Services
- **100% Local Server-Side TTS**: Spoken operator prompts, pairing codes, speaking clock announcements, and service messages are synthesized **entirely locally** on this server (via Piper Neural ONNX models, local \`espeak-ng\`, or the built-in formant synthesizer). **Zero speech text or voice audio is sent to Google Translate or external cloud TTS APIs.** Admin-initiated voice model downloads fetch open-source Piper \`.onnx\` voice files from Hugging Face once and run offline thereafter.
- **\`711\` Automated Weather Line**: Only when a user dials \`711\`, the server performs an HTTPS IP geolocation lookup (\`https://ipwho.is\`) using the caller's public IP (or server IP for LAN clients) to determine approximate latitude/longitude/city, followed by an HTTPS forecast request to **Open-Meteo** (\`https://api.open-meteo.com\`). No user identity or extension number is transmitted.
- **Optional Admin Integrations**:
  - **SMTP Email**: If configured by the administrator, outbound emails (password resets, welcome notices, missed call alerts, and voicemail alerts—metadata only, never decrypted audio) are sent through the configured SMTP server.
  - **Home Assistant MQTT**: If explicitly enabled by the administrator, hook state, ring controls, DSP sliders, and last-dialed extension state are published to the administrator's configured MQTT broker.

## 5. Automated Backups, Retention & Self-Service Rights
- **Backups**: Administrators may enable scheduled compressed backups containing the SQLite database, custom branding, greetings, and encrypted (\`.enc\`) voicemail ciphertext files, subject to configurable retention limits.
- **Self-Service Export & Erasure**: Authenticated users can download a machine-readable JSON export of their profile, devices, contacts, call logs, and voicemail metadata (\`GET /api/auth/export-data\`) or permanently delete their account and associated greeting and encrypted voicemail files (\`DELETE /api/auth/account\`) at any time.`;

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

    await execute(`
      CREATE TABLE IF NOT EXISTS phones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        device_id TEXT UNIQUE NOT NULL,
        mac_address TEXT,
        ip_address TEXT,
        phone_label TEXT DEFAULT 'Main Phone',
        ring_enabled INTEGER DEFAULT 1,
        firmware_version TEXT DEFAULT '1.2.2',
        rssi INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        hook_state TEXT DEFAULT 'on_hook',
        call_state TEXT DEFAULT 'idle',
        earpiece_volume INTEGER DEFAULT 80,
        mic_sensitivity INTEGER DEFAULT 80,
        audio_profile TEXT DEFAULT 'vintage_pots',
        sidetone_level INTEGER DEFAULT 10,
        ring_style TEXT DEFAULT 'traditional',
        ring_cadence_custom TEXT DEFAULT '2000,4000',
        ring_timeout_sec INTEGER DEFAULT 25,
        hardware_profile TEXT DEFAULT 'western_electric_500',
        bell_frequency_hz REAL DEFAULT 20.0,
        intercom_enabled INTEGER DEFAULT 1,
        hook_flash_enabled INTEGER DEFAULT 1,
        ota_auto_update_enabled INTEGER DEFAULT 1,
        ota_update_time TEXT DEFAULT '03:00',
        ota_update_channel TEXT DEFAULT 'stable',
        last_seen DATETIME,
        paired_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    await execute(`
      CREATE TABLE IF NOT EXISTS voicemail_greetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        audio_url TEXT NOT NULL,
        is_custom INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    const defaultSettings: Record<string, string> = {
      app_name: 'DecaTone',
      logo_url: '/branding/logo.png',
      installed_version: '1.0.0',
      update_channel: 'stable',
      phone_number_length: '4',
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
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN sidetone_level INTEGER DEFAULT 10`);
    } catch {}
    await execute('INSERT INTO schema_migrations (version) VALUES (2)');
    console.log('Migration 2 applied successfully.');
  }

  if (currentVersion < 3) {
    console.log('Running Migration 3: Adding Legal Agreements & Voicemail Encryption...');

    try {
      await execute(`ALTER TABLE users ADD COLUMN encryption_public_key TEXT`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN encrypted_private_key TEXT`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN key_salt TEXT`);
    } catch {}

    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN is_encrypted INTEGER DEFAULT 1`);
    } catch {}
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN encryption_iv TEXT`);
    } catch {}
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN encryption_tag TEXT`);
    } catch {}
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN encrypted_envelope_key TEXT`);
    } catch {}

    const legalSettings: Record<string, string> = {
      terms_of_service: UPDATED_DEFAULT_TERMS,
      privacy_policy: UPDATED_DEFAULT_PRIVACY,
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
    } catch {}
    try {
      await execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN notify_on_voicemail INTEGER DEFAULT 1`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN notify_on_missed_call INTEGER DEFAULT 1`);
    } catch {}

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
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN bell_frequency_hz REAL DEFAULT 20.0`);
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN hook_flash_enabled INTEGER DEFAULT 1`);
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN intercom_enabled INTEGER DEFAULT 1`);
    } catch {}

    await execute('INSERT INTO schema_migrations (version) VALUES (5)');
    console.log('Migration 5 applied successfully.');
  }

  if (currentVersion < 6) {
    console.log('Running Migration 6: Adding Range, Assignment Mode, Call Forwarding & MQTT Settings...');
    try {
      await execute(`ALTER TABLE phones ADD COLUMN call_forwarding_enabled INTEGER DEFAULT 0`);
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN forward_to_number TEXT`);
    } catch {}

    const mig6Settings: Array<[string, string]> = [
      ['phone_number_min_length', '4'],
      ['phone_number_max_length', '4'],
      ['number_assignment_mode', 'user_choice'],
      ['mqtt_enabled', 'false'],
      ['mqtt_host', 'localhost'],
      ['mqtt_port', '1883'],
      ['mqtt_user', ''],
      ['mqtt_pass', ''],
      ['mqtt_ha_pin', '512']
    ];
    for (const [k, v] of mig6Settings) {
      await execute('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [k, v]);
    }

    try {
      await execute(`
        CREATE TABLE IF NOT EXISTS pending_device_enrollments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT UNIQUE NOT NULL,
          ip_address TEXT,
          pairing_code_word TEXT NOT NULL,
          pairing_code_numeric TEXT NOT NULL,
          pairing_code TEXT,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch {}

    await execute('INSERT INTO schema_migrations (version) VALUES (6)');
    console.log('Migration 6 applied successfully.');
  }

  if (currentVersion < 7) {
    console.log('Running Migration 7: Adding Per-Friend Distinctive Ringing, VIP Status & DND Schedules...');
    try {
      await execute(`ALTER TABLE friends ADD COLUMN ring_style TEXT DEFAULT 'default'`);
    } catch {}
    try {
      await execute(`ALTER TABLE friends ADD COLUMN ring_cadence_custom TEXT`);
    } catch {}
    try {
      await execute(`ALTER TABLE friends ADD COLUMN is_vip INTEGER DEFAULT 0`);
    } catch {}

    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_manual_state INTEGER DEFAULT 0`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_schedule_enabled INTEGER DEFAULT 0`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_schedule_start TEXT DEFAULT '22:00'`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_schedule_end TEXT DEFAULT '08:00'`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_schedule_days TEXT DEFAULT '1,2,3,4,5,6,7'`);
    } catch {}
    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_override_period TEXT`);
    } catch {}

    await execute('INSERT INTO schema_migrations (version) VALUES (7)');
    console.log('Migration 7 applied successfully.');
  }

  if (currentVersion < 8) {
    console.log('Running Migration 8: Adding DND Repeated Call Emergency Breakthrough...');
    try {
      await execute(`ALTER TABLE users ADD COLUMN dnd_repeated_call_breakthrough INTEGER DEFAULT 1`);
    } catch {}

    await execute('INSERT INTO schema_migrations (version) VALUES (8)');
    console.log('Migration 8 applied successfully.');
  }

  if (currentVersion < 9) {
    console.log('Running Migration 9: Adding Database Performance & Concurrency Indexes...');
    try {
      await execute(`CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_user_id, started_at)`);
    } catch {}
    try {
      await execute(`CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_user_id, started_at)`);
    } catch {}
    try {
      await execute(`CREATE INDEX IF NOT EXISTS idx_voicemails_user ON voicemails(user_id, is_read)`);
    } catch {}
    try {
      await execute(`CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id)`);
    } catch {}
    try {
      await execute(`CREATE INDEX IF NOT EXISTS idx_speed_dials_user ON speed_dials(user_id)`);
    } catch {}

    await execute('INSERT INTO schema_migrations (version) VALUES (9)');
    console.log('Migration 9 applied successfully.');
  }

  if (currentVersion < 10) {
    console.log('Running Migration 10: Multi-Phone per Account, Phone Labels & Ring Toggles...');
    try {
      await execute('DROP TABLE IF EXISTS phones_v10');
      await execute(`
        CREATE TABLE phones_v10 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          device_id TEXT UNIQUE NOT NULL,
          phone_label TEXT DEFAULT 'Main Phone',
          ring_enabled INTEGER DEFAULT 1,
          mac_address TEXT,
          ip_address TEXT,
          firmware_version TEXT DEFAULT '1.2.2',
          rssi INTEGER DEFAULT 0,
          is_online INTEGER DEFAULT 0,
          hook_state TEXT DEFAULT 'on_hook',
          call_state TEXT DEFAULT 'idle',
          earpiece_volume INTEGER DEFAULT 80,
          mic_sensitivity INTEGER DEFAULT 80,
          audio_profile TEXT DEFAULT 'vintage_pots',
          sidetone_level INTEGER DEFAULT 10,
          ring_style TEXT DEFAULT 'traditional',
          ring_cadence_custom TEXT DEFAULT '2000,4000',
          ring_timeout_sec INTEGER DEFAULT 25,
          hardware_profile TEXT DEFAULT 'western_electric_500',
          bell_frequency_hz REAL DEFAULT 20.0,
          intercom_enabled INTEGER DEFAULT 1,
          hook_flash_enabled INTEGER DEFAULT 1,
          call_forwarding_enabled INTEGER DEFAULT 0,
          forward_to_number TEXT,
          last_seen DATETIME,
          paired_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await execute(`
        INSERT INTO phones_v10 (
          id, user_id, device_id, phone_label, ring_enabled, mac_address, ip_address,
          firmware_version, rssi, is_online,
          hook_state, call_state, earpiece_volume, mic_sensitivity,
          audio_profile, sidetone_level, ring_style, ring_cadence_custom, ring_timeout_sec,
          hardware_profile, bell_frequency_hz, intercom_enabled, hook_flash_enabled,
          call_forwarding_enabled, forward_to_number, last_seen, paired_at, created_at
        )
        SELECT 
          id, user_id, device_id, 'Main Phone', 1, mac_address, ip_address,
          COALESCE(firmware_version, '1.2.2'), COALESCE(rssi, 0), COALESCE(is_online, 0),
          hook_state, call_state, earpiece_volume, mic_sensitivity,
          COALESCE(audio_profile, 'vintage_pots'),
          COALESCE(sidetone_level, 10),
          COALESCE(ring_style, 'traditional'),
          COALESCE(ring_cadence_custom, '2000,4000'),
          COALESCE(ring_timeout_sec, 25),
          COALESCE(hardware_profile, 'western_electric_500'),
          COALESCE(bell_frequency_hz, 20.0),
          COALESCE(intercom_enabled, 1),
          COALESCE(hook_flash_enabled, 1),
          COALESCE(call_forwarding_enabled, 0),
          forward_to_number, last_seen, paired_at, created_at
        FROM phones
      `);

      await execute('DROP TABLE phones');
      await execute('ALTER TABLE phones_v10 RENAME TO phones');
      await execute('CREATE INDEX IF NOT EXISTS idx_phones_user ON phones(user_id)');
      await execute('CREATE INDEX IF NOT EXISTS idx_phones_device ON phones(device_id)');
    } catch (e) {
      console.error('Error during migration 10 table rebuild:', e);
      try { await execute(`ALTER TABLE phones ADD COLUMN phone_label TEXT DEFAULT 'Main Phone'`); } catch {}
      try { await execute(`ALTER TABLE phones ADD COLUMN ring_enabled INTEGER DEFAULT 1`); } catch {}
      try { await execute(`ALTER TABLE phones ADD COLUMN hook_flash_enabled INTEGER DEFAULT 1`); } catch {}
    }

    await execute('INSERT INTO schema_migrations (version) VALUES (10)');
    console.log('Migration 10 applied successfully.');
  }

  if (currentVersion < 11) {
    console.log('Running Migration 11: Phone OTA Auto-Update, Server Auto-Update & Icon Branding...');
    try {
      await execute(`ALTER TABLE phones ADD COLUMN ota_auto_update_enabled INTEGER DEFAULT 1`);
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN ota_update_time TEXT DEFAULT '03:00'`);
    } catch {}
    try {
      await execute(`ALTER TABLE phones ADD COLUMN ota_update_channel TEXT DEFAULT 'stable'`);
    } catch {}

    const defaults: Array<[string, string]> = [
      ['server_auto_update_enabled', 'false'],
      ['server_auto_update_channel', 'stable'],
      ['server_auto_update_time', '03:00'],
      ['server_auto_update_frequency', 'daily'],
      ['auto_backup_enabled', 'true'],
      ['auto_backup_interval', 'daily'],
      ['auto_backup_time', '02:00'],
      ['backup_retention_count', '10'],
      ['favicon_url', '/branding/favicon.png'],
      ['navbar_icon_url', '/branding/navbar_icon.png']
    ];

    for (const [k, v] of defaults) {
      await execute('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [k, v]);
    }

    await execute('INSERT INTO schema_migrations (version) VALUES (11)');
    console.log('Migration 11 applied successfully.');
  }

  if (currentVersion < 12) {
    console.log('Running Migration 12: Ensuring hook_flash_enabled column exists...');
    try {
      await execute(`ALTER TABLE phones ADD COLUMN hook_flash_enabled INTEGER DEFAULT 1`);
    } catch {}
    await execute('INSERT INTO schema_migrations (version) VALUES (12)');
    console.log('Migration 12 applied successfully.');
  }

  if (currentVersion < 13) {
    console.log('Running Migration 13: Adding pairing_code and expires_at to pending_device_enrollments...');
    try {
      await execute(`ALTER TABLE pending_device_enrollments ADD COLUMN pairing_code TEXT`);
    } catch {}
    try {
      await execute(`ALTER TABLE pending_device_enrollments ADD COLUMN expires_at DATETIME`);
    } catch {}
    await execute('INSERT INTO schema_migrations (version) VALUES (13)');
    console.log('Migration 13 applied successfully.');
  }

  if (currentVersion < 14) {
    console.log('Running Migration 14: E2EE Security Hardening, Device Auth, Local TTS & Legal Baseline...');

    // Clean up any leftover phones_v10 table from prior broken Migration 10
    await execute('DROP TABLE IF EXISTS phones_v10');

    // Phones security, call forwarding, E2EE device key wrapping, and real telemetry columns
    const phoneAlterStatements = [
      `ALTER TABLE phones ADD COLUMN device_token_hash TEXT`,
      `ALTER TABLE phones ADD COLUMN device_public_key TEXT`,
      `ALTER TABLE phones ADD COLUMN wrapped_vm_key TEXT`,
      `ALTER TABLE phones ADD COLUMN call_forwarding_enabled INTEGER DEFAULT 0`,
      `ALTER TABLE phones ADD COLUMN forward_to_number TEXT`,
      `ALTER TABLE phones ADD COLUMN last_pps REAL`,
      `ALTER TABLE phones ADD COLUMN last_break_ratio REAL`,
      `ALTER TABLE phones ADD COLUMN last_noise_floor_db REAL`,
      `ALTER TABLE phones ADD COLUMN free_heap INTEGER`,
      `ALTER TABLE phones ADD COLUMN free_psram INTEGER`
    ];
    for (const sql of phoneAlterStatements) {
      try {
        await execute(sql);
      } catch {}
    }

    // Users session revocation, DND window override expiry, and legal/E911 consent columns
    const userAlterStatements = [
      `ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1`,
      `ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME`,
      `ALTER TABLE users ADD COLUMN terms_version TEXT`,
      `ALTER TABLE users ADD COLUMN e911_acknowledged_at DATETIME`,
      `ALTER TABLE users ADD COLUMN dnd_override_until TEXT`
    ];
    for (const sql of userAlterStatements) {
      try {
        await execute(sql);
      } catch {}
    }

    // Voicemails zero-access ECIES ephemeral public key
    try {
      await execute(`ALTER TABLE voicemails ADD COLUMN ephemeral_public_key TEXT`);
    } catch {}

    // Directional per-user friend preferences (VIP & distinctive ringing)
    await execute(`
      CREATE TABLE IF NOT EXISTS friend_preferences (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_vip INTEGER DEFAULT 0,
        ring_style TEXT DEFAULT 'default',
        ring_cadence_custom TEXT,
        PRIMARY KEY (user_id, friend_id)
      )
    `);

    // Migrate existing non-default friends settings into friend_preferences
    try {
      await execute(`
        INSERT OR IGNORE INTO friend_preferences (user_id, friend_id, is_vip, ring_style, ring_cadence_custom)
        SELECT user_id, friend_id, COALESCE(is_vip, 0), COALESCE(ring_style, 'default'), ring_cadence_custom
        FROM friends
        WHERE COALESCE(is_vip, 0) != 0
           OR (ring_style IS NOT NULL AND ring_style != 'default')
           OR ring_cadence_custom IS NOT NULL
      `);
      await execute(`
        INSERT OR IGNORE INTO friend_preferences (user_id, friend_id, is_vip, ring_style, ring_cadence_custom)
        SELECT friend_id, user_id, COALESCE(is_vip, 0), COALESCE(ring_style, 'default'), ring_cadence_custom
        FROM friends
        WHERE COALESCE(is_vip, 0) != 0
           OR (ring_style IS NOT NULL AND ring_style != 'default')
           OR ring_cadence_custom IS NOT NULL
      `);
    } catch {}

    // Default system settings
    const mig14Defaults: Array<[string, string]> = [
      ['tts_voice', 'en_US-lessac-medium'],
      ['terms_version', '2026.11'],
      ['phone_number_min_length', '4'],
      ['phone_number_max_length', '4'],
      ['number_assignment_mode', 'user_choice']
    ];
    for (const [k, v] of mig14Defaults) {
      await execute('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [k, v]);
    }

    // Upgrade legacy August 2026 default Terms of Service & Privacy Policy to comprehensive 2026.11 legal baseline
    const existingTerms = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['terms_of_service']
    );
    if (!existingTerms?.value || existingTerms.value.includes('Last Updated: August 2026')) {
      await execute(
        'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
        ['terms_of_service', UPDATED_DEFAULT_TERMS]
      );
    }

    const existingPrivacy = await queryOne<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = ?',
      ['privacy_policy']
    );
    if (!existingPrivacy?.value || existingPrivacy.value.includes('Last Updated: August 2026')) {
      await execute(
        'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
        ['privacy_policy', UPDATED_DEFAULT_PRIVACY]
      );
    }

    await execute('INSERT INTO schema_migrations (version) VALUES (14)');
    console.log('Migration 14 applied successfully.');
  }

  if (currentVersion < 15) {
    console.log('Running Migration 15: Composite Area-Code Uniqueness, Recovery Keys, Dual TTS & Unified TLS Settings...');

    await execute('PRAGMA foreign_keys = OFF');
    try {
      await execute('DROP TABLE IF EXISTS users_v15');
      await execute(`
        CREATE TABLE users_v15 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          display_name TEXT,
          phone_number TEXT,
          area_code TEXT,
          role TEXT DEFAULT 'user',
          is_disabled INTEGER DEFAULT 0,
          disabled_reason TEXT,
          call_privacy TEXT DEFAULT 'everyone',
          avatar_url TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          encryption_public_key TEXT,
          encrypted_private_key TEXT,
          key_salt TEXT,
          recovery_encrypted_private_key TEXT,
          recovery_key_salt TEXT,
          email TEXT COLLATE NOCASE,
          notify_on_voicemail INTEGER DEFAULT 1,
          notify_on_missed_call INTEGER DEFAULT 1,
          dnd_manual_state INTEGER DEFAULT 0,
          dnd_schedule_enabled INTEGER DEFAULT 0,
          dnd_schedule_start TEXT DEFAULT '22:00',
          dnd_schedule_end TEXT DEFAULT '08:00',
          dnd_schedule_days TEXT DEFAULT '1,2,3,4,5,6,7',
          dnd_override_period TEXT,
          dnd_repeated_call_breakthrough INTEGER DEFAULT 1,
          token_version INTEGER DEFAULT 1,
          terms_accepted_at DATETIME,
          terms_version TEXT,
          e911_acknowledged_at DATETIME,
          dnd_override_until TEXT
        )
      `);

      await execute(`
        INSERT INTO users_v15 (
          id, username, password_hash, display_name, phone_number, area_code,
          role, is_disabled, disabled_reason, call_privacy, avatar_url, created_at,
          encryption_public_key, encrypted_private_key, key_salt,
          email, notify_on_voicemail, notify_on_missed_call,
          dnd_manual_state, dnd_schedule_enabled, dnd_schedule_start, dnd_schedule_end,
          dnd_schedule_days, dnd_override_period, dnd_repeated_call_breakthrough,
          token_version, terms_accepted_at, terms_version, e911_acknowledged_at, dnd_override_until
        )
        SELECT
          id, username, password_hash, display_name, phone_number, area_code,
          COALESCE(role, 'user'), COALESCE(is_disabled, 0), disabled_reason,
          COALESCE(call_privacy, 'everyone'), avatar_url, created_at,
          encryption_public_key, encrypted_private_key, key_salt,
          email, COALESCE(notify_on_voicemail, 1), COALESCE(notify_on_missed_call, 1),
          COALESCE(dnd_manual_state, 0), COALESCE(dnd_schedule_enabled, 0),
          COALESCE(dnd_schedule_start, '22:00'), COALESCE(dnd_schedule_end, '08:00'),
          COALESCE(dnd_schedule_days, '1,2,3,4,5,6,7'), dnd_override_period,
          COALESCE(dnd_repeated_call_breakthrough, 1),
          COALESCE(token_version, 1), terms_accepted_at, terms_version,
          e911_acknowledged_at, dnd_override_until
        FROM users
      `);

      await execute('DROP TABLE users');
      await execute('ALTER TABLE users_v15 RENAME TO users');
      await execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_area_phone ON users(COALESCE(area_code, ''), phone_number)");
    } finally {
      await execute('PRAGMA foreign_keys = ON');
    }

    const mig15Defaults: Array<[string, string]> = [
      ['tls_mode', 'proxy'],
      ['tls_acme_domain', ''],
      ['tls_acme_email', ''],
      ['tls_acme_staging', 'false'],
      ['tls_local_ca_hosts', ''],
      ['trust_proxy', 'false'],
      ['tts_engine', 'piper'],
      ['system_timezone', 'UTC'],
      ['weather_units', 'imperial'],
      ['weather_location', ''],
      ['ha_rotary_triggers_json', '{}']
    ];
    for (const [k, v] of mig15Defaults) {
      await execute('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [k, v]);
    }

    await execute('INSERT INTO schema_migrations (version) VALUES (15)');
    console.log('Migration 15 applied successfully.');
  }
}
