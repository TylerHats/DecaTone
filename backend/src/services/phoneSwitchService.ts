import WebSocket from 'ws';
import crypto from 'crypto';
import { execute, query, queryOne } from '../db/connection';
import { serviceLinesService } from './serviceLinesService';
import { homeAssistantMqttService } from './homeAssistantMqttService';
import { TtsAudioService } from './ttsAudioService';

export interface PhoneSocketClient {
  ws: WebSocket;
  deviceId: string;
  userId?: number;
  phoneNumber?: string;
  ipAddress: string;
  lastHeartbeat: number;
}

export interface ActiveCall {
  id: string;
  callerDeviceId: string;
  callerUserId?: number;
  callerNumber: string;
  callerName: string;
  calleeDeviceId: string;
  calleeUserId?: number;
  calleeNumber: string;
  calleeName: string;
  sessionKey: string;
  state: 'ringing' | 'connected' | 'busy' | 'ended' | 'voicemail' | 'parked';
  startedAt: number;
  connectedAt?: number;
  ringTimeoutTimer?: NodeJS.Timeout;
  voicemailChunks?: Buffer[];
  calleeScreeningDeviceId?: string; // Callee device listening live to voicemail
  isOnHold?: boolean;
  isGroupCall?: boolean;
  participants?: Set<string>; // All deviceIds in 3-way/group conference (max 5)
  isIntercom?: boolean;
  intercomParticipants?: Set<string>;
  mutedDevices?: Set<string>; // Devices with mic muted via digit '2'
  isInviteLeg?: boolean;
  inviteTimer?: NodeJS.Timeout;
  parkedByUserId?: number;
  parkedByDeviceId?: string;
  ringingDevices?: Set<string>; // All physical deviceIds ringing for this incoming call
}

interface WaitingCall {
  callerDeviceId: string;
  callerUserId?: number;
  callerNumber: string;
  callerName: string;
  calleeUser: any;
  ringTimeoutTimer: NodeJS.Timeout;
}

interface InCallInviteState {
  callId: string;
  inviterDeviceId: string;
  buffer: string;
  interdigitTimer?: NodeJS.Timeout;
}

export class PhoneSwitchService {
  private phoneClients: Map<string, PhoneSocketClient> = new Map();
  private webClients: Set<WebSocket> = new Set();
  private activeCalls: Map<string, ActiveCall> = new Map();
  private dialedBuffers: Map<string, { buffer: string; timer?: NodeJS.Timeout }> = new Map();
  private waitingCalls: Map<string, WaitingCall> = new Map();
  private inCallInviteStates: Map<string, InCallInviteState> = new Map();
  private directVmTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeVoicemailSessions: Map<number, ActiveCall> = new Map(); // Key: calleeUserId
  private recentDndAttempts: Map<string, number> = new Map(); // Key: calleeId_callerNumber -> timestamp
  private offHookInactivityTimers: Map<string, { stage1Timer?: NodeJS.Timeout; stage2Timer?: NodeJS.Timeout }> = new Map();

  constructor() {
    setInterval(() => this.cleanupStaleDevices(), 30000);
    console.log('☎️  DecaTone Phone Switchboard Service Initialized on /ws/phone');
  }

  // Off-Hook Inactivity & Howler Alert Timers
  public startOffHookInactivityTimer(deviceId: string) {
    this.clearOffHookInactivityTimer(deviceId);

    // Stage 1 (after 15 seconds off-hook with no dialing): Play Fast Busy / Reorder tone
    const stage1 = setTimeout(async () => {
      const phone = await queryOne<any>('SELECT hook_state, call_state FROM phones WHERE device_id = ?', [deviceId]);
      const dialObj = this.dialedBuffers.get(deviceId);
      if (phone?.hook_state === 'off_hook' && (!dialObj?.buffer || dialObj.buffer === '')) {
        const activeCall = this.findCallByDevice(deviceId);
        if (!activeCall && !serviceLinesService.isLoopbackActive(deviceId)) {
          console.log(`[Switch] ⏱️ Off-hook inactivity (15s) on ${deviceId} -> Fast Busy`);
          this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
        }
      }
    }, 15000);

    // Stage 2 (after 30 seconds off-hook with no dialing): Play Receiver-Off-Hook Howler Tone Siren!
    const stage2 = setTimeout(async () => {
      const phone = await queryOne<any>('SELECT hook_state, call_state FROM phones WHERE device_id = ?', [deviceId]);
      const dialObj = this.dialedBuffers.get(deviceId);
      if (phone?.hook_state === 'off_hook' && (!dialObj?.buffer || dialObj.buffer === '')) {
        const activeCall = this.findCallByDevice(deviceId);
        if (!activeCall && !serviceLinesService.isLoopbackActive(deviceId)) {
          console.log(`[Switch] 🚨 Off-hook inactivity (30s) on ${deviceId} -> HOWLER TONE ALERT!`);
          const client = this.phoneClients.get(deviceId);
          if (client?.ws) {
            const howlerPcm = TtsAudioService.generateHowlerTone(8.0);
            serviceLinesService.startRawPcmPlaybackSession(deviceId, howlerPcm, client.ws);
          }
          this.sendToDevice(deviceId, { type: 'play_tone', tone: 'howler' });
        }
      }
    }, 30000);

    this.offHookInactivityTimers.set(deviceId, { stage1Timer: stage1, stage2Timer: stage2 });
  }

  public clearOffHookInactivityTimer(deviceId: string) {
    const timers = this.offHookInactivityTimers.get(deviceId);
    if (timers) {
      if (timers.stage1Timer) clearTimeout(timers.stage1Timer);
      if (timers.stage2Timer) clearTimeout(timers.stage2Timer);
      this.offHookInactivityTimers.delete(deviceId);
    }
  }

  // Register Web UI Client for live dashboard notifications & Softphone
  public registerWebClient(ws: WebSocket) {
    this.webClients.add(ws);
  }

  public unregisterWebClient(ws: WebSocket) {
    this.webClients.delete(ws);
  }

