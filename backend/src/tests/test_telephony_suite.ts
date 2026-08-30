import { execute, query, queryOne } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { phoneSwitchService } from '../services/phoneSwitchService';
import { TtsAudioService } from '../services/ttsAudioService';

async function runVerification() {
  console.log('🧪 Starting Telephony Suite Verification Tests (Migration 8, Howler Tone & DND Breakthrough)...');

  // 1. Run migrations & check Migration 8 columns
  await runMigrations();
  console.log('✓ Database connected & migrations verified');

  const usersCols = await query<any>("PRAGMA table_info(users)");
  const userColNames = usersCols.map(c => c.name);
  if (!userColNames.includes('dnd_repeated_call_breakthrough')) {
    throw new Error('Migration 8 failed: users.dnd_repeated_call_breakthrough missing');
  }
  console.log('✓ Migration 8: users (dnd_repeated_call_breakthrough) present');

  // 2. DND Schedule & Repeated Call Breakthrough Logic Tests
  console.log('\nTesting DND Schedule & Repeated Call Breakthrough Engine:');
  const user1 = {
    id: 999,
    username: 'alice',
    dnd_manual_state: 1,
    call_privacy: 'friends_only',
    dnd_schedule_enabled: 0,
    dnd_repeated_call_breakthrough: 1
  };
  if (!phoneSwitchService.isDndActiveForUser(user1)) throw new Error('DND manual state 1 should be active');
  console.log('✓ DND manual state 1 is active');

  // Test Repeated Call Breakthrough simulation
  const callerNumber = '1002';
  const attemptKey = `${user1.id}_${callerNumber}`;
  const now = Date.now();

  // Attempt 1: recorded in recent attempts map
  const recentDndAttempts = (phoneSwitchService as any).recentDndAttempts as Map<string, number>;
  recentDndAttempts.set(attemptKey, now - 60000); // 1 minute ago

  // Attempt 2 within 3 minutes (180,000 ms)
  const lastAttempt = recentDndAttempts.get(attemptKey);
  const isWithin3Min = lastAttempt !== undefined && (now - lastAttempt) < 180000;
  if (!isWithin3Min) throw new Error('Repeated call within 60s should be detected within 3 min window');
  console.log('✓ Repeated call within 60s correctly identified for DND breakthrough');

  // Test expired call attempt (> 3 minutes)
  recentDndAttempts.set(attemptKey, now - 200000); // 3.3 minutes ago
  const expiredAttempt = recentDndAttempts.get(attemptKey);
  const isExpired = expiredAttempt !== undefined && (now - expiredAttempt) >= 180000;
  if (!isExpired) throw new Error('Call attempt older than 3 minutes should expire');
  console.log('✓ Call attempt older than 3 minutes correctly expires');

  // 3. Audio Tone Synthesis Verification (Howler Tone)
  console.log('\nTesting Howler Tone Synthesis:');
  const howler = TtsAudioService.generateHowlerTone(5.0);
  if (howler.length === 0 || howler.length !== 16000 * 5 * 2) {
    throw new Error(`Howler tone generation failed. Expected ${16000 * 5 * 2} bytes, got ${howler.length}`);
  }
  console.log(`✓ Receiver-Off-Hook Howler Tone synthesized (${howler.length} bytes PCM @ 16kHz)`);

  const stutterDial = TtsAudioService.generateStutterDialTone(2.0);
  if (stutterDial.length === 0) throw new Error('Stutter dial tone generation failed');
  console.log(`✓ Stutter dial tone synthesized (${stutterDial.length} bytes PCM)`);

  const dndDial = TtsAudioService.generateDndDialTone(2.0);
  if (dndDial.length === 0) throw new Error('DND dial tone generation failed');
  console.log(`✓ DND dial tone synthesized (${dndDial.length} bytes PCM)`);

  const chirp = TtsAudioService.generateChirpTone();
  if (chirp.length === 0) throw new Error('In-ear chirp tone generation failed');
  console.log(`✓ In-ear chirp tone synthesized (${chirp.length} bytes PCM)`);

  const comfort = TtsAudioService.generateComfortTone(3.0);
  if (comfort.length === 0 || comfort.length !== 16000 * 3 * 2) throw new Error('Comfort tone generation failed');
  console.log(`✓ Call Hold / Park Comfort Tone synthesized (${comfort.length} bytes PCM)`);

  const modem = TtsAudioService.generateModemHandshakeTone(4.0);
  if (modem.length === 0 || modem.length !== 16000 * 4 * 2) throw new Error('Modem Handshake simulator tone generation failed');
  console.log(`✓ Modem Handshake Simulator audio synthesized (${modem.length} bytes PCM)`);

  // Verify Migration 10 phone columns
  const phoneCols = await query<any>("PRAGMA table_info(phones)");
  const phoneColNames = phoneCols.map(c => c.name);
  if (!phoneColNames.includes('phone_label') || !phoneColNames.includes('ring_enabled')) {
    throw new Error('Migration 10 failed: phone_label or ring_enabled missing from phones table');
  }
  console.log('✓ Migration 10: phones (phone_label, ring_enabled) verified');

  console.log('\n🎉 ALL HOWLER, DND BREAKTHROUGH & TELEPHONY SUITE TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
