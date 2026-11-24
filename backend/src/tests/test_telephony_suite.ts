import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { execute, query, queryOne } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { VOICEMAILS_DIR, ensureDirectories } from '../config/paths';
import { phoneSwitchService } from '../services/phoneSwitchService';
import { serviceLinesService } from '../services/serviceLinesService';
import { acousticCalibrationService } from '../services/acousticCalibrationService';
import { TtsAudioService, AVAILABLE_VOICES } from '../services/ttsAudioService';
import { VoicemailCryptoService } from '../services/voicemailCryptoService';
import { isReservedNumberOrPrefix } from '../services/phoneAllocationService';

function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

class MockSocket {
  public readyState: number = WebSocket.OPEN;
  public sentJson: any[] = [];
  public sentBinary: Buffer[] = [];
  public onBinary?: (buf: Buffer) => void;
  public onJson?: (msg: any) => void;

  public send(data: string | Buffer) {
    if (Buffer.isBuffer(data)) {
      const copy = Buffer.from(data);
      this.sentBinary.push(copy);
      this.onBinary?.(copy);
    } else {
      try {
        const parsed = JSON.parse(String(data));
        this.sentJson.push(parsed);
        this.onJson?.(parsed);
      } catch {}
    }
  }
  public close() {
    this.readyState = WebSocket.CLOSED;
  }
}

