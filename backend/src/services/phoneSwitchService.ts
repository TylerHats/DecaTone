import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { execute, query, queryOne } from '../db/connection';
import { VoicemailCryptoService } from './voicemailCryptoService';
import { EmailService } from './emailService';

interface PhoneSocketClient {
  ws: WebSocket;
  deviceId: string;
  userId?: number;
  phoneNumber?: string;
  ipAddress: string;
  lastHeartbeat: number;
}

interface ActiveCall {
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
  state: 'ringing' | 'connected' | 'voicemail';
  isOnHold?: boolean;
  isIntercom?: boolean;
  intercomParticipants?: Set<string>;
  startedAt: number;
  connectedAt?: number;
  ringTimeoutTimer?: NodeJS.Timeout;
  voicemailChunks?: Buffer[];
}

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
const voicemailDir = path.join(uploadsDir, 'voicemails');
if (!fs.existsSync(voicemailDir)) {
  fs.mkdirSync(voicemailDir, { recursive: true });
}

class PhoneSwitchService {
  private wss: WebSocketServer | null = null;
  private phoneClients = new Map<string, PhoneSocketClient>(); // deviceId -> client
  private activeCalls = new Map<string, ActiveCall>(); // callId -> ActiveCall
  private dialedBuffers = new Map<string, { buffer: string; timer?: NodeJS.Timeout }>(); // deviceId -> dialed string
  private transferStates = new Map<string, { callId: string; heldPeerDeviceId: string; buffer: string; timer?: NodeJS.Timeout }>(); // deviceId -> transfer state
  private webClients = new Set<WebSocket>(); // Connected web browser dashboards