  public broadcastToWeb(payload: any) {
    const jsonStr = JSON.stringify(payload);
    for (const ws of this.webClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(jsonStr);
      }
    }
  }

  // DND Schedule Evaluation Engine with Manual Override Persistence
  public isDndActiveForUser(user: any): boolean {
    if (!user) return false;
    if (user.dnd_manual_state === 1 || user.call_privacy === 'dnd') {
      return true;
    }
    if (user.dnd_schedule_enabled === 1 && user.dnd_schedule_start && user.dnd_schedule_end) {
      const now = new Date();
      const currentDay = (now.getDay() === 0 ? 7 : now.getDay()).toString(); // 1 = Mon, 7 = Sun
      const days = (user.dnd_schedule_days || '1,2,3,4,5,6,7').split(',');

      if (days.includes(currentDay)) {
        const [startH, startM] = user.dnd_schedule_start.split(':').map(Number);
        const [endH, endM] = user.dnd_schedule_end.split(':').map(Number);

        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        let isInWindow = false;
        if (startMinutes < endMinutes) {
          // Same day window (e.g. 09:00 to 17:00)
          isInWindow = currentMinutes >= startMinutes && currentMinutes < endMinutes;
        } else {
          // Overnight window (e.g. 22:00 to 08:00)
          isInWindow = currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }

        if (isInWindow) {
          if (user.dnd_override_period === 'disabled') {
            return false; // User manually turned off DND during this schedule window
          }
          return true;
        }
      }
    }
    return false;
  }

  private async handleJsonMessage(
    ws: WebSocket,
    ip: string,
    msg: any,
    setRegisteredDeviceId: (id: string) => void
  ) {
    const { type, deviceId } = msg;

    // Web Softphone Handshake
    if (type === 'web_client_init') {
      const webDeviceId = msg.deviceId || `WEB-${msg.userId || 'CLIENT'}-${Math.floor(1000 + Math.random() * 9000)}`;
      setRegisteredDeviceId(webDeviceId);

      let user: any = null;
      if (msg.userId) {
        user = await queryOne<any>('SELECT id, username, display_name, phone_number FROM users WHERE id = ?', [msg.userId]);
      }

      const client: PhoneSocketClient = {
        ws,
        deviceId: webDeviceId,
        userId: user?.id || msg.userId,
        phoneNumber: user?.phone_number,
        ipAddress: ip,
        lastHeartbeat: Date.now()
      };

      this.phoneClients.set(webDeviceId, client);
      this.registerWebClient(ws);

      ws.send(JSON.stringify({
        type: 'web_client_ack',
        status: 'connected',
        deviceId: webDeviceId,
        phoneNumber: user?.phone_number
      }));
      return;
    }

    if (type === 'factory_reset' && deviceId) {
      console.log(`[Switch] 🔘 Factory Reset notification received for ${deviceId}. Unpairing device...`);
      await execute('UPDATE phones SET user_id = NULL, paired_at = NULL WHERE device_id = ?', [deviceId]);
      await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [deviceId]);
    }

    if (!deviceId) return;

    switch (type) {
      case 'register':
      case 'handshake': {
        const { mac, firmwareVersion, rssi, hardwareProfile, bellFrequencyHz, hookFlashEnabled, isReset } = msg;
        setRegisteredDeviceId(deviceId);

        if (isReset) {
          console.log(`[Switch] 🔘 Device ${deviceId} flagged as reset. Unpairing...`);
          await execute('UPDATE phones SET user_id = NULL, paired_at = NULL WHERE device_id = ?', [deviceId]);
          await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [deviceId]);
        }

        let phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
        if (!phone) {
          await execute(
            `INSERT INTO phones (device_id, mac_address, ip_address, firmware_version, rssi, hardware_profile, bell_frequency_hz, hook_flash_enabled, is_online, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
            [
              deviceId,
              mac || '',
              ip,
              firmwareVersion || '1.2.2',
              rssi || -52,
              hardwareProfile || 'western_electric_500',
              bellFrequencyHz || 20.0,
              hookFlashEnabled !== false ? 1 : 0
            ]
          );
          phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
        } else {
          await execute(
            `UPDATE phones SET is_online = 1, last_seen = CURRENT_TIMESTAMP, ip_address = ?, firmware_version = ?, rssi = ?, hardware_profile = ?, bell_frequency_hz = ? WHERE device_id = ?`,
            [ip, firmwareVersion || phone.firmware_version || '1.2.2', rssi || -52, hardwareProfile || phone.hardware_profile || 'western_electric_500', bellFrequencyHz || phone.bell_frequency_hz || 20.0, deviceId]
          );
        }

        let user: any = null;
        if (phone.user_id) {
          user = await queryOne<any>(
            `SELECT id, username, display_name, phone_number, call_privacy,
                    dnd_manual_state, dnd_schedule_enabled, dnd_schedule_start, dnd_schedule_end, dnd_schedule_days, dnd_override_period, dnd_repeated_call_breakthrough
             FROM users WHERE id = ?`,
            [phone.user_id]
          );
        }

        let pairingWord = '---';
        let pairingCode = '---';
        let fullPairingCode = '---';

        // If phone is unclaimed, generate or retrieve pending Word + 4-digit code
        if (!phone.user_id) {
          let pending = await queryOne<any>(
            'SELECT * FROM pending_device_enrollments WHERE device_id = ? AND expires_at > datetime("now")',
            [deviceId]
          );

          if (!pending) {
            const WORDS = ['TONE', 'BELL', 'RING', 'DIAL', 'ECHO', 'WIRE', 'POST', 'HOOK', 'ROTR', 'DESK', 'CALL', 'PULSE', 'LINE', 'SWCH'];
            pairingWord = WORDS[Math.floor(Math.random() * WORDS.length)];
            pairingCode = Math.floor(1000 + Math.random() * 9000).toString();
            fullPairingCode = `${pairingWord}-${pairingCode}`;

            await execute(
              `INSERT OR REPLACE INTO pending_device_enrollments (device_id, ip_address, pairing_code_word, pairing_code_numeric, pairing_code, expires_at)
               VALUES (?, ?, ?, ?, ?, datetime('now', '+24 hours'))`,
              [deviceId, ip, pairingWord, pairingCode, fullPairingCode]
            );
          } else {
            pairingWord = pending.pairing_code_word;
            pairingCode = pending.pairing_code_numeric;
            fullPairingCode = pending.pairing_code || `${pairingWord}-${pairingCode}`;
          }

          ws.send(JSON.stringify({
            type: 'pairing_info',
            word: pairingWord,
            code: pairingCode,
            fullCode: fullPairingCode
          }));
        }

        const client: PhoneSocketClient = {
          ws,
          deviceId,
          userId: user?.id,
          phoneNumber: user?.phone_number,
          ipAddress: ip,
          lastHeartbeat: Date.now()
        };

        this.phoneClients.set(deviceId, client);

        ws.send(
          JSON.stringify({
            type: 'register_ack',
            status: 'registered',
            deviceId,
            isPaired: !!phone.user_id,
            ownerUsername: user?.username || null,
            phoneNumber: user?.phone_number || null,
            pairingWord,
            pairingCode,
            fullPairingCode,
            earpieceVolume: phone.earpiece_volume ?? 80,
            micSensitivity: phone.mic_sensitivity ?? 80,
            audioProfile: phone.audio_profile || 'vintage_pots',
            sidetoneLevel: phone.sidetone_level ?? 10,
            ringStyle: phone.ring_style || 'traditional',
            ringCadence: phone.ring_cadence_custom || '2000,4000',
            bellFrequencyHz: phone.bell_frequency_hz ?? 20.0,
            hardwareProfile: phone.hardware_profile || 'western_electric_500',
            intercomEnabled: phone.intercom_enabled !== 0
          })
        );

        this.broadcastToWeb({
          type: 'phone_status_change',
          deviceId,
          isOnline: true,
          isPaired: !!phone.user_id,
          ownerUsername: user?.username || null,
          phoneNumber: user?.phone_number || null,
          pairingWord,
          pairingCode,
          fullPairingCode,
          hardwareProfile: phone.hardware_profile,
          bellFrequencyHz: phone.bell_frequency_hz
        });

        homeAssistantMqttService.registerPhoneDiscovery(phone, user).catch(e => console.error(e));
        console.log(`[Switch] Telephone registered: ${deviceId} (${ip}) - Paired: ${!!phone.user_id} - Bell: ${phone.bell_frequency_hz || 20}Hz`);
        break;
      }

      case 'heartbeat': {
        const client = this.phoneClients.get(deviceId);
        if (client) {
          client.lastHeartbeat = Date.now();
        }
        await execute(
          'UPDATE phones SET is_online = 1, last_seen = CURRENT_TIMESTAMP, rssi = ? WHERE device_id = ?',
          [msg.rssi || 0, deviceId]
        );
        ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
        break;
      }

      case 'hook_state': {
        const { state } = msg; // 'off_hook' or 'on_hook'
        await this.handleHookStateChange(deviceId, state);
        break;
      }

      case 'dial_digit': {
        const { digit, pps, breakRatio, pulseCount, pulseDurationsMs } = msg;
        await this.handleDialDigit(deviceId, digit.toString(), { pps, breakRatio, pulseCount, pulseDurationsMs });
        break;
      }

      case 'call_answer': {
        await this.handleCallAnswer(deviceId, msg.callId);
        break;
      }

      case 'call_hangup': {
        await this.handleCallHangup(deviceId);
        break;
      }
    }
  }

  private async handleHookStateChange(deviceId: string, state: 'off_hook' | 'on_hook') {
    const client = this.phoneClients.get(deviceId);
    await execute('UPDATE phones SET hook_state = ? WHERE device_id = ?', [state, deviceId]);

    this.broadcastToWeb({
      type: 'phone_hook_change',
      deviceId,
      userId: client?.userId,
      hookState: state
    });

    homeAssistantMqttService.publishHookState(deviceId, state === 'off_hook');

    if (state === 'off_hook') {
      if (serviceLinesService.isLoopbackActive(deviceId)) {
        serviceLinesService.endLoopbackSession(deviceId);
      }
      serviceLinesService.cancelRingbackTest(deviceId);

      // Check 1: Resuming a Parked Call on this user's account
      const parkedCall = this.findParkedCallForUser(client?.userId);
      if (parkedCall) {
        console.log(`[Switch] 🅿️ Resuming parked call on device ${deviceId} for user ${client?.userId}`);
        await this.resumeParkedCall(parkedCall, deviceId);
        return;
      }

      // Check 2: Party-Line Auto-Join (Another phone on this account is in an active connected call)
      const existingCall = this.findActiveConnectedCallForUser(client?.userId, deviceId);
      if (existingCall) {
        console.log(`[Switch] 👥 Party-Line auto-join on device ${deviceId} into call ${existingCall.id}`);
        await this.joinPartyLineCall(existingCall, deviceId);
        return;
      }

      // Check 3: Answering an active incoming call ringing for this device or user
      const incomingCall = this.findRingingCallForUserOrDevice(deviceId, client?.userId);
      if (incomingCall && incomingCall.state === 'ringing') {
        await this.connectCall(incomingCall, deviceId);
        return;
      }

      // Check 4: Live Voicemail Screening!
      if (client?.userId && this.activeVoicemailSessions.has(client.userId)) {
        const vmSession = this.activeVoicemailSessions.get(client.userId)!;
        vmSession.calleeScreeningDeviceId = deviceId;

        this.sendToDevice(deviceId, {
          type: 'start_screening',
          callerNumber: vmSession.callerNumber,
          callerName: vmSession.callerName,
          promptText: 'Screening live voicemail. Dial 1 to connect call.'
        });

        // Set dial buffer for digit 1 intercept
        this.dialedBuffers.set(deviceId, { buffer: '' });
        await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['screening', deviceId]);
        console.log(`[Switch] 🎧 Live Voicemail Screening started for user ${client.userId} on device ${deviceId}`);
        return;
      }

      // Otherwise, user picked up handset to initiate a call -> Evaluate Dial Tone indicators
      this.dialedBuffers.set(deviceId, { buffer: '' });

      let toneType = 'dial';
      if (client?.userId) {
        const user = await queryOne<any>(
          `SELECT id, dnd_manual_state, dnd_schedule_enabled, dnd_schedule_start, dnd_schedule_end, dnd_schedule_days, dnd_override_period, call_privacy
           FROM users WHERE id = ?`,
          [client.userId]
        );

        const vmCount = await queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM voicemails WHERE user_id = ? AND is_read = 0',
          [client.userId]
        );

        const hasUnreadVm = (vmCount?.count || 0) > 0;
        const isDnd = this.isDndActiveForUser(user);

        if (hasUnreadVm && isDnd) {
          toneType = 'stutter_dnd';
        } else if (hasUnreadVm) {
          toneType = 'stutter_dial';
        } else if (isDnd) {
          toneType = 'dnd_dial';
        }
      }

      this.sendToDevice(deviceId, { type: 'play_tone', tone: toneType });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['dialing', deviceId]);
      this.startOffHookInactivityTimer(deviceId);
    } else {
      // Handset placed on hook -> check ringback line test or terminate active calls
      this.clearOffHookInactivityTimer(deviceId);

      // Check if this device just hung up to execute Ringback Line Test
      serviceLinesService.handleRingbackOnHook(deviceId, (dId, uId) => this.executeRingbackTest(dId, uId));

      if (serviceLinesService.isLoopbackActive(deviceId)) {
        serviceLinesService.endLoopbackSession(deviceId);
      }
      const waiting = this.waitingCalls.get(deviceId);
      if (waiting) {
        if (waiting.ringTimeoutTimer) clearTimeout(waiting.ringTimeoutTimer);
        this.waitingCalls.delete(deviceId);
      }

      const inviteState = this.inCallInviteStates.get(deviceId);
      if (inviteState) {
        if (inviteState.interdigitTimer) clearTimeout(inviteState.interdigitTimer);
        this.inCallInviteStates.delete(deviceId);
      }

      // Clear direct voicemail timer if pending
      const vmTimer = this.directVmTimers.get(deviceId);
      if (vmTimer) {
        clearTimeout(vmTimer);
        this.directVmTimers.delete(deviceId);
      }

      this.clearDialBuffer(deviceId);
      this.sendToDevice(deviceId, { type: 'stop_tone' });
      this.sendToDevice(deviceId, { type: 'stop_ring' });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', deviceId]);

      // If screening, stop screening
      for (const [, vmCall] of this.activeVoicemailSessions) {
        if (vmCall.calleeScreeningDeviceId === deviceId) {
          vmCall.calleeScreeningDeviceId = undefined;
        }
      }

      // If in an active call, check if call is parked
      const activeCall = this.findCallByDevice(deviceId);
      if (activeCall) {
        if (activeCall.state === 'parked') {
          console.log(`[Switch] 🅿️ Handset ${deviceId} placed on hook while call ${activeCall.id} remains parked.`);
        } else {
          await this.terminateCall(activeCall.id, 'hangup', deviceId);
        }
      }
    }
  }

  private async handleDialDigit(
    deviceId: string,
    digit: string,
    diagnostics?: { pps?: number; breakRatio?: number; pulseCount?: number; pulseDurationsMs?: number[] }
  ) {
    const client = this.phoneClients.get(deviceId);
    if (!client) return;

    // Clear off-hook inactivity timer as soon as user begins dialing
    this.clearOffHookInactivityTimer(deviceId);

    // Stop dial tone as soon as user starts dialing
    this.sendToDevice(deviceId, { type: 'stop_tone' });

    // 1. Check Call Waiting Intercept (0 to Reject -> Voicemail, 1 to Accept & End Current)
    const waiting = this.waitingCalls.get(deviceId);
    if (waiting) {
      if (digit === '0') {
        if (waiting.ringTimeoutTimer) clearTimeout(waiting.ringTimeoutTimer);
        this.waitingCalls.delete(deviceId);
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'beep' });
        await this.routeToVoicemail(waiting.callerDeviceId, waiting.callerUserId, waiting.callerNumber, waiting.callerName, waiting.calleeUser);
        console.log(`[Switch] Call waiting rejected by ${deviceId}, routed to voicemail.`);
        return;
      } else if (digit === '1') {
        if (waiting.ringTimeoutTimer) clearTimeout(waiting.ringTimeoutTimer);
        this.waitingCalls.delete(deviceId);
        const currentCall = this.findCallByDevice(deviceId);
        if (currentCall) {
          await this.terminateCall(currentCall.id, 'swapped');
        }
        await this.initiateCall(waiting.callerDeviceId, waiting.calleeUser.phone_number);
        console.log(`[Switch] Call waiting accepted by ${deviceId}, previous call ended.`);
        return;
      }
    }

    // 2. Check Live Voicemail Screening Intercept (Digit '1' to intercept and take call live)
    for (const [calleeUserId, vmCall] of this.activeVoicemailSessions) {
      if (vmCall.calleeScreeningDeviceId === deviceId) {
        if (digit === '1') {
          console.log(`[Switch] ⚡ Live Screening Intercepted! Converting voicemail to live 2-way call.`);
          this.activeVoicemailSessions.delete(calleeUserId);
          vmCall.calleeScreeningDeviceId = undefined;

          // Save whatever partial audio was recorded so far as completed voicemail
          if (vmCall.voicemailChunks && vmCall.voicemailChunks.length > 0) {
            const audioData = Buffer.concat(vmCall.voicemailChunks);
            const durationSec = Math.round(audioData.length / 32000);
            await execute(
              `INSERT INTO voicemails (user_id, caller_user_id, caller_number, audio_url, duration_sec, is_read)
               VALUES (?, ?, ?, ?, ?, 0)`,
              [calleeUserId, vmCall.callerUserId, vmCall.callerNumber, `data:audio/pcm;base64,${audioData.toString('base64')}`, durationSec]
            );
          }

          // Transition to connected two-way call
          vmCall.state = 'connected';
          vmCall.calleeDeviceId = deviceId;
          vmCall.connectedAt = Date.now();

          this.sendToDevice(vmCall.callerDeviceId, {
            type: 'call_connected',
            calleeNumber: vmCall.calleeNumber,
            calleeName: vmCall.calleeName,
            sessionKey: vmCall.sessionKey
          });

          this.sendToDevice(deviceId, {
            type: 'call_connected',
            callerNumber: vmCall.callerNumber,
            callerName: vmCall.callerName,
            sessionKey: vmCall.sessionKey
          });

          await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', deviceId]);
          return;
        }
      }
    }

    // 3. Check Active In-Call Controls (Digits 2 for Mute, 3 for Group Invite, 8 for Park/Hold)
    const activeCall = this.findCallByDevice(deviceId);
    if (activeCall && activeCall.state === 'connected') {
      // In-Call Invite State (Dialing target extension after pressing 3)
      const inviteState = this.inCallInviteStates.get(deviceId);
      if (inviteState) {
        inviteState.buffer += digit;
        if (inviteState.interdigitTimer) clearTimeout(inviteState.interdigitTimer);

        // Check if full extension dialed or wait 2.0s
        inviteState.interdigitTimer = setTimeout(() => {
          this.executeInCallGroupInvite(deviceId, inviteState.callId, inviteState.buffer);
          this.inCallInviteStates.delete(deviceId);
        }, 2000);
        return;
      }

      if (digit === '2') {
        // Toggle Mic Mute / Unmute
        if (!activeCall.mutedDevices) activeCall.mutedDevices = new Set();
        const isMuted = !activeCall.mutedDevices.has(deviceId);
        if (isMuted) {
          activeCall.mutedDevices.add(deviceId);
        } else {
          activeCall.mutedDevices.delete(deviceId);
        }
        this.sendToDevice(deviceId, { type: 'mic_mute_state', isMuted });
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'chirp' });
        console.log(`[Switch] Handset Mic on ${deviceId} ${isMuted ? 'MUTED' : 'UNMUTED'}`);
        return;
      }

      if (digit === '3') {
        // Begin Multi-Party Group Expansion
        if (activeCall.participants && activeCall.participants.size >= 5) {
          console.log(`[Switch] Cannot add participant: Maximum 5 callers reached.`);
          this.sendToDevice(deviceId, { type: 'play_tone', tone: 'busy' });
          return;
        }
        this.inCallInviteStates.set(deviceId, {
          callId: activeCall.id,
          inviterDeviceId: deviceId,
          buffer: ''
        });
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'whisper_dial' });
        console.log(`[Switch] 👥 In-Call Group Invite mode started by ${deviceId}. Waiting for extension.`);
        return;
      }

      if (digit === '8') {
        // Single-Digit In-Call Code 8: Call Park / Hold!
        await this.parkCall(activeCall, deviceId);
        return;
      }

      return;
    }

    // 4. Normal Outbound Dialing from Idle State
    let dialObj = this.dialedBuffers.get(deviceId);
    if (!dialObj) {
      dialObj = { buffer: '' };
      this.dialedBuffers.set(deviceId, dialObj);
    }

    dialObj.buffer += digit;
    const currentBuffer = dialObj.buffer;

    this.broadcastToWeb({
      type: 'phone_dialing_digit',
      deviceId,
      userId: client.userId,
      digit,
      currentBuffer,
      diagnostics
    });

    homeAssistantMqttService.publishLastDialed(deviceId, currentBuffer);

    if (dialObj.timer) clearTimeout(dialObj.timer);

    // Direct Voicemail & Prefix Debouncing:
    // If dialed exactly '0', wait 2.0 seconds before routing to own inbox. If user continues dialing, route to direct voicemail!
    if (currentBuffer === '0') {
      const vmTimer = setTimeout(async () => {
        if (this.dialedBuffers.get(deviceId)?.buffer === '0') {
          this.clearDialBuffer(deviceId);
          if (client.userId) {
            console.log(`[Switch] User on ${deviceId} dialed '0' alone -> opening Voicemail Inbox`);
            await this.startVoicemailPlaybackSession(deviceId, client.userId);
          }
        }
      }, 2000);
      this.directVmTimers.set(deviceId, vmTimer);
      return;
    } else {
      const pendingVm = this.directVmTimers.get(deviceId);
      if (pendingVm) {
        clearTimeout(pendingVm);
        this.directVmTimers.delete(deviceId);
      }
    }

    // If starts with '0' and length > 1, check direct-to-voicemail memo
    if (currentBuffer.startsWith('0') && !['069', '072', '073', '078', '079', '00'].some(p => currentBuffer.startsWith(p))) {
      dialObj.timer = setTimeout(async () => {
        const targetExt = currentBuffer.substring(1);
        this.clearDialBuffer(deviceId);
        console.log(`[Switch] 🎙️ Direct-to-Voicemail Memo to extension ${targetExt} by ${deviceId}`);
        const targetUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [targetExt]);
        if (targetUser) {
          const callerUser = client.userId ? await queryOne<any>('SELECT * FROM users WHERE id = ?', [client.userId]) : null;
          await this.routeToVoicemail(
            deviceId,
            callerUser?.id,
            callerUser?.phone_number || 'Unknown',
            callerUser?.display_name || callerUser?.username || 'Caller',
            targetUser
          );
        } else {
          this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
        }
      }, 2000);
      return;
    }

    // Check Phone Control Codes: 078 (Toggle DND), 079 (DND Status)
    if (currentBuffer === '078') {
      dialObj.timer = setTimeout(async () => {
        if (this.dialedBuffers.get(deviceId)?.buffer === '078' && client.userId) {
          this.clearDialBuffer(deviceId);
          const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [client.userId]);
          const newDnd = user.dnd_manual_state === 1 ? 0 : 1;
          const overridePeriod = newDnd === 0 ? 'disabled' : null;
          await execute('UPDATE users SET dnd_manual_state = ?, dnd_override_period = ? WHERE id = ?', [newDnd, overridePeriod, client.userId]);

          const speech = TtsAudioService.synthesizeSpeech(newDnd === 1 ? 'Do not disturb is now enabled' : 'Do not disturb is now disabled');
          if (client.ws) serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
          console.log(`[Switch] DND state for user ${client.userId} toggled to ${newDnd === 1 ? 'ENABLED' : 'DISABLED'}`);
        }
      }, 1800);
      return;
    }

    if (currentBuffer === '079') {
      dialObj.timer = setTimeout(async () => {
        if (this.dialedBuffers.get(deviceId)?.buffer === '079' && client.userId) {
          this.clearDialBuffer(deviceId);
          const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [client.userId]);
          const isActive = this.isDndActiveForUser(user);
          const speech = TtsAudioService.synthesizeSpeech(isActive ? 'Do not disturb is currently active' : 'Do not disturb is currently off');
          if (client.ws) serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
        }
      }, 1800);
      return;
    }

    // General inter-digit delay before executing call / service lines
    dialObj.timer = setTimeout(async () => {
      await this.processCompletedDialBuffer(deviceId, currentBuffer);
    }, 2500);
  }

  private async processCompletedDialBuffer(deviceId: string, buffer: string) {
    const client = this.phoneClients.get(deviceId);
    this.clearDialBuffer(deviceId);

    // 1. Service lines
    if (buffer === '111') {
      // 111: Ringback Line Test
      if (client?.ws) {
        client.ws.send(JSON.stringify({
          type: 'call_connected',
          callId: `SVC-111-${Date.now()}`,
          calleeNumber: '111',
          calleeName: 'Ringback Test Service'
        }));
        await serviceLinesService.startRingbackTestSession(deviceId, client.userId, client.ws);
      }
      return;
    }
    if (buffer === '119' || buffer === '099') {
      // 119: Sidetone & Loopback Echo Test
      if (client?.ws) {
        client.ws.send(JSON.stringify({
          type: 'call_connected',
          callId: `SVC-119-${Date.now()}`,
          calleeNumber: '119',
          calleeName: 'Audio Loopback Echo Test'
        }));
        await serviceLinesService.startLoopbackSession(deviceId, client.ws);
      }
      return;
    }
    if (buffer === '411') {
      // 411: Speaking Clock
      if (client?.ws) {
        client.ws.send(JSON.stringify({
          type: 'call_connected',
          callId: `SVC-411-${Date.now()}`,
          calleeNumber: '411',
          calleeName: 'Speaking Clock Service'
        }));
        await serviceLinesService.startSpeakingClockSession(deviceId, client.ws);
        client.ws.send(JSON.stringify({
          type: 'call_ended',
          reason: 'service_completed'
        }));
      }
      return;
    }
    if (buffer === '567' || buffer === '300') {
      // 567: Dial-Up Modem Handshake Simulator
      if (client?.ws) {
        client.ws.send(JSON.stringify({
          type: 'call_connected',
          callId: `SVC-567-${Date.now()}`,
          calleeNumber: '567',
          calleeName: 'Dial-Up Modem Simulator'
        }));
        await serviceLinesService.startModemHandshakeSession(deviceId, client.ws);
        client.ws.send(JSON.stringify({
          type: 'call_ended',
          reason: 'service_completed'
        }));
      }
      return;
    }
    if (buffer === '711') {
      // 711: Local Weather Forecast
      if (client?.ws) {
        client.ws.send(JSON.stringify({
          type: 'call_connected',
          callId: `SVC-711-${Date.now()}`,
          calleeNumber: '711',
          calleeName: 'Automated Weather Hotline'
        }));
        await serviceLinesService.startWeatherSession(deviceId, client?.ipAddress, client.ws);
        client.ws.send(JSON.stringify({
          type: 'call_ended',
          reason: 'service_completed'
        }));
      }
      return;
    }
    if (buffer === '069' && client?.userId) {
      // 069: Call Return
      const lastCall = await queryOne<any>(
        'SELECT caller_number FROM calls WHERE callee_user_id = ? ORDER BY id DESC LIMIT 1',
        [client.userId]
      );
      if (lastCall?.caller_number) {
        await this.initiateCall(deviceId, lastCall.caller_number);
      } else {
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
      }
      return;
    }

    // 2. Outbound User Extension Call
    await this.initiateCall(deviceId, buffer);
  }

  // Execute in-call multi-party invite (Digit 3 + Extension)
  private async executeInCallGroupInvite(inviterDeviceId: string, callId: string, targetExtension: string) {
    const call = this.activeCalls.get(callId);
    if (!call || call.state !== 'connected') return;

    const inviterClient = this.phoneClients.get(inviterDeviceId);
    if (!inviterClient?.userId) return;

    const targetUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [targetExtension.trim()]);
    if (!targetUser) {
      console.log(`[Switch] In-call invite failed: Extension ${targetExtension} not found`);
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    // Friend check: ONLY the person who dialed 3 needs to be friends with the invited caller!
    const friendship = await queryOne<any>(
      `SELECT id, is_vip, ring_style, ring_cadence_custom FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
      [inviterClient.userId, targetUser.id, targetUser.id, inviterClient.userId]
    );

    if (!friendship && targetUser.call_privacy === 'friends_only') {
      console.log(`[Switch] In-call invite rejected: Inviter is not friends with ${targetUser.username}`);
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    const targetPhones = await query<any>('SELECT * FROM phones WHERE user_id = ? AND is_online = 1', [targetUser.id]);
    const ringingTarget = targetPhones.find(p => p.ring_enabled !== 0) || targetPhones[0];

    if (!ringingTarget) {
      console.log(`[Switch] In-call invite failed: Target ${targetUser.username} is offline`);
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    // Setup multi-party participant tracking
    call.isGroupCall = true;
    if (!call.participants) {
      call.participants = new Set([call.callerDeviceId, call.calleeDeviceId]);
    }
    call.participants.add(ringingTarget.device_id);

    const ringStyle = friendship?.ring_style && friendship.ring_style !== 'default' ? friendship.ring_style : (ringingTarget.ring_style || 'traditional');
    const ringCadence = friendship?.ring_cadence_custom || ringingTarget.ring_cadence_custom || '2000,4000';

    this.sendToDevice(ringingTarget.device_id, {
      type: 'incoming_call',
      callerNumber: call.callerNumber,
      callerName: `${call.callerName} (Group Call)`,
      ringStyle,
      ringCadence,
      bellFrequencyHz: ringingTarget.bell_frequency_hz ?? 20.0
    });

    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', ringingTarget.device_id]);
    console.log(`[Switch] 👥 Group invite ringing on ${ringingTarget.device_id} for user ${targetUser.username}`);
  }

  // Initiate Outbound Call
  public async initiateCall(callerDeviceId: string, destinationNumber: string) {
    const callerClient = this.phoneClients.get(callerDeviceId);
    const dest = destinationNumber.trim();

    if (!dest) {
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    // Look up caller user
    const callerUser = callerClient?.userId ? await queryOne<any>('SELECT * FROM users WHERE id = ?', [callerClient.userId]) : null;

    // Direct dialing own number -> route directly to Voicemail Inbox
    if (callerUser && callerUser.phone_number === dest) {
      console.log(`[Switch] User on ${callerDeviceId} dialed own number -> Voicemail Inbox`);
      await this.startVoicemailPlaybackSession(callerDeviceId, callerUser.id);
      return;
    }

    // Look up destination user by extension
    const calleeUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [dest]);
    if (!calleeUser) {
      console.log(`[Switch] Call failed: Extension ${dest} not found.`);
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    if (calleeUser.is_disabled) {
      console.log(`[Switch] Destination account ${dest} is disabled.`);
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    // Check Friendship & VIP status
    const friendship = callerUser
      ? await queryOne<any>(
          `SELECT id, is_vip, ring_style, ring_cadence_custom FROM friends
           WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
          [calleeUser.id, callerUser.id, callerUser.id, calleeUser.id]
        )
      : null;

    const isFriend = !!friendship;
    const isVip = friendship?.is_vip === 1;

    // Call Privacy check: Friends only
    if (calleeUser.call_privacy === 'friends_only' && !isFriend) {
      console.log(`[Switch] Callee only accepts calls from friends. Routing caller to voicemail.`);
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerUser?.phone_number || 'Unknown', callerUser?.display_name || 'Caller', calleeUser);
      return;
    }

    // DND check: VIP bypasses DND & Repeated Call Breakthrough
    const isDnd = this.isDndActiveForUser(calleeUser);
    if (isDnd && !isVip) {
      const allowsBreakthrough = calleeUser.dnd_repeated_call_breakthrough !== 0;
      const attemptKey = `${calleeUser.id}_${callerUser?.phone_number || callerDeviceId}`;
      const lastAttempt = this.recentDndAttempts.get(attemptKey);
      const now = Date.now();

      if (allowsBreakthrough && lastAttempt && (now - lastAttempt) < 180000) {
        console.log(`[Switch] 🚨 DND Breakthrough! Repeated call from ${callerUser?.phone_number || 'Caller'} within 3 minutes bypassed DND for ${calleeUser.username}.`);
        this.recentDndAttempts.delete(attemptKey);
        // Continue past DND check to ring the bells
      } else {
        if (allowsBreakthrough) {
          this.recentDndAttempts.set(attemptKey, now);
        }
        console.log(`[Switch] Callee is in Do Not Disturb and caller is not VIP. Routing silently to voicemail.`);
        await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerUser?.phone_number || 'Unknown', callerUser?.display_name || 'Caller', calleeUser);
        return;
      }
    }

    // Find all callee hardware phones
    const calleePhones = await query<any>('SELECT * FROM phones WHERE user_id = ? AND is_online = 1', [calleeUser.id]);

    if (calleePhones.length === 0) {
      console.log(`[Switch] Callee has no online phones -> routing to voicemail`);
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerUser?.phone_number || 'Unknown', callerUser?.display_name || 'Caller', calleeUser);
      return;
    }

    // Filter ringing phones by ring_enabled toggle
    const enabledPhones = calleePhones.filter(p => p.ring_enabled !== 0);
    const phonesToRing = enabledPhones.length > 0 ? enabledPhones : calleePhones;
    const primaryPhone = phonesToRing[0];

    // Call Waiting Check: if primary is on another call, send call waiting
    if (primaryPhone.call_state === 'connected') {
      console.log(`[Switch] Callee is on another call. Sending in-ear call waiting tone.`);
      this.sendToDevice(primaryPhone.device_id, { type: 'play_tone', tone: 'call_waiting' });
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'ringback' });

      const ringTimeoutSec = primaryPhone.ring_timeout_sec || 25;
      const ringTimer = setTimeout(async () => {
        if (this.waitingCalls.has(primaryPhone.device_id)) {
          this.waitingCalls.delete(primaryPhone.device_id);
          await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerUser?.phone_number || 'Unknown', callerUser?.display_name || 'Caller', calleeUser);
        }
      }, ringTimeoutSec * 1000);

      this.waitingCalls.set(primaryPhone.device_id, {
        callerDeviceId,
        callerUserId: callerUser?.id,
        callerNumber: callerUser?.phone_number || 'Unknown',
        callerName: callerUser?.display_name || callerUser?.username || 'Caller',
        calleeUser,
        ringTimeoutTimer: ringTimer
      });
      return;
    }

    // Create Active Call Session
    const callId = crypto.randomUUID();
    const sessionKey = crypto.randomBytes(16).toString('hex');

    const ringStyle = friendship?.ring_style && friendship.ring_style !== 'default' ? friendship.ring_style : (primaryPhone.ring_style || 'traditional');
    const ringCadence = friendship?.ring_cadence_custom || primaryPhone.ring_cadence_custom || '2000,4000';

    const newCall: ActiveCall = {
      id: callId,
      callerDeviceId,
      callerUserId: callerUser?.id,
      callerNumber: callerUser?.phone_number || 'Unknown',
      callerName: callerUser?.display_name || callerUser?.username || 'Caller',
      calleeDeviceId: primaryPhone.device_id,
      calleeUserId: calleeUser.id,
      calleeNumber: calleeUser.phone_number,
      calleeName: calleeUser.display_name || calleeUser.username,
      sessionKey,
      state: 'ringing',
      startedAt: Date.now(),
      ringingDevices: new Set(phonesToRing.map(p => p.device_id))
    };

    const ringTimeoutSec = primaryPhone.ring_timeout_sec || 25;
    newCall.ringTimeoutTimer = setTimeout(async () => {
      await this.terminateCall(callId, 'timeout', undefined, true);
    }, ringTimeoutSec * 1000);

    this.activeCalls.set(callId, newCall);

    // Ring all enabled phones on the callee's account
    for (const p of phonesToRing) {
      this.sendToDevice(p.device_id, {
        type: 'incoming_call',
        callerNumber: newCall.callerNumber,
        callerName: newCall.callerName,
        ringStyle: p.ring_style || ringStyle,
        ringCadence: p.ring_cadence_custom || ringCadence,
        bellFrequencyHz: p.bell_frequency_hz ?? 20.0
      });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', p.device_id]);
    }

    // Broadcast incoming call event to web clients
    this.broadcastToWeb({
      type: 'incoming_call',
      callId,
      calleeUserId: calleeUser.id,
      callerNumber: newCall.callerNumber,
      callerName: newCall.callerName
    });

    this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'ringback' });
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['dialing', callerDeviceId]);
  }

  // Answer Incoming Call
  public async handleCallAnswer(deviceId: string, callId?: string) {
    let call: ActiveCall | undefined;
    if (callId) {
      call = this.activeCalls.get(callId);
    }
    if (!call) {
      call = this.findCallByCalleeDevice(deviceId);
    }
    if (!call) {
      const client = this.phoneClients.get(deviceId);
      if (client?.userId) {
        call = this.findRingingCallForUserOrDevice(deviceId, client.userId);
      }
    }

    if (call && call.state === 'ringing') {
      await this.connectCall(call, deviceId);
    }
  }

  // Connect Call & Start Audio
  public async connectCall(call: ActiveCall, answeringDeviceId?: string) {
    if (call.ringTimeoutTimer) {
      clearTimeout(call.ringTimeoutTimer);
      call.ringTimeoutTimer = undefined;
    }

    if (answeringDeviceId) {
      call.calleeDeviceId = answeringDeviceId;
    }

    call.state = 'connected';
    call.connectedAt = Date.now();

    this.sendToDevice(call.callerDeviceId, { type: 'stop_tone' });

    // Stop ring on all ringing devices for this call
    if (call.ringingDevices) {
      for (const devId of call.ringingDevices) {
        this.sendToDevice(devId, { type: 'stop_ring' });
        if (devId !== call.calleeDeviceId) {
          await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', devId]);
        }
      }
    } else if (call.calleeDeviceId) {
      this.sendToDevice(call.calleeDeviceId, { type: 'stop_ring' });
    }

    this.sendToDevice(call.callerDeviceId, {
      type: 'call_connected',
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName,
      sessionKey: call.sessionKey
    });

    if (call.calleeDeviceId) {
      this.sendToDevice(call.calleeDeviceId, {
        type: 'call_connected',
        callerNumber: call.callerNumber,
        callerName: call.callerName,
        sessionKey: call.sessionKey
      });
    }

    this.broadcastToWeb({
      type: 'call_state_change',
      callId: call.id,
      state: 'connected',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName
    });

    await execute('UPDATE phones SET call_state = ? WHERE device_id IN (?, ?)', ['connected', call.callerDeviceId, call.calleeDeviceId]);

    await execute(
      `INSERT INTO calls (caller_user_id, callee_user_id, caller_number, callee_number, status, started_at)
       VALUES (?, ?, ?, ?, 'connected', CURRENT_TIMESTAMP)`,
      [call.callerUserId, call.calleeUserId, call.callerNumber, call.calleeNumber]
    );

    console.log(`[Switch] 📞 Call ${call.id} CONNECTED between ${call.callerNumber} and ${call.calleeNumber} (Answered by ${call.calleeDeviceId})`);
  }

  // Route to Voicemail
  public async routeToVoicemail(
    callerDeviceId: string,
    callerUserId: number | undefined,
    callerNumber: string,
    callerName: string,
    calleeUser: any
  ) {
    const callId = crypto.randomUUID();

    const greeting = await queryOne<any>('SELECT audio_url FROM voicemail_greetings WHERE user_id = ?', [calleeUser.id]);
    const greetingUrl = greeting?.audio_url || '/assets/sounds/default_greeting.wav';

    const vmCall: ActiveCall = {
      id: callId,
      callerDeviceId,
      callerUserId,
      callerNumber,
      callerName,
      calleeDeviceId: '',
      calleeUserId: calleeUser.id,
      calleeNumber: calleeUser.phone_number,
      calleeName: calleeUser.display_name || calleeUser.username,
      sessionKey: '',
      state: 'voicemail',
      startedAt: Date.now(),
      voicemailChunks: []
    };

    this.activeCalls.set(callId, vmCall);
    this.activeVoicemailSessions.set(calleeUser.id, vmCall);

    this.sendToDevice(callerDeviceId, {
      type: 'play_voicemail_greeting',
      callId,
      greetingUrl,
      promptBeep: true,
      maxDurationSec: 300 // 5-minute max length
    });

    // 5-minute maximum recording timeout
    vmCall.ringTimeoutTimer = setTimeout(async () => {
      await this.terminateCall(callId, 'voicemail_max_timeout');
    }, 300000);

    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', callerDeviceId]);

    this.broadcastToWeb({
      type: 'voicemail_recording_started',
      callId,
      callerNumber,
      calleeNumber: calleeUser.phone_number
    });
  }

  // Interactive Voicemail Playback
  public async startVoicemailPlaybackSession(deviceId: string, userId: number) {
    const client = this.phoneClients.get(deviceId);
    const voicemails = await query<any>(
      'SELECT id, caller_number, audio_url, duration_sec, created_at FROM voicemails WHERE user_id = ? ORDER BY id DESC LIMIT 5',
      [userId]
    );

    if (voicemails.length === 0) {
      const speech = TtsAudioService.synthesizeSpeech('You have no messages in your voicemail inbox.');
      if (client?.ws) serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
      return;
    }

    // Synthesize full audio mailbox playlist
    const audioParts: Buffer[] = [];
    const countText = `You have ${voicemails.length} ${voicemails.length === 1 ? 'message' : 'messages'} in your voicemail inbox.`;
    audioParts.push(TtsAudioService.synthesizeSpeech(countText));
    audioParts.push(Buffer.alloc(TtsAudioService.SAMPLE_RATE * 0.8 * 2)); // 800ms silence

    for (let i = 0; i < voicemails.length; i++) {
      const vm = voicemails[i];
      const callerText = `Message ${i + 1} from extension ${vm.caller_number}.`;
      audioParts.push(TtsAudioService.synthesizeSpeech(callerText));
      audioParts.push(TtsAudioService.generateSineTone(800, 200, 0.4)); // In-ear pip tone
      audioParts.push(Buffer.alloc(TtsAudioService.SAMPLE_RATE * 0.4 * 2));

      if (vm.audio_url && vm.audio_url.startsWith('data:audio/pcm;base64,')) {
        const pcm = Buffer.from(vm.audio_url.replace('data:audio/pcm;base64,', ''), 'base64');
        audioParts.push(pcm);
      }
      audioParts.push(Buffer.alloc(TtsAudioService.SAMPLE_RATE * 1.0 * 2));
    }

    audioParts.push(TtsAudioService.synthesizeSpeech('End of messages.'));
    const fullMailboxAudio = Buffer.concat(audioParts);
    if (client?.ws) {
      serviceLinesService.startRawPcmPlaybackSession(deviceId, fullMailboxAudio, client.ws);
    }
  }

  // Terminate Call
  public async terminateCall(callId: string, reason: string, hangingUpDeviceId?: string, routeVoicemailOnTimeout = false) {
    const call = this.activeCalls.get(callId);
    if (!call) return;

    if (call.ringTimeoutTimer) clearTimeout(call.ringTimeoutTimer);
    if (call.inviteTimer) clearTimeout(call.inviteTimer);

    if (call.calleeUserId) {
      this.activeVoicemailSessions.delete(call.calleeUserId);
    }

    // Save voicemail audio on hangup
    if (call.state === 'voicemail' && call.voicemailChunks && call.voicemailChunks.length > 0 && call.calleeUserId) {
      const audioData = Buffer.concat(call.voicemailChunks);
      const durationSec = Math.round(audioData.length / 32000);
      await execute(
        `INSERT INTO voicemails (user_id, caller_user_id, caller_number, audio_url, duration_sec, is_read)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [call.calleeUserId, call.callerUserId, call.callerNumber, `data:audio/pcm;base64,${audioData.toString('base64')}`, durationSec]
      );
      console.log(`[Switch] 📼 Voicemail recorded for user ${call.calleeUserId}: ${durationSec}s audio.`);
    }

    // If multi-party group call and only 1 caller hangs up, keep other callers connected!
    if (call.isGroupCall && call.participants && hangingUpDeviceId) {
      call.participants.delete(hangingUpDeviceId);
      this.sendToDevice(hangingUpDeviceId, { type: 'call_ended', reason });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', hangingUpDeviceId]);

      if (call.participants.size > 1) {
        console.log(`[Switch] Caller ${hangingUpDeviceId} left Group Call. ${call.participants.size} participants remaining.`);
        return;
      }
    }

    // End call completely
    this.activeCalls.delete(callId);

    this.broadcastToWeb({
      type: 'call_ended',
      callId,
      reason
    });

    const devicesToNotify = call.participants ? Array.from(call.participants) : [call.callerDeviceId, call.calleeDeviceId];
    for (const devId of devicesToNotify) {
      if (devId) {
        serviceLinesService.stopRawPcmPlaybackSession(devId);
        this.sendToDevice(devId, { type: 'call_ended', reason });
        await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', devId]);
        const phone = await queryOne<any>('SELECT hook_state FROM phones WHERE device_id = ?', [devId]);
        if (phone?.hook_state === 'off_hook') {
          this.startOffHookInactivityTimer(devId);
        }
      }
    }

    if (routeVoicemailOnTimeout && !call.connectedAt && call.calleeUserId && !call.isInviteLeg) {
      const calleeUser = await queryOne<any>('SELECT * FROM users WHERE id = ?', [call.calleeUserId]);
      if (calleeUser) {
        await this.routeToVoicemail(call.callerDeviceId, call.callerUserId, call.callerNumber, call.callerName, calleeUser);
      }
    }
  }

  // Binary Audio Routing
  public handleAudioPacket(sourceDeviceId: string, packet: Buffer) {
    if (serviceLinesService.isLoopbackActive(sourceDeviceId)) {
      serviceLinesService.handleLoopbackAudioPacket(sourceDeviceId, packet);
      return;
    }

    const call = this.findCallByDevice(sourceDeviceId);
    if (!call) return;

    if (call.mutedDevices?.has(sourceDeviceId)) {
      return; // Mic is muted
    }

    if (call.state === 'connected') {
      // Multi-Party Blind SFU Fan-Out
      if (call.isGroupCall && call.participants) {
        for (const partDeviceId of call.participants) {
          if (partDeviceId !== sourceDeviceId) {
            const partClient = this.phoneClients.get(partDeviceId);
            if (partClient && partClient.ws.readyState === WebSocket.OPEN) {
              partClient.ws.send(packet);
            }
          }
        }
        return;
      }

      // 1-on-1 Call Audio Forwarding
      const peerDeviceId = sourceDeviceId === call.callerDeviceId ? call.calleeDeviceId : call.callerDeviceId;
      const peerClient = this.phoneClients.get(peerDeviceId);
      if (peerClient && peerClient.ws.readyState === WebSocket.OPEN) {
        peerClient.ws.send(packet);
      }
      return;
    }

    if (call.state === 'voicemail') {
      if (call.voicemailChunks) {
        call.voicemailChunks.push(packet);
      }
      if (call.calleeScreeningDeviceId) {
        const calleeClient = this.phoneClients.get(call.calleeScreeningDeviceId);
        if (calleeClient && calleeClient.ws.readyState === WebSocket.OPEN) {
          calleeClient.ws.send(packet);
        }
      }
    }
  }

  public handleCallHangup(deviceId: string) {
    const call = this.findCallByDevice(deviceId);
    if (call) {
      this.terminateCall(call.id, 'hangup', deviceId);
    }
  }

  public sendToDevice(deviceId: string, payload: any) {
    const client = this.phoneClients.get(deviceId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }

  private clearDialBuffer(deviceId: string) {
    const dialObj = this.dialedBuffers.get(deviceId);
    if (dialObj?.timer) clearTimeout(dialObj.timer);
    this.dialedBuffers.delete(deviceId);
  }

  public findParkedCallForUser(userId?: number): ActiveCall | undefined {
    if (!userId) return undefined;
    for (const call of this.activeCalls.values()) {
      if (call.state === 'parked' && (call.parkedByUserId === userId || call.callerUserId === userId || call.calleeUserId === userId)) {
        return call;
      }
    }
    return undefined;
  }

  public findActiveConnectedCallForUser(userId?: number, excludeDeviceId?: string): ActiveCall | undefined {
    if (!userId) return undefined;
    for (const call of this.activeCalls.values()) {
      if (call.state === 'connected' && (call.callerUserId === userId || call.calleeUserId === userId)) {
        if (call.callerDeviceId !== excludeDeviceId && call.calleeDeviceId !== excludeDeviceId && (!call.participants || !call.participants.has(excludeDeviceId || ''))) {
          return call;
        }
      }
    }
    return undefined;
  }

  public findRingingCallForUserOrDevice(deviceId: string, userId?: number): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.state === 'ringing') {
        if (call.calleeDeviceId === deviceId || (call.ringingDevices && call.ringingDevices.has(deviceId)) || (userId && call.calleeUserId === userId)) {
          return call;
        }
      }
    }
    return undefined;
  }

  public async joinPartyLineCall(call: ActiveCall, deviceId: string) {
    call.isGroupCall = true;
    if (!call.participants) {
      call.participants = new Set([call.callerDeviceId, call.calleeDeviceId]);
    }
    call.participants.add(deviceId);

    this.sendToDevice(deviceId, { type: 'stop_tone' });
    this.sendToDevice(deviceId, {
      type: 'call_connected',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      sessionKey: call.sessionKey
    });

    // Notify other participants with an in-ear chirp
    for (const pDevId of call.participants) {
      if (pDevId !== deviceId) {
        this.sendToDevice(pDevId, { type: 'play_tone', tone: 'chirp' });
      }
    }

    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', deviceId]);
    console.log(`[Switch] 👥 Device ${deviceId} joined active Party-Line call ${call.id}`);
  }

  public async parkCall(call: ActiveCall, deviceId: string) {
    const client = this.phoneClients.get(deviceId);
    call.state = 'parked';
    call.parkedByUserId = client?.userId;
    call.parkedByDeviceId = deviceId;

    // Send comfort chime to other party
    const peerDeviceId = deviceId === call.callerDeviceId ? call.calleeDeviceId : call.callerDeviceId;
    const peerClient = this.phoneClients.get(peerDeviceId);
    if (peerClient?.ws) {
      const comfortPcm = TtsAudioService.generateComfortTone(180.0);
      serviceLinesService.startRawPcmPlaybackSession(peerDeviceId, comfortPcm, peerClient.ws);
    }

    this.sendToDevice(deviceId, { type: 'play_tone', tone: 'chirp' });
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', deviceId]);
    this.broadcastToWeb({
      type: 'call_state_change',
      callId: call.id,
      state: 'parked',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName
    });
    console.log(`[Switch] 🅿️ Call ${call.id} PARKED by device ${deviceId} (User ${client?.userId})`);
  }

  public async resumeParkedCall(call: ActiveCall, deviceId: string) {
    const client = this.phoneClients.get(deviceId);
    call.state = 'connected';

    if (call.callerUserId === client?.userId) {
      call.callerDeviceId = deviceId;
    } else {
      call.calleeDeviceId = deviceId;
    }

    // Stop hold music / comfort tone on peer device
    serviceLinesService.stopRawPcmPlaybackSession(call.callerDeviceId);
    serviceLinesService.stopRawPcmPlaybackSession(call.calleeDeviceId);

    this.sendToDevice(deviceId, { type: 'stop_tone' });
    this.sendToDevice(call.callerDeviceId, {
      type: 'call_connected',
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName,
      sessionKey: call.sessionKey
    });
    this.sendToDevice(call.calleeDeviceId, {
      type: 'call_connected',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      sessionKey: call.sessionKey
    });

    this.broadcastToWeb({
      type: 'call_state_change',
      callId: call.id,
      state: 'connected',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName
    });

    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', deviceId]);
    console.log(`[Switch] 🅿️ Parked Call ${call.id} RESUMED on device ${deviceId}`);
  }

  public async executeRingbackTest(deviceId: string, userId?: number) {
    let phones: any[] = [];
    if (userId) {
      phones = await query<any>('SELECT * FROM phones WHERE user_id = ? AND is_online = 1', [userId]);
    } else {
      const p = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
      if (p) phones.push(p);
    }

    const enabled = phones.filter(p => p.ring_enabled !== 0);
    const toRing = enabled.length > 0 ? enabled : phones;

    for (const phone of toRing) {
      this.sendTestRing(phone.device_id, phone.ring_style || 'traditional', phone.ring_cadence_custom || '2000,4000');
    }
  }

  private findCallByDevice(deviceId: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.callerDeviceId === deviceId || call.calleeDeviceId === deviceId || (call.participants && call.participants.has(deviceId))) {
        return call;
      }
    }
    return undefined;
  }

  private findCallByCalleeDevice(deviceId: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.calleeDeviceId === deviceId || (call.participants && call.participants.has(deviceId))) {
        return call;
      }
    }
    return undefined;
  }

  private cleanupStaleDevices() {
    const now = Date.now();
    for (const [deviceId, client] of this.phoneClients.entries()) {
      if (now - client.lastHeartbeat > 60000) {
        console.log(`[Switch] Device ${deviceId} heartbeat timed out.`);
        this.phoneClients.delete(deviceId);
        execute('UPDATE phones SET is_online = 0 WHERE device_id = ?', [deviceId]).catch(() => {});
        this.broadcastToWeb({ type: 'phone_status_change', deviceId, isOnline: false });
      }
    }
  }

  public handleWebSocketConnection(ws: WebSocket, req: any) {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    let registeredDeviceId: string | null = null;

    ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        if (registeredDeviceId) {
          this.handleAudioPacket(registeredDeviceId, data as Buffer);
        }
      } else {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleJsonMessage(ws, ip, msg, (id) => {
            registeredDeviceId = id;
          });
        } catch (e) {
          console.error('[Switch] JSON parse error:', e);
        }
      }
    });

    ws.on('close', () => {
      if (registeredDeviceId) {
        this.phoneClients.delete(registeredDeviceId);
        execute('UPDATE phones SET is_online = 0 WHERE device_id = ?', [registeredDeviceId]).catch(() => {});
        this.broadcastToWeb({ type: 'phone_status_change', deviceId: registeredDeviceId, isOnline: false });
      }
      this.unregisterWebClient(ws);
    });
  }

  public init(server: any) {
    const wss = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (request: any, socket: any, head: any) => {
      const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
      if (pathname === '/ws/phone') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleWebSocketConnection(ws as unknown as WebSocket, request);
        });
      }
    });
  }

  public getPhoneClient(deviceId: string): PhoneSocketClient | undefined {
    return this.phoneClients.get(deviceId);
  }

  public sendTestRing(deviceId: string, ringStyle = 'traditional', ringCadence = '2000,4000'): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(JSON.stringify({
      type: 'test_ring',
      ringStyle,
      ringCadence
    }));
    return true;
  }

  public sendRemoteReboot(deviceId: string): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(JSON.stringify({ type: 'reboot' }));
    return true;
  }

  public pushDeviceSettings(deviceId: string, settings: any): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(JSON.stringify({
      type: 'update_settings',
      ...settings
    }));
    return true;
  }

  public notifyOtaUpdateAvailable(version: string, downloadUrl: string) {
    for (const client of this.phoneClients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'ota_available',
          version,
          downloadUrl
        }));
      }
    }
  }
}

export const phoneSwitchService = new PhoneSwitchService();