async function runVerification() {
  console.log('🧪 Starting Telephony, E2EE Cryptography, Local TTS & Switchboard Verification Suite...');

  // 1. Run migrations & verify Migration 8, 10, and 14 schema
  await runMigrations();
  console.log('✓ Database connected & Migrations 1–14 verified');

  const leftoverV10 = await queryOne<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='phones_v10'");
  assert(!leftoverV10, 'phones_v10 leftover table must be dropped by Migration 14');

  const usersCols = (await query<any>('PRAGMA table_info(users)')).map((c) => c.name);
  for (const col of ['dnd_repeated_call_breakthrough', 'token_version', 'terms_accepted_at', 'terms_version', 'e911_acknowledged_at', 'encryption_public_key', 'encrypted_private_key', 'key_salt']) {
    assert(usersCols.includes(col), `Missing users.${col}`);
  }

  const phoneCols = (await query<any>('PRAGMA table_info(phones)')).map((c) => c.name);
  for (const col of ['phone_label', 'ring_enabled', 'hook_flash_enabled', 'device_token_hash', 'device_public_key', 'wrapped_vm_key', 'call_forwarding_enabled', 'forward_to_number', 'last_pps', 'last_break_ratio', 'last_noise_floor_db', 'free_heap', 'free_psram']) {
    assert(phoneCols.includes(col), `Missing phones.${col}`);
  }

  const vmCols = (await query<any>('PRAGMA table_info(voicemails)')).map((c) => c.name);
  assert(vmCols.includes('ephemeral_public_key'), 'Missing voicemails.ephemeral_public_key');

  const fpTable = await queryOne<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='friend_preferences'");
  assert(!!fpTable, 'friend_preferences table must exist');
  console.log('✓ Schema columns & friend_preferences table verified');

  // 2. Shared Cryptographic Contract & Zero-Access ECIES Voicemail Verification
  console.log('\nTesting E2EE User Key Bundle, Zero-Access Voicemail ECIES & Device Key Wrapping:');
  const testPassword = 'CorrectHorseBatteryStaple!99';
  const bundle = await VoicemailCryptoService.generateUserKeyBundle(testPassword);

  const pubBytes = Buffer.from(bundle.encryptionPublicKey, 'base64');
  const encPrivBytes = Buffer.from(bundle.encryptedPrivateKey, 'base64');
  assert(pubBytes.length === 65 && pubBytes[0] === 0x04, 'Public key must be 65-byte uncompressed P-256 point');
  assert(bundle.keySalt.length === 32, 'keySalt must be 16 bytes (32 hex chars)');
  assert(encPrivBytes.length === 12 + 16 + 96, 'encryptedPrivateKey must be 124 bytes [iv(12)||tag(16)||ciphertext(96)]');

  const unwrapped = await VoicemailCryptoService.unwrapUserKeyBundle(bundle.encryptedPrivateKey, bundle.keySalt, testPassword);
  assert(unwrapped.d.length === 32, 'Unwrapped P-256 private scalar d must be 32 bytes');
  assert(unwrapped.bundle96.length === 96, 'Unwrapped bundle must be 96 bytes [d||X||Y]');
  assert(unwrapped.publicKey.equals(pubBytes), 'Unwrapped public key coordinates must match encryptionPublicKey');
  console.log('✓ P-256 keypair bundle generation & PBKDF2-SHA256 (150k) unwrapping verified');

  // Zero-Access Voicemail ECIES Sealing + RAM Zeroing
  const samplePcm = TtsAudioService.generateSineTone(440, 250);
  const originalWav = VoicemailCryptoService.createWavBuffer(samplePcm);
  const expectedCopy = Buffer.from(originalWav);

  const sealed = VoicemailCryptoService.sealAudioForRecipient(originalWav, bundle.encryptionPublicKey);
  assert(originalWav.every((b) => b === 0), 'sealAudioForRecipient MUST zero plaintext wavBuffer in RAM immediately');
  assert(Buffer.from(sealed.ephemeralPublicKey, 'base64').length === 65, 'Ephemeral public key must be 65B P-256 point');

  const decryptedWav = VoicemailCryptoService.openSealedAudio(
    sealed.ciphertext,
    sealed.iv,
    sealed.tag,
    sealed.ephemeralPublicKey,
    unwrapped.bundle96
  );
  assert(decryptedWav.equals(expectedCopy), 'Client ECIES decryption must recover exact WAV bytes');
  console.log('✓ Zero-Access ECIES voicemail sealing, RAM zeroing & client decryption verified');

  // Device VM Key Wrapping
  const devEcdh = crypto.createECDH('prime256v1');
  const devPub65 = devEcdh.generateKeys();
  const devPrivRaw = devEcdh.getPrivateKey();
  const devPriv32 = devPrivRaw.length === 32 ? devPrivRaw : Buffer.concat([Buffer.alloc(32 - devPrivRaw.length), devPrivRaw]);

  const wrappedForDevice = VoicemailCryptoService.wrapVmKeyForDevice(unwrapped.bundle96, devPub65.toString('base64'));
  const unwrappedOnDevice = VoicemailCryptoService.unwrapVmKeyOnDevice(JSON.stringify(wrappedForDevice), devPriv32);
  assert(unwrappedOnDevice.equals(unwrapped.bundle96), 'ESP32/Simulator device key unwrapping must recover exact 96B VM key bundle');
  console.log('✓ Device VM key ECIES wrapping (decatone-dev-wrap-v1) verified');

  // 3. Local TTS Service Verification (Zero Cloud Calls)
  console.log('\nTesting 100% Local TTS Engine & Audio Synthesis:');
  assert(AVAILABLE_VOICES.length === 15, `Expected 15 local voices in catalog, got ${AVAILABLE_VOICES.length}`);
  assert(
    ['piper', 'kokoro', 'espeak'].every((eng) => AVAILABLE_VOICES.some((v) => v.engine === eng)),
    'Catalog must expose piper, kokoro, and espeak engines'
  );
  const ttsStatus = await TtsAudioService.getTtsStatus();
  assert(ttsStatus.voices.length === 15, 'getTtsStatus must expose all 15 voices');

  const proceduralPcm = await TtsAudioService.synthesizeSpeech('DecaTone operator test 1 2 3.', 'procedural_vintage');
  assert(proceduralPcm.length > 3200 && proceduralPcm.length % 2 === 0, 'Procedural formant speech must produce 16-bit PCM');

  const previewWav = await TtsAudioService.synthesizeWav('Your pairing code is TONE 4 8 2 1.');
  assert(VoicemailCryptoService.isValidWavHeader(previewWav), 'synthesizeWav must produce a valid RIFF WAVE buffer');
  const decodedPreview = VoicemailCryptoService.decodeWavTo16kMonoPcm(previewWav);
  assert(decodedPreview.length === previewWav.length - 44, 'decodeWavTo16kMonoPcm must cleanly extract 16kHz s16le PCM');
  console.log(`✓ Local TTS synthesized (${previewWav.length} bytes WAV, active engine: ${ttsStatus.activeEngine})`);

  // Tone Generators
  const howler = TtsAudioService.generateHowlerTone(5.0);
  assert(howler.length === 16000 * 5 * 2, 'Howler tone length mismatch');
  const comfort = TtsAudioService.generateComfortTone(3.0);
  assert(comfort.length === 16000 * 3 * 2, 'Lazy loop comfort tone length mismatch');
  const modem = TtsAudioService.generateModemHandshakeTone(4.0);
  assert(modem.length === 16000 * 4 * 2, 'Modem tone length mismatch');
  console.log('✓ Howler, Comfort (lazy precomputed loop), and Modem tones verified');

  // 4. DND Schedule, Expiring Override & Breakthrough Engine
  console.log('\nTesting DND Expiring Override & Breakthrough Engine:');
  assert(isReservedNumberOrPrefix('911') && isReservedNumberOrPrefix('112') && isReservedNumberOrPrefix('999') && isReservedNumberOrPrefix('5'), 'Emergency & single-digit speed dial numbers must be reserved');

  const dndUserManual = { id: 999901, dnd_manual_state: 1, call_privacy: 'everyone', dnd_schedule_enabled: 0 };
  assert(phoneSwitchService.isDndActiveForUser(dndUserManual), 'Manual DND must be active');

  const dndUserPrivacy = { id: 999902, dnd_manual_state: 0, call_privacy: 'dnd', dnd_schedule_enabled: 0 };
  assert(phoneSwitchService.isDndActiveForUser(dndUserPrivacy), "call_privacy='dnd' must be treated as active DND");

  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
  const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
  const alwaysScheduledUser = {
    dnd_manual_state: 0,
    call_privacy: 'everyone',
    dnd_schedule_enabled: 1,
    dnd_schedule_start: '00:00',
    dnd_schedule_end: '23:59',
    dnd_schedule_days: '1,2,3,4,5,6,7',
    dnd_override_until: futureIso
  };
  assert(!phoneSwitchService.isDndActiveForUser(alwaysScheduledUser), 'Future dnd_override_until must suppress scheduled DND');
  alwaysScheduledUser.dnd_override_until = pastIso;
  assert(phoneSwitchService.isDndActiveForUser(alwaysScheduledUser), 'Expired dnd_override_until must re-activate scheduled DND');
  console.log('✓ DND schedule window & expiring dnd_override_until verified');

  // 5. Switchboard Speed Dials, Call Forwarding (with Loop Guard) & Binary E2EE Framing
  console.log('\nTesting Speed Dials, Call Forwarding & 0x01/0x02 Binary Framing:');
  const uidA = 999801;
  const uidB = 999802;
  const uidC = 999803;
  const devA = 'TEST-DEV-A';
  const devB = 'TEST-DEV-B';
  const devC = 'TEST-DEV-C';

  const phoneClients = (phoneSwitchService as any).phoneClients as Map<string, any>;
  const sockA = new MockSocket();
  const sockB = new MockSocket();
  const sockC = new MockSocket();

  try {
    await execute('DELETE FROM users WHERE id IN (?, ?, ?)', [uidA, uidB, uidC]);
    await execute('DELETE FROM phones WHERE device_id IN (?, ?, ?)', [devA, devB, devC]);

    await execute(
      `INSERT INTO users (id, username, password_hash, display_name, phone_number, role, encryption_public_key, encrypted_private_key, key_salt)
       VALUES (?, 'test_alice_sw', 'x', 'Alice', '8801', 'user', ?, ?, ?)`,
      [uidA, bundle.encryptionPublicKey, bundle.encryptedPrivateKey, bundle.keySalt]
    );
    await execute(
      `INSERT INTO users (id, username, password_hash, display_name, phone_number, role, encryption_public_key, encrypted_private_key, key_salt)
       VALUES (?, 'test_bob_sw', 'x', 'Bob', '8802', 'user', ?, ?, ?)`,
      [uidB, bundle.encryptionPublicKey, bundle.encryptedPrivateKey, bundle.keySalt]
    );
    await execute(
      `INSERT INTO users (id, username, password_hash, display_name, phone_number, role, encryption_public_key, encrypted_private_key, key_salt)
       VALUES (?, 'test_carol_sw', 'x', 'Carol', '8803', 'user', ?, ?, ?)`,
      [uidC, bundle.encryptionPublicKey, bundle.encryptedPrivateKey, bundle.keySalt]
    );

    // Bob forwards calls to Carol (8803)
    await execute(
      `INSERT INTO phones (device_id, user_id, is_online, call_forwarding_enabled, forward_to_number)
       VALUES (?, ?, 1, 0, NULL), (?, ?, 1, 1, '8803'), (?, ?, 1, 0, NULL)`,
      [devA, uidA, devB, uidB, devC, uidC]
    );

    // Alice configures Speed Dial slot 2 -> Bob (8802), which forwards to Carol (8803)!
    await execute(
      'INSERT INTO speed_dials (user_id, slot_digit, target_user_id, target_phone_number, label) VALUES (?, 2, ?, ?, ?)',
      [uidA, uidB, '8802', 'Bob']
    );

    phoneClients.set(devA, { ws: sockA, deviceId: devA, userId: uidA, phoneNumber: '8801', ipAddress: '127.0.0.1', lastHeartbeat: Date.now(), lastDbWriteAt: Date.now() });
    phoneClients.set(devB, { ws: sockB, deviceId: devB, userId: uidB, phoneNumber: '8802', ipAddress: '127.0.0.1', lastHeartbeat: Date.now(), lastDbWriteAt: Date.now() });
    phoneClients.set(devC, { ws: sockC, deviceId: devC, userId: uidC, phoneNumber: '8803', ipAddress: '127.0.0.1', lastHeartbeat: Date.now(), lastDbWriteAt: Date.now() });

    // Dial single digit '2' on Alice's phone -> Speed Dial -> 8802 -> Forwarded to Carol (8803)!
    await phoneSwitchService.processCompletedDialBuffer(devA, '2');

    const carolIncoming = sockC.sentJson.find((m) => m.type === 'incoming_call');
    assert(!!carolIncoming, 'Speed dial 2 -> 8802 must forward incoming_call to Carol (8803)');
    assert(!sockB.sentJson.some((m) => m.type === 'incoming_call'), 'Forwarded phone B must not ring');
    console.log('✓ Single-digit Speed Dial (slot 2) + Call Forwarding (8802 -> 8803) verified');

    // Carol answers -> E2EE call_connected includes callId and isKeyLeader!
    const answered = await phoneSwitchService.handleCallAnswer(devC, carolIncoming.callId);
    assert(answered, 'Carol must answer forwarded call');

    const aliceConnected = sockA.sentJson.find((m) => m.type === 'call_connected');
    const carolConnected = sockC.sentJson.find((m) => m.type === 'call_connected');
    assert(aliceConnected?.callId === carolIncoming.callId && aliceConnected?.isKeyLeader === true, 'Caller must be E2EE keyLeader');
    assert(carolConnected?.callId === carolIncoming.callId && carolConnected?.isKeyLeader === false, 'Callee must receive isKeyLeader=false');

    // Test binary framing: non-0x01 packet MUST be dropped; 0x01 E2EE packet MUST be relayed blindly!
    const unencryptedAttempt = Buffer.alloc(100, 0x00);
    phoneSwitchService.handleAudioPacket(devA, unencryptedAttempt);
    assert(sockC.sentBinary.length === 0, 'Switchboard MUST drop non-0x01 audio frames during connected peer call');

    const validE2eePacket = Buffer.concat([Buffer.from([0x01, 0x01]), crypto.randomBytes(12 + 16 + 64)]);
    phoneSwitchService.handleAudioPacket(devA, validE2eePacket);
    assert(sockC.sentBinary.length === 1 && sockC.sentBinary[0].equals(validE2eePacket), 'Switchboard MUST forward 0x01 E2EE packet unmodified to peer');
    console.log('✓ E2EE call signaling (isKeyLeader) & strict 0x01 binary media relay verified');

    // 6. WEB-MON-* Monitor-Only, Signed E2EE Relay, [0x04][slot] Group Tagging & e2ee_leader_changed
    console.log('\nTesting Monitor-Only Softphone, ECDSA E2EE Relay, [0x04] Slot Framing & Leader Handover:');
    const switchAny = phoneSwitchService as any;
    const sockMon = new MockSocket();
    let monDevId: string | null = null;
    await switchAny.handleJsonMessage(
      sockMon,
      '127.0.0.1',
      { type: 'web_client_init', monitorOnly: true },
      { id: uidA, username: 'test_alice_sw', role: 'user' },
      () => monDevId,
      (id: string) => { monDevId = id; }
    );
    assert(monDevId && monDevId.startsWith(`WEB-MON-${uidA}-`), 'Monitor-only web_client_init must assign WEB-MON-* ID');
    const monAck = sockMon.sentJson.find((m) => m.type === 'web_client_ack');
    assert(monAck?.monitorOnly === true && phoneClients.get(monDevId!)?.isMonitorOnly === true, 'Monitor client must carry monitorOnly=true');

    // Generate P-256 identity keypair for Alice's hardware phone devA
    const idKeyPairA = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const rawPubA = crypto.createECDH('prime256v1');
    const spkiDer = idKeyPairA.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const pubA65 = spkiDer.subarray(spkiDer.length - 65);
    assert(pubA65.length === 65 && pubA65[0] === 0x04, 'SPKI tail must be 65-byte uncompressed P-256 point');
    const pubAB64 = pubA65.toString('base64');
    await execute('UPDATE phones SET device_public_key = ? WHERE device_id = ?', [pubAB64, devA]);

    // Clear forwarding on Bob so A->B direct & group tests work cleanly
    await execute('UPDATE phones SET call_forwarding_enabled = 0, forward_to_number = NULL WHERE device_id = ?', [devB]);
    // Make A, B, C mutual accepted friends for group invite
    await execute(
      "INSERT OR REPLACE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted'), (?, ?, 'accepted'), (?, ?, 'accepted')",
      [uidA, uidB, uidA, uidC, uidB, uidC]
    );

    sockA.sentJson = [];
    sockB.sentJson = [];
    sockC.sentJson = [];
    sockA.sentBinary = [];
    sockB.sentBinary = [];
    sockC.sentBinary = [];

    await phoneSwitchService.initiateCall(devA, '8802');
    const ringB = sockB.sentJson.find((m) => m.type === 'incoming_call');
    assert(!!ringB, 'Direct call A->B must ring devB');
    assert(!sockMon.sentJson.some((m) => m.type === 'incoming_call'), 'Monitor-only WEB-MON-* must not ring on incoming calls');
    await phoneSwitchService.handleCallAnswer(devB, ringB.callId);

    // Relay signed e2ee_pub from A -> B
    const ephAB64 = rawPubA.generateKeys().toString('base64');
    const sigMsg = Buffer.from(`decatone-e2ee-v1:${ringB.callId}:${ephAB64}`, 'utf8');
    const sigAB64 = crypto.sign('sha256', sigMsg, { key: idKeyPairA.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    await switchAny.handleJsonMessage(
      sockA,
      '127.0.0.1',
      {
        type: 'e2ee_pub',
        callId: ringB.callId,
        publicKey: ephAB64,
        identityPublicKey: pubAB64,
        signature: sigAB64
      },
      null,
      () => devA,
      () => {}
    );
    const relayedPeerPub = sockB.sentJson.find((m) => m.type === 'e2ee_peer_pub' && m.peerDeviceId === devA);
    assert(
      relayedPeerPub &&
        relayedPeerPub.identityPublicKey === pubAB64 &&
        relayedPeerPub.signature === sigAB64 &&
        relayedPeerPub.expectedIdentityPublicKey === pubAB64 &&
        relayedPeerPub.legacyUnsigned === false,
      'Switchboard must relay signed e2ee_peer_pub with pinned expectedIdentityPublicKey and legacyUnsigned=false'
    );

    // Invite Carol (8803) into connected call via executeInCallGroupInvite -> 3-way [0x04][slot] group framing & leader handover
    await switchAny.executeInCallGroupInvite(devA, ringB.callId, '8803');
    const invC = sockC.sentJson.find((m) => m.type === 'incoming_call');
    assert(!!invC, 'Group invite must ring Carol (devC)');
    await phoneSwitchService.handleCallAnswer(devC, invC.callId);

    const groupFrameIn = Buffer.concat([Buffer.from([0x01, 0x02]), crypto.randomBytes(12 + 16 + 40)]);
    sockB.sentBinary = [];
    sockC.sentBinary = [];
    phoneSwitchService.handleAudioPacket(devA, groupFrameIn);
    assert(
      sockB.sentBinary.length === 1 &&
        sockB.sentBinary[0][0] === 0x04 &&
        sockB.sentBinary[0].subarray(2).equals(groupFrameIn.subarray(1)),
      'Group call must rewrite 0x01 into [0x04][slot] toward devB'
    );
    assert(
      sockC.sentBinary.length === 1 && sockC.sentBinary[0][0] === 0x04,
      'Group call must rewrite 0x01 into [0x04][slot] toward devC'
    );

    // Hangup Key Leader devA -> remaining leader receives e2ee_leader_changed
    sockB.sentJson = [];
    sockC.sentJson = [];
    await phoneSwitchService.handleCallHangup(devA);
    const leaderMsg = [...sockB.sentJson, ...sockC.sentJson].find((m) => m.type === 'e2ee_leader_changed');
    assert(leaderMsg && leaderMsg.isKeyLeader === true && !!leaderMsg.newKeyLeaderDeviceId, 'Key leader hangup in group call must emit e2ee_leader_changed');
    await phoneSwitchService.handleCallHangup(devB);
    await phoneSwitchService.handleCallHangup(devC);
    phoneClients.delete(monDevId!);
    console.log('✓ Monitor-only WEB-MON, signed e2ee_pub, [0x04][slot] audio, and e2ee_leader_changed verified');

    // 7. Call Waiting Bridge, Mute Flags, Park/Unpark '8' + Peer Hangup, call_decline_to_voicemail
    console.log('\nTesting Call Waiting Bridge, Mute Flags, Park/Unpark & Decline-to-Voicemail:');
    sockA.sentJson = [];
    sockB.sentJson = [];
    sockC.sentJson = [];
    await phoneSwitchService.initiateCall(devA, '8802');
    const abRing = sockB.sentJson.find((m) => m.type === 'incoming_call');
    await phoneSwitchService.handleCallAnswer(devB, abRing.callId);

    // Carol calls busy Bob -> Call Waiting tone -> Bob hook-flashes -> bridged directly to Carol
    await phoneSwitchService.initiateCall(devC, '8802');
    assert(sockB.sentJson.some((m) => m.type === 'play_tone' && m.tone === 'call_waiting'), 'Busy callee must receive call_waiting tone');
    sockC.sentJson = [];
    sockB.sentJson = [];
    await phoneSwitchService.handleHookFlash(devB);
    assert(
      sockB.sentJson.some((m) => m.type === 'call_connected') && sockC.sentJson.some((m) => m.type === 'call_connected'),
      'Hook-flash on call waiting must bridge B & C directly'
    );
    await phoneSwitchService.handleCallHangup(devB);

    // Mute flags { isMuted, muted } & Park / Unpark '8' & Peer Hangup
    sockA.sentJson = [];
    sockB.sentJson = [];
    await phoneSwitchService.initiateCall(devA, '8802');
    const abRing2 = sockB.sentJson.find((m) => m.type === 'incoming_call');
    await phoneSwitchService.handleCallAnswer(devB, abRing2.callId);

    await switchAny.handleDialDigit(devA, '2', {});
    const muteOnMsg = sockA.sentJson.find((m) => m.type === 'mic_mute_state' && m.isMuted === true);
    assert(muteOnMsg && muteOnMsg.muted === true, 'Digit 2 mute must emit { isMuted: true, muted: true }');
    await switchAny.handleDialDigit(devA, '2', {});
    const muteOffMsg = sockA.sentJson.find((m) => m.type === 'mic_mute_state' && m.isMuted === false);
    assert(muteOffMsg && muteOffMsg.muted === false, 'Second digit 2 must emit { isMuted: false, muted: false }');

    const activeCallObj = switchAny.findCallByDevice(devA);
    assert(!!activeCallObj, 'Expected active call before park');
    await phoneSwitchService.parkCall(activeCallObj, devA);
    assert(activeCallObj.state === 'parked', 'parkCall must set call.state=parked');
    sockA.sentJson = [];
    await switchAny.handleDialDigit(devA, '8', {});
    assert(activeCallObj.state === 'connected' && sockA.sentJson.some((m) => m.type === 'call_connected'), "Digit '8' on parked call must unpark & reconnect");

    // Re-park and have peer hang up -> parked call must terminate cleanly
    await phoneSwitchService.parkCall(activeCallObj, devA);
    await phoneSwitchService.handleCallHangup(devB);
    assert(!switchAny.activeCalls.has(activeCallObj.id), 'Peer hangup during parked call must terminate parked call');
    serviceLinesService.cleanupDevice(devA);

    // Decline to voicemail via WebSocket control message
    await TtsAudioService.setPreferredConfig({ engine: 'espeak' });
    sockA.sentJson = [];
    sockB.sentJson = [];
    await phoneSwitchService.initiateCall(devA, '8802');
    const decRing = sockB.sentJson.find((m) => m.type === 'incoming_call');
    assert(!!decRing, 'Expected incoming call before decline_to_voicemail');
    await switchAny.handleJsonMessage(
      sockB,
      '127.0.0.1',
      { type: 'call_decline_to_voicemail', callId: decRing.callId },
      null,
      () => devB,
      () => {}
    );
    assert(sockB.sentJson.some((m) => m.type === 'stop_ring'), 'Decline to voicemail must send stop_ring to callee');
    assert(sockA.sentJson.some((m) => m.type === 'voicemail_start'), 'Decline to voicemail must transition caller to voicemail_start');
    await phoneSwitchService.handleCallHangup(devA);
    console.log('✓ Call waiting bridge, mute flags, unpark (8), peer hangup on park, and call_decline_to_voicemail verified');

    // 8. Service Lines (411, 611, 711, 90x HA Trigger) & Acoustic Calibration calibration_stop
    console.log('\nTesting Service Lines (411, 611, 711, 90x HA Trigger) & Calibration calibration_stop:');
    // Regression check: dialing 902 when mqtt_enabled is 'false' must immediately emit reorder (no recursion!)
    await execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('mqtt_enabled', 'false')");
    sockC.sentJson = [];
    await phoneSwitchService.initiateCall(devC, '902');
    assert(
      sockC.sentJson.some((m) => m.type === 'play_tone' && m.tone === 'reorder'),
      'Dialing 902 while mqtt_enabled=false must emit reorder without recursion'
    );

    await execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('system_timezone', 'America/New_York')");
    await execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('weather_location', 'New York')");
    await execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('mqtt_enabled', 'true')");
    await execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('ha_rotary_triggers_json', ?)", [JSON.stringify({ '901': 'Porch Lights' })]);

    const devW = 'TEST-DEV-W';
    const sockW = new MockSocket();
    phoneClients.set(devW, { ws: sockW, deviceId: devW, userId: uidA, phoneNumber: '8801', ipAddress: '127.0.0.1', lastHeartbeat: Date.now(), lastDbWriteAt: Date.now() });

    sockA.sentJson = []; sockA.sentBinary = [];
    sockB.sentJson = []; sockB.sentBinary = [];
    sockC.sentJson = []; sockC.sentBinary = [];

    // Keep Node event loop alive while awaiting .unref()'d real-time audio timers
    const eventLoopHold = setInterval(() => {
      for (const dev of [devA, devB, devC, devW]) {
        const c = phoneClients.get(dev);
        if (c) c.lastHeartbeat = Date.now();
      }
    }, 500);

    try {
      await Promise.all([
        phoneSwitchService.processCompletedDialBuffer(devA, '411'),
        phoneSwitchService.processCompletedDialBuffer(devB, '611'),
        phoneSwitchService.processCompletedDialBuffer(devW, '711'),
        phoneSwitchService.initiateCall(devC, '901')
      ]);
    } finally {
      clearInterval(eventLoopHold);
      phoneClients.delete(devW);
    }

    assert(sockA.sentJson.some((m) => m.type === 'call_connected' && m.isSystemLine === true) && sockA.sentJson.some((m) => m.type === 'call_ended'), '411 Speaking Clock must connect as system line and end cleanly');
    assert(sockA.sentBinary.some((b) => b[0] === 0x00), '411 must stream [0x00] PCM frames');
    assert(sockB.sentJson.some((m) => m.type === 'call_connected' && m.isSystemLine === true) && sockB.sentBinary.some((b) => b[0] === 0x00), '611 Line Diagnostics must stream [0x00] PCM');
    assert(sockW.sentJson.some((m) => m.type === 'call_connected' && m.calleeNumber === '711' && m.isSystemLine === true) && sockW.sentBinary.some((b) => b[0] === 0x00), '711 Weather Hotline must stream [0x00] PCM');
    const haConn = sockC.sentJson.find((m) => m.type === 'call_connected' && m.isSystemLine === true);
    assert(haConn && String(haConn.calleeName).includes('Porch Lights'), 'Dialing 901 must trigger Home Assistant automation announcement');

    // Calibration sweep with instant mock sample replies -> verifies calibration_stop
    const calHold = setInterval(() => {
      const c = phoneClients.get(devA);
      if (c) c.lastHeartbeat = Date.now();
    }, 500);
    sockA.sentJson = [];
    sockA.onJson = (msg) => {
      if (msg.type === 'calibration_step' && msg.active) {
        setImmediate(() => acousticCalibrationService.handleCalibrationSample(devA, Number(msg.frequency), 350));
      }
    };
    try {
      const calResult = await acousticCalibrationService.runSweep(devA, sockA as any);
      assert(sockA.sentJson.some((m) => m.type === 'calibration_stop'), 'Acoustic calibration sweep must emit calibration_stop in finally');
      assert(calResult.usedRealHardwareSamples && calResult.peakFrequency >= 15 && calResult.peakFrequency <= 35, 'Calibration sweep must return valid peakFrequency');
    } finally {
      sockA.onJson = undefined;
      clearInterval(calHold);
    }
    console.log('✓ 411, 611, 711, 90x HA trigger & acoustic calibration calibration_stop verified');

    // 9. Chunked [0x03] Dial-0 Voicemail Streaming + voicemail_playback_done
    console.log('\nTesting Chunked [0x03] Dial-0 Voicemail Streaming & voicemail_playback_done:');
    ensureDirectories();
    const vmWav = VoicemailCryptoService.createWavBuffer(TtsAudioService.generateSineTone(440, 200));
    const sealedVm = VoicemailCryptoService.sealAudioForRecipient(vmWav, bundle.encryptionPublicKey);
    const encFilename = `test_chunk_${Date.now()}.enc`;
    const encPath = path.join(VOICEMAILS_DIR, encFilename);
    fs.writeFileSync(encPath, sealedVm.ciphertext);

    const vmInsertRes = await execute(
      `INSERT INTO voicemails (user_id, caller_user_id, caller_number, audio_url, duration_sec, is_read, is_encrypted, ephemeral_public_key, encryption_iv, encryption_tag)
       VALUES (?, ?, '8802', ?, 1, 0, 1, ?, ?, ?)`,
      [uidA, uidB, encFilename, sealedVm.ephemeralPublicKey, sealedVm.iv, sealedVm.tag]
    );
    const testVmId = vmInsertRes.lastID;

    sockA.sentJson = [];
    sockA.sentBinary = [];
    const vmChunks: { vmId: number; seq: number; flags: number; payload: Buffer }[] = [];
    sockA.onBinary = (buf) => {
      if (buf[0] === 0x03 && buf.length >= 8) {
        const vmId = buf.readUInt32BE(1);
        const seq = buf.readUInt16BE(5);
        const flags = buf[7];
        vmChunks.push({ vmId, seq, flags, payload: Buffer.from(buf.subarray(8)) });
        if ((flags & 1) !== 0) {
          setImmediate(() => {
            switchAny.handleJsonMessage(
              sockA,
              '127.0.0.1',
              { type: 'voicemail_playback_done', vmId },
              null,
              () => devA,
              () => {}
            );
          });
        }
      }
    };

    const vmHold = setInterval(() => {
      const c = phoneClients.get(devA);
      if (c) c.lastHeartbeat = Date.now();
    }, 500);

    try {
      await phoneSwitchService.startVoicemailPlaybackSession(devA, uidA);
      sockA.onBinary = undefined;
      assert(sockA.sentJson.some((m) => m.type === 'voicemail_stream_start' && Number(m.vmId) === testVmId), 'Dial-0 must emit voicemail_stream_start');
      assert(vmChunks.length > 0 && vmChunks[0].vmId === testVmId, 'Dial-0 must emit [0x03] chunks with matching big-endian vmId');
      assert((vmChunks[vmChunks.length - 1].flags & 1) === 1, 'Final [0x03] chunk must set end-of-stream flag');
      const reassembled = Buffer.concat(vmChunks.map((c) => c.payload));
      assert(reassembled.equals(sealedVm.ciphertext), 'Reassembled [0x03] chunks must match sealed .enc ciphertext byte-for-byte');
      const vmAfter = await queryOne<any>('SELECT is_read FROM voicemails WHERE id = ?', [testVmId]);
      assert(vmAfter.is_read === 1, 'Voicemail must be marked read after voicemail_playback_done ACK');
      console.log(`✓ Chunked [0x03] voicemail streaming (${vmChunks.length} chunk(s), ${reassembled.length}B) & voicemail_playback_done ACK verified`);
    } finally {
      clearInterval(vmHold);
      sockA.onBinary = undefined;
      serviceLinesService.cleanupDevice(devA);
      await execute('DELETE FROM voicemails WHERE id = ?', [testVmId]);
      try { if (fs.existsSync(encPath)) fs.unlinkSync(encPath); } catch {}
    }
  } finally {
    phoneClients.delete(devA);
    phoneClients.delete(devB);
    phoneClients.delete(devC);
    await execute("DELETE FROM system_settings WHERE key IN ('system_timezone', 'weather_location', 'mqtt_enabled', 'ha_rotary_triggers_json')");
    await execute('DELETE FROM friends WHERE user_id IN (?, ?, ?) OR friend_id IN (?, ?, ?)', [uidA, uidB, uidC, uidA, uidB, uidC]);
    await execute('DELETE FROM calls WHERE caller_user_id IN (?, ?, ?) OR callee_user_id IN (?, ?, ?)', [uidA, uidB, uidC, uidA, uidB, uidC]);
    await execute('DELETE FROM speed_dials WHERE user_id IN (?, ?, ?)', [uidA, uidB, uidC]);
    await execute('DELETE FROM phones WHERE device_id IN (?, ?, ?)', [devA, devB, devC]);
    await execute('DELETE FROM users WHERE id IN (?, ?, ?)', [uidA, uidB, uidC]);
  }

  console.log('\n🎉 ALL CRYPTOGRAPHY, LOCAL TTS, DND, SPEED DIAL, FORWARDING & TELEPHONY TESTS PASSED!');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