  public init(server: http.Server | https.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws/phone' });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
      let registeredDeviceId: string | null = null;

      ws.on('message', async (data: Buffer | string, isBinary: boolean) => {
        try {
          if (isBinary) {
            // Binary audio streaming packet
            if (registeredDeviceId) {
              this.handleAudioPacket(registeredDeviceId, data as Buffer);
            }
            return;
          }

          const messageStr = data.toString();
          const msg = JSON.parse(messageStr);
          await this.handleJsonMessage(ws, ip, msg, (deviceId) => {
            registeredDeviceId = deviceId;
          });
        } catch (err) {
          console.error('[Switch Service Error]', err);
        }
      });

      ws.on('close', () => {
        if (registeredDeviceId) {
          this.handleDeviceDisconnect(registeredDeviceId);
        }
        this.webClients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket Error]', err);
      });
    });

    // Run heartbeat cleanup every 30 seconds
    setInterval(() => this.cleanupStaleDevices(), 30000);
    console.log('☎️  DecaTone Phone Switchboard Service Initialized on /ws/phone');
  }

  // Register Web UI Client for live dashboard notifications
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

  private async handleJsonMessage(
    ws: WebSocket,
    ip: string,
    msg: any,
    setRegisteredDeviceId: (id: string) => void
  ) {
    const { type, deviceId } = msg;

    // Web Client Handshake
    if (type === 'web_client_init') {
      this.registerWebClient(ws);
      ws.send(JSON.stringify({ type: 'web_client_ack', status: 'connected' }));
      return;
    }

    if (!deviceId) return;

    switch (type) {
      case 'register':
      case 'handshake': {
        const { mac, firmwareVersion, rssi, hardwareProfile, bellFrequencyHz, hookFlashEnabled } = msg;
        setRegisteredDeviceId(deviceId);

        // Check or insert phone in database
        let phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
        if (!phone) {
          await execute(
            `INSERT INTO phones (device_id, mac_address, ip_address, firmware_version, rssi, hardware_profile, bell_frequency_hz, hook_flash_enabled, is_online, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
            [
              deviceId,
              mac || '',
              ip,
              firmwareVersion || '1.1.0',
              rssi || 0,
              hardwareProfile || 'western_electric_500',
              bellFrequencyHz || 20.0,
              hookFlashEnabled !== false ? 1 : 0
            ]
          );
          phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
        } else {
          await execute(
            `UPDATE phones SET is_online = 1, ip_address = ?, firmware_version = ?, rssi = ?,
             hardware_profile = COALESCE(hardware_profile, ?),
             bell_frequency_hz = COALESCE(bell_frequency_hz, ?),
             last_seen = CURRENT_TIMESTAMP WHERE device_id = ?`,
            [ip, firmwareVersion || phone.firmware_version, rssi || 0, hardwareProfile || 'western_electric_500', bellFrequencyHz || 20.0, deviceId]
          );
        }

        // Fetch user data if claimed
        let user: any = null;
        if (phone.user_id) {
          user = await queryOne<any>('SELECT id, username, display_name, phone_number FROM users WHERE id = ?', [phone.user_id]);
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

        // Send registration ACK to ESP32-S3 with current hardware settings
        ws.send(
          JSON.stringify({
            type: 'register_ack',
            status: 'registered',
            deviceId,
            isPaired: !!phone.user_id,
            phoneNumber: user?.phone_number || null,
            earpieceVolume: phone.earpiece_volume ?? 80,
            micSensitivity: phone.mic_sensitivity ?? 80,
            audioProfile: phone.audio_profile || 'vintage_pots',
            sidetoneLevel: phone.sidetone_level ?? 10,
            ringStyle: phone.ring_style || 'traditional',
            ringCadence: phone.ring_cadence_custom || '2000,4000',
            bellFrequencyHz: phone.bell_frequency_hz ?? 20.0,
            hardwareProfile: phone.hardware_profile || 'western_electric_500',
            hookFlashEnabled: phone.hook_flash_enabled !== 0,
            intercomEnabled: phone.intercom_enabled !== 0
          })
        );

        this.broadcastToWeb({
          type: 'phone_status_change',
          deviceId,
          isOnline: true,
          isPaired: !!phone.user_id,
          phoneNumber: user?.phone_number || null,
          hardwareProfile: phone.hardware_profile,
          bellFrequencyHz: phone.bell_frequency_hz
        });

        console.log(`[Switch] ESP32-S3 registered: ${deviceId} (${ip}) - Model: ${phone.hardware_profile || 'standard'} - Bell: ${phone.bell_frequency_hz || 20}Hz`);
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

      case 'hook_flash': {
        await this.handleHookFlash(deviceId);
        break;
      }

      case 'dial_digit': {
        const { digit } = msg; // string '1'-'9', '0', '*'
        await this.handleDialDigit(deviceId, String(digit));
        break;
      }

      case 'call_answer': {
        await this.handleCallAnswer(deviceId);
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

    if (state === 'off_hook') {
      // Check if answering an active incoming call
      const activeCall = this.findCallByCalleeDevice(deviceId);
      if (activeCall && activeCall.state === 'ringing') {
        await this.connectCall(activeCall);
        return;
      }

      // Otherwise, user picked up handset to initiate a call -> start dial tone
      this.dialedBuffers.set(deviceId, { buffer: '' });
      this.sendToDevice(deviceId, { type: 'play_tone', tone: 'dial' });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['dialing', deviceId]);
    } else {
      // Handset placed on hook -> terminate active calls or stop dialing
      this.clearDialBuffer(deviceId);
      this.sendToDevice(deviceId, { type: 'stop_tone' });
      this.sendToDevice(deviceId, { type: 'stop_ring' });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', deviceId]);

      // If in an active call, hang up
      const activeCall = this.findCallByDevice(deviceId);
      if (activeCall) {
        await this.terminateCall(activeCall.id, 'hangup');
      }
    }
  }

  private async handleHookFlash(deviceId: string) {
    const phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
    if (phone && phone.hook_flash_enabled === 0) {
      console.log(`[Switch] Hook flash ignored: disabled for ${deviceId}`);
      return;
    }

    const call = this.findCallByDevice(deviceId);
    if (!call || call.state !== 'connected') {
      console.log(`[Switch] Hook flash ignored: no active connected call for ${deviceId}`);
      return;
    }

    const peerDeviceId = (deviceId === call.callerDeviceId) ? call.calleeDeviceId : call.callerDeviceId;

    if (!call.isOnHold) {
      // Put call on HOLD
      call.isOnHold = true;
      this.transferStates.set(deviceId, {
        callId: call.id,
        heldPeerDeviceId: peerDeviceId,
        buffer: ''
      });

      // Send hold event to peer
      this.sendToDevice(peerDeviceId, { type: 'call_on_hold', message: 'Call placed on hold by peer' });
      // Send dial tone to initiator so they can dial transfer extension
      this.sendToDevice(deviceId, { type: 'play_tone', tone: 'dial' });

      console.log(`[Switch] ⏸️ Call ${call.id} placed ON HOLD by ${deviceId}. Peer ${peerDeviceId} on hold.`);
      this.broadcastToWeb({
        type: 'call_hold_status',
        callId: call.id,
        isOnHold: true,
        initiatorDeviceId: deviceId,
        heldPeerDeviceId: peerDeviceId
      });
    } else {
      // Unhold / Resume Call
      call.isOnHold = false;
      this.transferStates.delete(deviceId);

      this.sendToDevice(deviceId, { type: 'stop_tone' });
      this.sendToDevice(peerDeviceId, { type: 'stop_tone' });
      this.sendToDevice(peerDeviceId, { type: 'call_connected', sessionKey: call.sessionKey });

      console.log(`[Switch] ▶️ Call ${call.id} resumed by ${deviceId}.`);
      this.broadcastToWeb({
        type: 'call_hold_status',
        callId: call.id,
        isOnHold: false,
        initiatorDeviceId: deviceId,
        heldPeerDeviceId: peerDeviceId
      });
    }
  }

  private async executeCallTransfer(initiatorDeviceId: string, callId: string, heldPeerDeviceId: string, targetUser: any) {
    const call = this.activeCalls.get(callId);
    if (!call) return;

    // Find target phone
    const targetPhone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [targetUser.id]);
    const targetClient = targetPhone ? this.phoneClients.get(targetPhone.device_id) : null;

    if (!targetPhone || !targetClient || !targetPhone.is_online || targetPhone.call_state !== 'idle') {
      console.log(`[Switch] Transfer failed: Target extension ${targetUser.phone_number} unavailable`);
      this.sendToDevice(initiatorDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    console.log(`[Switch] 🔀 Transferring call ${call.id} to ${targetUser.username} (${targetUser.phone_number})`);

    // Release initiator
    this.sendToDevice(initiatorDeviceId, { type: 'stop_tone' });
    this.sendToDevice(initiatorDeviceId, { type: 'call_ended', reason: 'transferred' });
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', initiatorDeviceId]);

    // Re-wire active call: heldPeerDeviceId <---> targetPhone.device_id
    if (call.callerDeviceId === initiatorDeviceId) {
      call.callerDeviceId = targetPhone.device_id;
      call.callerUserId = targetUser.id;
      call.callerNumber = targetUser.phone_number;
      call.callerName = targetUser.display_name || targetUser.username;
    } else {
      call.calleeDeviceId = targetPhone.device_id;
      call.calleeUserId = targetUser.id;
      call.calleeNumber = targetUser.phone_number;
      call.calleeName = targetUser.display_name || targetUser.username;
    }

    call.isOnHold = false;
    call.state = 'ringing';

    // Ring target phone
    this.sendToDevice(targetPhone.device_id, {
      type: 'incoming_call',
      callerNumber: (call.callerDeviceId === targetPhone.device_id) ? call.calleeNumber : call.callerNumber,
      callerName: (call.callerDeviceId === targetPhone.device_id) ? call.calleeName : call.callerName,
      ringStyle: targetPhone.ring_style || 'traditional',
      ringCadence: targetPhone.ring_cadence_custom || '2000,4000',
      bellFrequencyHz: targetPhone.bell_frequency_hz ?? 20.0
    });

    // Send ringback to held peer
    this.sendToDevice(heldPeerDeviceId, { type: 'play_tone', tone: 'ringback' });
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', targetPhone.device_id]);
  }

  public async initiateIntercomBroadcast(callerDeviceId: string) {
    const callerPhone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [callerDeviceId]);
    const callerUser = callerPhone?.user_id
      ? await queryOne<any>('SELECT * FROM users WHERE id = ?', [callerPhone.user_id])
      : null;

    const callerNumber = callerUser?.phone_number || '00';
    const callerName = (callerUser?.display_name || callerUser?.username || 'Switchboard') + ' (Intercom)';

    // Find all online phones except caller
    const onlinePhones = await query<any>(
      'SELECT * FROM phones WHERE is_online = 1 AND device_id != ?',
      [callerDeviceId]
    );

    if (onlinePhones.length === 0) {
      console.log(`[Switch] Intercom broadcast from ${callerDeviceId}: No other phones online`);
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    const callId = `intercom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sessionKey = crypto.randomBytes(32).toString('hex');
    const participants = new Set<string>();

    const intercomCall: ActiveCall = {
      id: callId,
      callerDeviceId,
      callerUserId: callerUser?.id,
      callerNumber,
      callerName,
      calleeDeviceId: 'all_phones',
      calleeNumber: '00',
      calleeName: 'All-Call Broadcast Intercom',
      sessionKey,
      state: 'connected',
      isIntercom: true,
      intercomParticipants: participants,
      startedAt: Date.now(),
      connectedAt: Date.now()
    };

    this.activeCalls.set(callId, intercomCall);

    // Caller connected immediately to the broadcast transmitter
    this.sendToDevice(callerDeviceId, {
      type: 'call_connected',
      sessionKey,
      isIntercom: true,
      role: 'broadcaster'
    });
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['in_call', callerDeviceId]);

    console.log(`[Switch] 📢 All-Call Broadcast Intercom started by ${callerName} (${callerDeviceId}) -> Ringing ${onlinePhones.length} phones`);

    for (const targetPhone of onlinePhones) {
      const targetClient = this.phoneClients.get(targetPhone.device_id);
      if (targetClient && targetClient.ws.readyState === WebSocket.OPEN && targetPhone.call_state === 'idle') {
        participants.add(targetPhone.device_id);
        this.sendToDevice(targetPhone.device_id, {
          type: 'intercom_incoming',
          callerNumber,
          callerName,
          ringStyle: 'pulse',
          ringCadence: '300,300',
          bellFrequencyHz: targetPhone.bell_frequency_hz ?? 20.0
        });
      }
    }

    this.broadcastToWeb({
      type: 'intercom_broadcast_started',
      callId,
      callerNumber,
      callerName,
      targetCount: participants.size
    });
  }

  private async handleDialDigit(deviceId: string, digit: string) {
    const client = this.phoneClients.get(deviceId);
    if (!client) return;

    // Stop dial tone as soon as user starts dialing
    this.sendToDevice(deviceId, { type: 'stop_tone' });

    // Check if in Hook-Flash Call Transfer Dialing Mode
    const transferState = this.transferStates.get(deviceId);
    if (transferState) {
      if (transferState.timer) clearTimeout(transferState.timer);
      transferState.buffer += digit;
      const transferTargetNumber = transferState.buffer;

      const targetUser = await queryOne<any>(
        'SELECT id, username, display_name, phone_number FROM users WHERE phone_number = ?',
        [transferTargetNumber]
      );

      if (targetUser) {
        this.transferStates.delete(deviceId);
        await this.executeCallTransfer(deviceId, transferState.callId, transferState.heldPeerDeviceId, targetUser);
        return;
      }

      transferState.timer = setTimeout(async () => {
        const dest = transferState.buffer;
        this.transferStates.delete(deviceId);
        const userByNum = await queryOne<any>(
          'SELECT id, username, display_name, phone_number FROM users WHERE phone_number = ?',
          [dest]
        );
        if (userByNum) {
          await this.executeCallTransfer(deviceId, transferState.callId, transferState.heldPeerDeviceId, userByNum);
        } else {
          this.sendToDevice(deviceId, { type: 'play_tone', tone: 'busy' });
        }
      }, 3000);
      return;
    }

    let dialState = this.dialedBuffers.get(deviceId);
    if (!dialState) {
      dialState = { buffer: '' };
      this.dialedBuffers.set(deviceId, dialState);
    }

    if (dialState.timer) {
      clearTimeout(dialState.timer);
    }

    dialState.buffer += digit;
    const currentBuffer = dialState.buffer;

    this.broadcastToWeb({
      type: 'phone_dialing_digit',
      deviceId,
      digit,
      currentBuffer
    });

    // Check Intercom / All-Call Broadcast (Dial '00' or '*0')
    if (currentBuffer === '00' || currentBuffer === '*0') {
      this.clearDialBuffer(deviceId);
      await this.initiateIntercomBroadcast(deviceId);
      return;
    }

    // Check Single Digit Speed Dial (1-9) or Voicemail (0)
    if (currentBuffer.length === 1 && client.userId) {
      if (digit === '0') {
        // Dialing '0' -> Connect to Voicemail Inbox
        this.clearDialBuffer(deviceId);
        await this.startVoicemailPlaybackSession(deviceId, client.userId);
        return;
      }

      const speedDial = await queryOne<any>(
        'SELECT target_phone_number FROM speed_dials WHERE user_id = ? AND slot_digit = ?',
        [client.userId, parseInt(digit, 10)]
      );

      if (speedDial) {
        dialState.timer = setTimeout(async () => {
          this.clearDialBuffer(deviceId);
          await this.initiateCall(deviceId, speedDial.target_phone_number);
        }, 1200);
        return;
      }
    }

    // Check if buffer matches any user's extension / phone number
    const targetUser = await queryOne<any>(
      'SELECT id, username, display_name, phone_number FROM users WHERE phone_number = ?',
      [currentBuffer]
    );

    if (targetUser) {
      this.clearDialBuffer(deviceId);
      await this.initiateCall(deviceId, targetUser.phone_number);
      return;
    }

    // Set inter-digit timeout (3 seconds) to trigger call attempt
    dialState.timer = setTimeout(async () => {
      const dialedNumber = dialState?.buffer;
      this.clearDialBuffer(deviceId);
      if (dialedNumber) {
        await this.initiateCall(deviceId, dialedNumber);
      }
    }, 3000);
  }

  public async initiateCall(callerDeviceId: string, calleeNumber: string) {
    const callerClient = this.phoneClients.get(callerDeviceId);
    const callerPhone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [callerDeviceId]);
    const callerUser = callerPhone?.user_id
      ? await queryOne<any>('SELECT * FROM users WHERE id = ?', [callerPhone.user_id])
      : null;

    const callerNumber = callerUser?.phone_number || 'Unknown';
    const callerName = callerUser?.display_name || callerUser?.username || 'DecaTone Caller';

    // Find callee user
    const calleeUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [calleeNumber]);
    if (!calleeUser) {
      // Invalid number -> play reorder / error tone
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'busy', reason: 'number_not_found' });
      await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['busy', callerDeviceId]);
      return;
    }

    // Find callee phone
    const calleePhone = await queryOne<any>('SELECT * FROM phones WHERE user_id = ?', [calleeUser.id]);
    const calleeClient = calleePhone ? this.phoneClients.get(calleePhone.device_id) : null;

    // Check if callee is available
    if (!calleePhone || !calleeClient || !calleePhone.is_online) {
      // Callee is offline -> direct to Voicemail
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser);
      return;
    }

    if (calleePhone.call_state !== 'idle' || calleePhone.hook_state === 'off_hook') {
      // Callee is busy -> direct to Voicemail
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser);
      return;
    }

    // Check Privacy Permissions (Friends Only or DND)
    if (calleeUser.call_privacy === 'dnd') {
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser);
      return;
    }

    if (calleeUser.call_privacy === 'friends_only' && callerUser) {
      const isFriend = await queryOne(
        `SELECT id FROM friends 
         WHERE status = 'accepted' 
         AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
        [callerUser.id, calleeUser.id, calleeUser.id, callerUser.id]
      );
      if (!isFriend) {
        // Not a friend -> route to Voicemail or reject
        await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser);
        return;
      }
    }

    // Initiate Ringing
    const callId = crypto.randomUUID();
    const sessionKey = crypto.randomBytes(16).toString('hex');

    const ringTimeoutSec = calleePhone.ring_timeout_sec || 25;

    const ringTimeoutTimer = setTimeout(async () => {
      console.log(`[Switch] Call ${callId} ring timeout exceeded (${ringTimeoutSec}s). Routing to voicemail...`);
      await this.terminateCall(callId, 'timeout', true);
    }, ringTimeoutSec * 1000);

    const activeCall: ActiveCall = {
      id: callId,
      callerDeviceId,
      callerUserId: callerUser?.id,
      callerNumber,
      callerName,
      calleeDeviceId: calleePhone.device_id,
      calleeUserId: calleeUser.id,
      calleeNumber: calleeUser.phone_number,
      calleeName: calleeUser.display_name || calleeUser.username,
      sessionKey,
      state: 'ringing',
      startedAt: Date.now(),
      ringTimeoutTimer
    };

    this.activeCalls.set(callId, activeCall);

    // Update phone database states
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', callerDeviceId]);
    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', calleePhone.device_id]);

    // Send Ringback Tone to Caller
    this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'ringback' });

    // Send Ring Command to Callee ESP32-S3
    this.sendToDevice(calleePhone.device_id, {
      type: 'incoming_call',
      callId,
      callerNumber,
      callerName,
      ringStyle: calleePhone.ring_style || 'traditional',
      ringCadence: calleePhone.ring_cadence_custom || '2000,4000'
    });

    this.broadcastToWeb({
      type: 'call_state_change',
      callId,
      state: 'ringing',
      callerNumber,
      callerName,
      calleeNumber: calleeUser.phone_number,
      calleeName: activeCall.calleeName
    });
  }

  private async handleCallAnswer(deviceId: string) {
    const call = this.findCallByCalleeDevice(deviceId);
    if (call && call.state === 'ringing') {
      await this.connectCall(call);
    }
  }

  private async connectCall(call: ActiveCall) {
    if (call.ringTimeoutTimer) {
      clearTimeout(call.ringTimeoutTimer);
      call.ringTimeoutTimer = undefined;
    }

    call.state = 'connected';
    call.connectedAt = Date.now();

    // Stop ringing and tones
    this.sendToDevice(call.callerDeviceId, { type: 'stop_tone' });
    this.sendToDevice(call.calleeDeviceId, { type: 'stop_ring' });

    // Send Call Connected signal with E2EE session key to both ESP32-S3 devices
    this.sendToDevice(call.callerDeviceId, {
      type: 'call_connected',
      callId: call.id,
      sessionKey: call.sessionKey,
      peerNumber: call.calleeNumber,
      peerName: call.calleeName
    });

    this.sendToDevice(call.calleeDeviceId, {
      type: 'call_connected',
      callId: call.id,
      sessionKey: call.sessionKey,
      peerNumber: call.callerNumber,
      peerName: call.callerName
    });

    await execute('UPDATE phones SET call_state = ? WHERE device_id IN (?, ?)', ['connected', call.callerDeviceId, call.calleeDeviceId]);

    this.broadcastToWeb({
      type: 'call_state_change',
      callId: call.id,
      state: 'connected',
      callerNumber: call.callerNumber,
      calleeNumber: call.calleeNumber
    });
  }

  private async handleCallHangup(deviceId: string) {
    const call = this.findCallByDevice(deviceId);
    if (call) {
      await this.terminateCall(call.id, 'hangup');
    }
  }

  public async terminateCall(callId: string, reason: string, routeVoicemailOnTimeout = false) {
    const call = this.activeCalls.get(callId);
    if (!call) return;

    if (call.ringTimeoutTimer) {
      clearTimeout(call.ringTimeoutTimer);
    }

    this.activeCalls.delete(callId);

    // If call was in voicemail recording state and audio chunks were captured
    if (call.state === 'voicemail' && call.voicemailChunks && call.voicemailChunks.length > 0 && call.calleeUserId) {
      try {
        const rawPcm = Buffer.concat(call.voicemailChunks);
        const durationSec = Math.max(1, Math.round(rawPcm.length / 32000)); // 16kHz 16-bit mono = 32,000 bytes/sec

        if (rawPcm.length >= 16000) { // At least 0.5s of audio
          // Look up or generate user's key salt
          let userRow = await queryOne<any>('SELECT id, key_salt FROM users WHERE id = ?', [call.calleeUserId]);
          let keySalt = userRow?.key_salt;
          if (!keySalt) {
            keySalt = crypto.randomBytes(16).toString('hex');
            await execute('UPDATE users SET key_salt = ? WHERE id = ?', [keySalt, call.calleeUserId]);
          }

          // Build WAV container and encrypt with recipient's AES-256-GCM key
          const wavData = VoicemailCryptoService.createWavBuffer(rawPcm, 16000, 1, 16);
          const userKey = VoicemailCryptoService.deriveUserKey(call.calleeUserId, keySalt);
          const encrypted = VoicemailCryptoService.encryptAudio(wavData, userKey);

          // Write encrypted ciphertext to disk with .enc extension
          const encFilename = `vm_${call.calleeUserId}_${Date.now()}.enc`;
          const encFilePath = path.join(voicemailDir, encFilename);
          fs.writeFileSync(encFilePath, encrypted.ciphertext);

          const audioUrl = `/api/voicemail/raw/${encFilename}`;

          const result = await execute(
            `INSERT INTO voicemails (user_id, caller_user_id, caller_number, audio_url, duration_sec, is_encrypted, encryption_iv, encryption_tag, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)`,
            [call.calleeUserId, call.callerUserId || null, call.callerNumber, audioUrl, durationSec, encrypted.iv, encrypted.tag]
          );

          this.broadcastToWeb({
            type: 'new_voicemail',
            userId: call.calleeUserId,
            callerNumber: call.callerNumber,
            durationSec,
            voicemailId: result.lastID
          });

          console.log(`[Voicemail] Encrypted & saved zero-access voicemail for User ${call.calleeUserId} (${durationSec}s, AES-256-GCM).`);

          // Send Email notification to recipient if enabled
          const calleeUser = await queryOne<any>('SELECT email, username, display_name, notify_on_voicemail FROM users WHERE id = ?', [call.calleeUserId]);
          if (calleeUser && calleeUser.email && calleeUser.notify_on_voicemail) {
            EmailService.sendVoicemailNotification(
              calleeUser.email,
              calleeUser,
              call.callerNumber,
              call.callerName,
              durationSec,
              'http://localhost:4000'
            ).catch(e => console.error(e));
          }
        }
      } catch (err) {
        console.error('[Voicemail Error] Failed to encrypt/save voicemail:', err);
      }
    }

    const durationSec = call.connectedAt ? Math.round((Date.now() - call.connectedAt) / 1000) : 0;
    const callStatus = call.connectedAt ? 'completed' : (reason === 'timeout' ? 'missed' : 'rejected');

    // Save Call Record in Database
    await execute(
      `INSERT INTO calls (caller_user_id, callee_user_id, caller_number, callee_number, status, duration_sec, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), CURRENT_TIMESTAMP)`,
      [call.callerUserId || null, call.calleeUserId || null, call.callerNumber, call.calleeNumber, callStatus, durationSec, Math.floor(call.startedAt / 1000)]
    );

    // If call was missed, send notification email to callee if enabled
    if (callStatus === 'missed' && call.calleeUserId && !call.connectedAt) {
      const calleeUser = await queryOne<any>('SELECT email, username, display_name, notify_on_missed_call FROM users WHERE id = ?', [call.calleeUserId]);
      if (calleeUser && calleeUser.email && calleeUser.notify_on_missed_call) {
        EmailService.sendMissedCallNotification(
          calleeUser.email,
          calleeUser,
          call.callerNumber,
          call.callerName,
          'http://localhost:4000'
        ).catch(e => console.error(e));
      }
    }

    // Stop tones and rings on devices
    this.sendToDevice(call.callerDeviceId, { type: 'call_ended', callId, reason });
    this.sendToDevice(call.calleeDeviceId, { type: 'call_ended', callId, reason });

    this.sendToDevice(call.callerDeviceId, { type: 'stop_tone' });
    this.sendToDevice(call.calleeDeviceId, { type: 'stop_ring' });

    await execute('UPDATE phones SET call_state = ? WHERE device_id IN (?, ?)', ['idle', call.callerDeviceId, call.calleeDeviceId]);

    this.broadcastToWeb({
      type: 'call_ended',
      callId,
      reason,
      status: callStatus,
      durationSec
    });

    if (routeVoicemailOnTimeout && !call.connectedAt && call.calleeUserId) {
      const calleeUser = await queryOne<any>('SELECT * FROM users WHERE id = ?', [call.calleeUserId]);
      if (calleeUser) {
        await this.routeToVoicemail(call.callerDeviceId, call.callerUserId, call.callerNumber, call.callerName, calleeUser);
      }
    }
  }

  // Route to Voicemail recording
  public async routeToVoicemail(
    callerDeviceId: string,
    callerUserId: number | undefined,
    callerNumber: string,
    callerName: string,
    calleeUser: any
  ) {
    const callId = crypto.randomUUID();

    // Check if callee has custom greeting
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

    this.sendToDevice(callerDeviceId, {
      type: 'play_voicemail_greeting',
      callId,
      greetingUrl,
      promptBeep: true
    });

    await execute('UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', callerDeviceId]);

    this.broadcastToWeb({
      type: 'voicemail_recording_started',
      callId,
      callerNumber,
      calleeNumber: calleeUser.phone_number
    });
  }

  // Interactive Voicemail Playback for user dialing '0'
  public async startVoicemailPlaybackSession(deviceId: string, userId: number) {
    const voicemails = await query<any>(
      'SELECT id, caller_number, audio_url, duration_sec, created_at FROM voicemails WHERE user_id = ? ORDER BY id DESC LIMIT 10',
      [userId]
    );

    if (voicemails.length === 0) {
      this.sendToDevice(deviceId, {
        type: 'play_audio_clip',
        clipUrl: '/assets/sounds/no_voicemails.wav'
      });
      return;
    }

    this.sendToDevice(deviceId, {
      type: 'play_voicemail_list',
      count: voicemails.length,
      voicemails
    });
  }

  // Binary Audio Routing
  private handleAudioPacket(sourceDeviceId: string, packet: Buffer) {
    const call = this.findCallByDevice(sourceDeviceId);
    if (!call) return;

    if (call.state === 'connected') {
      // Intercom Broadcast Audio Routing
      if (call.isIntercom) {
        if (call.intercomParticipants) {
          for (const partDeviceId of call.intercomParticipants) {
            if (partDeviceId !== sourceDeviceId) {
              const partClient = this.phoneClients.get(partDeviceId);
              if (partClient && partClient.ws.readyState === WebSocket.OPEN) {
                partClient.ws.send(packet);
              }
            }
          }
        }
        return;
      }

      // If call is on hold, do not stream audio to held peer
      if (call.isOnHold) {
        return;
      }

      const targetDeviceId = sourceDeviceId === call.callerDeviceId ? call.calleeDeviceId : call.callerDeviceId;
      const targetClient = this.phoneClients.get(targetDeviceId);
      if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
        targetClient.ws.send(packet);
      }
    } else if (call.state === 'voicemail' && sourceDeviceId === call.callerDeviceId) {
      if (call.voicemailChunks) {
        call.voicemailChunks.push(packet);
      }
    }
  }

  // Device Remote Actions
  public sendTestRing(deviceId: string, ringStyle = 'traditional', cadence = '2000,4000'): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    client.ws.send(
      JSON.stringify({
        type: 'test_ring',
        ringStyle,
        cadence,
        durationMs: 6000
      })
    );
    return true;
  }

  public sendRemoteReboot(deviceId: string): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    client.ws.send(JSON.stringify({ type: 'reboot' }));
    return true;
  }

  public pushDeviceSettings(
    deviceId: string,
    settings: {
      earpieceVolume?: number;
      micSensitivity?: number;
      audioProfile?: string;
      sidetoneLevel?: number;
      ringStyle?: string;
      ringCadence?: string;
      bellFrequencyHz?: number;
      hardwareProfile?: string;
      hookFlashEnabled?: boolean;
      intercomEnabled?: boolean;
    }
  ): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    client.ws.send(
      JSON.stringify({
        type: 'apply_settings',
        ...settings
      })
    );
    return true;
  }

  public notifyOtaUpdateAvailable(version: string, binaryUrl: string) {
    for (const client of this.phoneClients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'ota_available',
            version,
            binaryUrl
          })
        );
      }
    }
  }

  private sendToDevice(deviceId: string, payload: any) {
    const client = this.phoneClients.get(deviceId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }

  private findCallByDevice(deviceId: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.callerDeviceId === deviceId || call.calleeDeviceId === deviceId) {
        return call;
      }
    }
    return undefined;
  }

  private findCallByCalleeDevice(deviceId: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.calleeDeviceId === deviceId) {
        return call;
      }
    }
    return undefined;
  }

  private clearDialBuffer(deviceId: string) {
    const state = this.dialedBuffers.get(deviceId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.dialedBuffers.delete(deviceId);
  }

  private handleDeviceDisconnect(deviceId: string) {
    this.phoneClients.delete(deviceId);
    this.clearDialBuffer(deviceId);

    const call = this.findCallByDevice(deviceId);
    if (call) {
      this.terminateCall(call.id, 'disconnect');
    }

    execute('UPDATE phones SET is_online = 0 WHERE device_id = ?', [deviceId]);

    this.broadcastToWeb({
      type: 'phone_status_change',
      deviceId,
      isOnline: false
    });

    console.log(`[Switch] ESP32-S3 disconnected: ${deviceId}`);
  }

  private async cleanupStaleDevices() {
    const now = Date.now();
    for (const [deviceId, client] of this.phoneClients.entries()) {
      if (now - client.lastHeartbeat > 75000) {
        try {
          client.ws.terminate();
        } catch (e) {}
        this.handleDeviceDisconnect(deviceId);
      }
    }
  }
}

export const phoneSwitchService = new PhoneSwitchService();
