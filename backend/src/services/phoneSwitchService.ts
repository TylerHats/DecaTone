import WebSocket from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execute, query, queryOne } from '../db/connection';
import { GREETINGS_DIR, VOICEMAILS_DIR, ensureDirectories } from '../config/paths';
import { getSafePublicBaseUrl } from '../config/secrets';
import { isValidP256UncompressedPublicKey, authenticateWebSocketRequest, AuthenticatedUser } from '../middleware/authMiddleware';
import { serviceLinesService } from './serviceLinesService';
import { homeAssistantMqttService } from './homeAssistantMqttService';
import { TtsAudioService } from './ttsAudioService';
import { VoicemailCryptoService } from './voicemailCryptoService';
import { EmailService } from './emailService';
import { acousticCalibrationService } from './acousticCalibrationService';

export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyDeviceToken(providedToken: string | undefined | null, storedHashHex: string | undefined | null): boolean {
  if (!providedToken || !storedHashHex) return false;
  try {
    const h1 = crypto.createHash('sha256').update(providedToken, 'utf8').digest();
    const h2 = Buffer.from(storedHashHex, 'hex');
    if (h1.length !== 32 || h2.length !== 32) return false;
    return crypto.timingSafeEqual(h1, h2);
  } catch {
    return false;
  }
}

export function isWebDeviceId(deviceId?: string | null): boolean {
  return !!deviceId && deviceId.startsWith('WEB-');
}

export interface PhoneSocketClient {
  ws: WebSocket;
  deviceId: string;
  userId?: number;
  phoneNumber?: string;
  ipAddress: string;
  lastHeartbeat: number;
  lastDbWriteAt: number;
  isWebSoftphone?: boolean;
  isMonitorOnly?: boolean;
  hookState?: 'on_hook' | 'off_hook';
  telemetry?: {
    rssi?: number;
    freeHeap?: number;
    freePsram?: number;
    noiseFloorDb?: number;
    pps?: number;
    breakRatio?: number;
  };
}

export interface ParticipantE2eeMeta {
  ephPub: string;
  identityPublicKey?: string | null;
  signature?: string | null;
  expectedIdentityPublicKey?: string | null;
  legacyUnsigned?: boolean;
}

export interface ActiveCall {
  id: string;
  cdrId?: number;
  callerDeviceId: string;
  callerUserId?: number;
  callerNumber: string;
  callerName: string;
  calleeDeviceId: string;
  calleeUserId?: number;
  calleeNumber: string;
  calleeName: string;
  sessionKey: string;
  keyLeaderDeviceId: string;
  participantPubKeys: Map<string, string>;
  participantE2eeMeta?: Map<string, ParticipantE2eeMeta>;
  participantSlots?: Map<string, number>;
  state: 'ringing' | 'connected' | 'busy' | 'ended' | 'voicemail' | 'parked';
  startedAt: number;
  connectedAt?: number;
  ringTimeoutTimer?: NodeJS.Timeout;
  voicemailChunks?: Buffer[];
  voicemailBytesRecorded?: number;
  calleeScreeningDeviceId?: string;
  isOnHold?: boolean;
  isGroupCall?: boolean;
  participants?: Set<string>;
  participantUserIds?: Set<number>;
  isIntercom?: boolean;
  mutedDevices?: Set<string>;
  parkedByUserId?: number;
  parkedByDeviceId?: string;
  ringingDevices?: Set<string>;
}

interface WaitingCall {
  callerDeviceId: string;
  callerUserId?: number;
  callerNumber: string;
  callerName: string;
  calleeUser: any;
  cdrId?: number;
  ringTimeoutTimer: NodeJS.Timeout;
}

interface InCallInviteState {
  callId: string;
  inviterDeviceId: string;
  buffer: string;
  interdigitTimer?: NodeJS.Timeout;
}

interface PendingGroupInvite {
  callId: string;
  inviterDeviceId: string;
  targetUserId: number;
  timer: NodeJS.Timeout;
}

interface VmInboxSessionState {
  command?: 'replay' | 'next' | 'delete' | 'keep';
  activeVmId?: number;
  wakeFn?: () => void;
  playbackDoneVmId?: number;
}

const MAX_VOICEMAIL_PCM_BYTES = 300 * 32000; // 9.6 MB max (5 minutes @ 16kHz 16-bit mono)
const EMERGENCY_NUMBERS = new Set(['911', '112', '999', '000', '9911']);
const PAIRING_WORDS = ['TONE', 'BELL', 'RING', 'DIAL', 'ECHO', 'WIRE', 'POST', 'HOOK', 'ROTR', 'DESK', 'CALL', 'PULSE', 'LINE', 'SWCH'];

export class PhoneSwitchService {
  private phoneClients: Map<string, PhoneSocketClient> = new Map();
  private userWebClients: Map<number, Set<WebSocket>> = new Map();
  private adminWebClients: Set<WebSocket> = new Set();
  private wsToUser: Map<WebSocket, AuthenticatedUser> = new Map();

  private activeCalls: Map<string, ActiveCall> = new Map();
  private deviceToCall: Map<string, ActiveCall> = new Map();

  private dialedBuffers: Map<string, { buffer: string; timer?: NodeJS.Timeout }> = new Map();
  private waitingCalls: Map<string, WaitingCall> = new Map();
  private inCallInviteStates: Map<string, InCallInviteState> = new Map();
  private pendingGroupInvites: Map<string, PendingGroupInvite> = new Map();
  private directVmTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeVoicemailSessions: Map<number, ActiveCall> = new Map();
  private activeVmInboxSessions: Map<string, VmInboxSessionState> = new Map();
  private recentDndAttempts: Map<string, number> = new Map();
  private offHookInactivityTimers: Map<string, { stage1Timer?: NodeJS.Timeout; stage2Timer?: NodeJS.Timeout }> = new Map();

  constructor() {
    const cleanupTimer = setInterval(() => this.cleanupStaleDevices(), 30000);
    if (typeof cleanupTimer.unref === 'function') {
      cleanupTimer.unref();
    }
    console.log('☎️  DecaTone Phone Switchboard Service Initialized on /ws/phone');
  }

  public getActiveCallCount(): number {
    return this.activeCalls.size;
  }

  public findActiveWebSoftphoneDeviceId(userId: number): string | null {
    for (const [devId, cl] of this.phoneClients.entries()) {
      if (cl.isWebSoftphone && !cl.isMonitorOnly && cl.userId === userId && cl.ws.readyState === WebSocket.OPEN) {
        return devId;
      }
    }
    return null;
  }

  public async hangupAllActiveCalls(): Promise<void> {
    for (const callId of Array.from(this.activeCalls.keys())) {
      await this.terminateCall(callId, 'system_reset');
    }
  }

  public async resetAllRuntimeState(): Promise<void> {
    await this.hangupAllActiveCalls();

    for (const [, w] of this.waitingCalls) {
      clearTimeout(w.ringTimeoutTimer);
    }
    this.waitingCalls.clear();

    for (const [, inv] of this.pendingGroupInvites) {
      clearTimeout(inv.timer);
    }
    this.pendingGroupInvites.clear();

    for (const [, st] of this.inCallInviteStates) {
      if (st.interdigitTimer) clearTimeout(st.interdigitTimer);
    }
    this.inCallInviteStates.clear();

    for (const [, t] of this.directVmTimers) clearTimeout(t);
    this.directVmTimers.clear();

    for (const [, t] of this.offHookInactivityTimers) {
      if (t.stage1Timer) clearTimeout(t.stage1Timer);
      if (t.stage2Timer) clearTimeout(t.stage2Timer);
    }
    this.offHookInactivityTimers.clear();

    this.activeVoicemailSessions.clear();
    this.activeVmInboxSessions.clear();
    this.dialedBuffers.clear();
    this.recentDndAttempts.clear();

    for (const [devId, client] of Array.from(this.phoneClients.entries())) {
      if (client.isWebSoftphone) {
        try { client.ws.close(1000, 'System wiped'); } catch {}
        this.phoneClients.delete(devId);
      } else {
        client.userId = undefined;
        client.phoneNumber = undefined;
      }
    }
  }

  private getOrAssignCallSlot(call: ActiveCall, deviceId: string): number {
    if (!call.participantSlots) call.participantSlots = new Map();
    const existing = call.participantSlots.get(deviceId);
    if (existing !== undefined) return existing;
    const used = new Set(call.participantSlots.values());
    let slot = 0;
    while (used.has(slot) && slot < 255) slot++;
    call.participantSlots.set(deviceId, slot);
    return slot;
  }

  private async safeUpdatePhoneSql(deviceId: string, sql: string, params: any[]) {
    if (!deviceId || isWebDeviceId(deviceId)) return;
    await execute(sql, params);
  }

  private indexCallDevices(call: ActiveCall) {
    if (call.callerDeviceId) this.deviceToCall.set(call.callerDeviceId, call);
    if (call.calleeDeviceId) this.deviceToCall.set(call.calleeDeviceId, call);
    if (call.participants) {
      for (const devId of call.participants) {
        if (devId) this.deviceToCall.set(devId, call);
      }
    }
  }

  private unindexCallDevices(call: ActiveCall) {
    if (call.callerDeviceId && this.deviceToCall.get(call.callerDeviceId)?.id === call.id) {
      this.deviceToCall.delete(call.callerDeviceId);
    }
    if (call.calleeDeviceId && this.deviceToCall.get(call.calleeDeviceId)?.id === call.id) {
      this.deviceToCall.delete(call.calleeDeviceId);
    }
    if (call.participants) {
      for (const devId of call.participants) {
        if (this.deviceToCall.get(devId)?.id === call.id) {
          this.deviceToCall.delete(devId);
        }
      }
    }
  }

  private isDeviceInCall(call: ActiveCall, deviceId: string): boolean {
    if (!deviceId) return false;
    if (call.participants && call.participants.has(deviceId)) return true;
    return call.callerDeviceId === deviceId || call.calleeDeviceId === deviceId;
  }

  private getCallConnectedPeerDevices(call: ActiveCall): string[] {
    if (call.participants && call.participants.size > 0) {
      return Array.from(call.participants).filter(Boolean);
    }
    return [call.callerDeviceId, call.calleeDeviceId].filter(Boolean);
  }

  // Off-Hook Inactivity & Howler Alert Timers
  public startOffHookInactivityTimer(deviceId: string) {
    this.clearOffHookInactivityTimer(deviceId);
    if (isWebDeviceId(deviceId)) return;

    const stage1 = setTimeout(async () => {
      try {
        const phone = await queryOne<any>('SELECT hook_state FROM phones WHERE device_id = ?', [deviceId]);
        const dialObj = this.dialedBuffers.get(deviceId);
        if (phone?.hook_state === 'off_hook' && (!dialObj?.buffer || dialObj.buffer === '')) {
          const activeCall = this.findCallByDevice(deviceId);
          if (!activeCall && !serviceLinesService.isLoopbackActive(deviceId) && !this.activeVmInboxSessions.has(deviceId)) {
            console.log(`[Switch] Off-hook inactivity (15s) on ${deviceId} -> Fast Busy`);
            this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
          }
        }
      } catch {}
    }, 15000);

    const stage2 = setTimeout(async () => {
      try {
        const phone = await queryOne<any>('SELECT hook_state FROM phones WHERE device_id = ?', [deviceId]);
        const dialObj = this.dialedBuffers.get(deviceId);
        if (phone?.hook_state === 'off_hook' && (!dialObj?.buffer || dialObj.buffer === '')) {
          const activeCall = this.findCallByDevice(deviceId);
          if (!activeCall && !serviceLinesService.isLoopbackActive(deviceId) && !this.activeVmInboxSessions.has(deviceId)) {
            console.log(`[Switch] Off-hook inactivity (30s) on ${deviceId} -> HOWLER TONE ALERT!`);
            const client = this.phoneClients.get(deviceId);
            if (client?.ws) {
              const howlerPcm = TtsAudioService.generateHowlerTone(8.0);
              serviceLinesService.startRawPcmPlaybackSession(deviceId, howlerPcm, client.ws);
            }
            this.sendToDevice(deviceId, { type: 'play_tone', tone: 'howler' });
          }
        }
      } catch {}
    }, 30000);

    if (typeof stage1.unref === 'function') stage1.unref();
    if (typeof stage2.unref === 'function') stage2.unref();

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

  // User-scoped Web UI WebSocket Registry
  public registerWebClient(ws: WebSocket, authUser: AuthenticatedUser) {
    this.wsToUser.set(ws, authUser);
    let set = this.userWebClients.get(authUser.id);
    if (!set) {
      set = new Set();
      this.userWebClients.set(authUser.id, set);
    }
    set.add(ws);

    if (authUser.role === 'admin') {
      this.adminWebClients.add(ws);
    }
  }

  public unregisterWebClient(ws: WebSocket) {
    const authUser = this.wsToUser.get(ws);
    if (authUser) {
      const set = this.userWebClients.get(authUser.id);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          this.userWebClients.delete(authUser.id);
        }
      }
      this.wsToUser.delete(ws);
    }
    this.adminWebClients.delete(ws);
  }

  public sendToUserWeb(userId: number | undefined | null, payload: any, alsoNotifyAdmins = false) {
    const jsonStr = JSON.stringify(payload);
    const sentSockets = new Set<WebSocket>();

    if (userId) {
      const userSockets = this.userWebClients.get(userId);
      if (userSockets) {
        for (const ws of userSockets) {
          if (ws.readyState === WebSocket.OPEN && !sentSockets.has(ws)) {
            ws.send(jsonStr);
            sentSockets.add(ws);
          }
        }
      }
    }

    if (alsoNotifyAdmins) {
      for (const ws of this.adminWebClients) {
        if (ws.readyState === WebSocket.OPEN && !sentSockets.has(ws)) {
          ws.send(jsonStr);
          sentSockets.add(ws);
        }
      }
    }
  }

  public sendCallEventToWeb(call: ActiveCall, payload: any) {
    const targetUsers = new Set<number>();
    if (call.callerUserId) targetUsers.add(call.callerUserId);
    if (call.calleeUserId) targetUsers.add(call.calleeUserId);
    if (call.participantUserIds) {
      for (const uid of call.participantUserIds) {
        if (uid) targetUsers.add(uid);
      }
    }
    for (const uid of targetUsers) {
      this.sendToUserWeb(uid, payload);
    }
  }

  /**
   * Computes the end timestamp of the currently active DND schedule window (or null if outside window).
   */
  public computeActiveDndWindowEnd(user: any, now = new Date()): Date | null {
    if (!user || user.dnd_schedule_enabled !== 1 || !user.dnd_schedule_start || !user.dnd_schedule_end) {
      return null;
    }

    const days = String(user.dnd_schedule_days || '1,2,3,4,5,6,7')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const [startH, startM] = String(user.dnd_schedule_start).split(':').map(Number);
    const [endH, endM] = String(user.dnd_schedule_end).split(':').map(Number);
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return null;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    const isoDay = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay()).toString();

    if (startMinutes < endMinutes) {
      // Same-day window (e.g. 09:00 to 17:00)
      if (days.includes(isoDay(now)) && currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        const end = new Date(now);
        end.setHours(endH, endM, 0, 0);
        return end;
      }
      return null;
    } else {
      // Overnight window (e.g. 22:00 to 08:00)
      if (currentMinutes >= startMinutes && days.includes(isoDay(now))) {
        const end = new Date(now);
        end.setDate(end.getDate() + 1);
        end.setHours(endH, endM, 0, 0);
        return end;
      }
      if (currentMinutes < endMinutes) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (days.includes(isoDay(yesterday))) {
          const end = new Date(now);
          end.setHours(endH, endM, 0, 0);
          return end;
        }
      }
      return null;
    }
  }

  // DND Schedule Evaluation Engine with Expiring Window Override
  public isDndActiveForUser(user: any): boolean {
    if (!user) return false;
    if (user.dnd_manual_state === 1 || user.call_privacy === 'dnd') {
      return true;
    }

    const now = new Date();
    const windowEnd = this.computeActiveDndWindowEnd(user, now);
    if (windowEnd) {
      const overrideUntilStr = user.dnd_override_until || (user.dnd_override_period && user.dnd_override_period.includes('T') ? user.dnd_override_period : null);
      if (overrideUntilStr) {
        const overrideUntilMs = new Date(overrideUntilStr).getTime();
        if (!isNaN(overrideUntilMs) && overrideUntilMs > now.getTime()) {
          return false; // Overridden until current schedule window ends
        }
        // Override expired -> clean up asynchronously in DB
        if (user.id) {
          execute('UPDATE users SET dnd_override_until = NULL, dnd_override_period = NULL WHERE id = ?', [user.id]).catch(() => {});
        }
      }
      return true;
    }
    return false;
  }

  private async handleJsonMessage(
    ws: WebSocket,
    ip: string,
    msg: any,
    wsAuthUser: AuthenticatedUser | null,
    getRegisteredDeviceId: () => string | null,
    setRegisteredDeviceId: (id: string) => void
  ) {
    const { type } = msg;

    // 1. Web Softphone Handshake (MUST be authenticated via wsAuthUser and strictly user-scoped!)
    if (type === 'web_client_init') {
      if (!wsAuthUser) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Authentication required for web softphone' }));
        ws.close(1008, 'Unauthorized');
        return;
      }

      const userId = wsAuthUser.id;
      const user = await queryOne<any>(
        'SELECT id, username, display_name, phone_number FROM users WHERE id = ?',
        [userId]
      );
      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'User account not found' }));
        ws.close(1008, 'Unauthorized');
        return;
      }

      const isMonitorOnly = Boolean(msg.monitorOnly) || (typeof msg.deviceId === 'string' && msg.deviceId.startsWith('WEB-MON-'));
      const prefix = isMonitorOnly ? `WEB-MON-${userId}-` : `WEB-${userId}-`;
      let webDeviceId = '';
      if (
        typeof msg.deviceId === 'string' &&
        msg.deviceId.startsWith(prefix) &&
        /^WEB-(?:MON-)?\d+-[a-zA-Z0-9_-]{1,32}$/.test(msg.deviceId)
      ) {
        const existingOwner = this.phoneClients.get(msg.deviceId);
        if (!existingOwner || existingOwner.userId === userId) {
          webDeviceId = msg.deviceId;
        }
      }
      if (!webDeviceId) {
        webDeviceId = `${prefix}${crypto.randomInt(1000, 10000)}`;
      }

      setRegisteredDeviceId(webDeviceId);
      this.registerWebClient(ws, wsAuthUser);

      const client: PhoneSocketClient = {
        ws,
        deviceId: webDeviceId,
        userId: user.id,
        phoneNumber: user.phone_number,
        ipAddress: ip,
        lastHeartbeat: Date.now(),
        lastDbWriteAt: Date.now(),
        isWebSoftphone: true,
        isMonitorOnly,
        hookState: 'on_hook'
      };

      this.phoneClients.set(webDeviceId, client);

      ws.send(
        JSON.stringify({
          type: 'web_client_ack',
          status: 'connected',
          deviceId: webDeviceId,
          monitorOnly: isMonitorOnly,
          userId: user.id,
          phoneNumber: user.phone_number
        })
      );
      return;
    }

    // Only allow factory_reset, register, handshake on unregistered sockets; all other commands require authenticated registeredDeviceId!
    const registeredId = getRegisteredDeviceId();

    if (type === 'factory_reset') {
      const targetId = registeredId || (typeof msg.deviceId === 'string' ? msg.deviceId.trim().toUpperCase() : '');
      if (!targetId || isWebDeviceId(targetId)) return;
      const existingPhone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [targetId]);
      if (existingPhone?.device_token_hash) {
        if (!verifyDeviceToken(msg.deviceToken, existingPhone.device_token_hash)) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid device token' }));
          ws.close(1008, 'Invalid device token');
          return;
        }
      } else if (!registeredId) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Unauthorized factory reset request' }));
        ws.close(1008, 'Unauthorized');
        return;
      }

      console.log(`[Switch] Factory Reset verified for ${targetId}. Unpairing device...`);
      await execute(
        'UPDATE phones SET user_id = NULL, paired_at = NULL, device_token_hash = NULL, wrapped_vm_key = NULL WHERE device_id = ?',
        [targetId]
      );
      await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [targetId]);
      return;
    }

    if (type === 'register' || type === 'handshake') {
      const hardwareDeviceId = typeof msg.deviceId === 'string' ? msg.deviceId.trim().toUpperCase() : '';
      if (!hardwareDeviceId || isWebDeviceId(hardwareDeviceId)) return;

      const {
        mac,
        firmwareVersion,
        rssi,
        hardwareProfile,
        bellFrequencyHz,
        hookFlashEnabled,
        isReset,
        deviceToken,
        devicePublicKey,
        freeHeap,
        freePsram,
        noiseFloorDb
      } = msg;

      let phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [hardwareDeviceId]);

      if (isReset && phone) {
        if (!phone.device_token_hash || !verifyDeviceToken(deviceToken, phone.device_token_hash)) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid device token' }));
          ws.close(1008, 'Invalid device token');
          return;
        }
        console.log(`[Switch] Device ${hardwareDeviceId} flagged as reset. Unpairing...`);
        await execute(
          'UPDATE phones SET user_id = NULL, paired_at = NULL, device_token_hash = NULL, wrapped_vm_key = NULL WHERE device_id = ?',
          [hardwareDeviceId]
        );
        await execute('DELETE FROM pending_device_enrollments WHERE device_id = ?', [hardwareDeviceId]);
        phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [hardwareDeviceId]);
      }

      // Strictly require valid deviceToken for paired devices (no unauthenticated token auto-minting)
      if (phone?.user_id) {
        if (!phone.device_token_hash || !verifyDeviceToken(deviceToken, phone.device_token_hash)) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid or missing device token; re-pair device or perform 5s factory reset' }));
          ws.close(1008, 'Invalid device token');
          return;
        }
      }

      const cleanPubKey = isValidP256UncompressedPublicKey(devicePublicKey) ? String(devicePublicKey).trim() : null;

      setRegisteredDeviceId(hardwareDeviceId);
      const deviceId = hardwareDeviceId;

        const cleanHeap = typeof freeHeap === 'number' ? Math.round(freeHeap) : null;
        const cleanPsram = typeof freePsram === 'number' ? Math.round(freePsram) : null;
        const cleanNoise = typeof noiseFloorDb === 'number' ? noiseFloorDb : null;

        if (!phone) {
          await execute(
            `INSERT INTO phones (
               device_id, mac_address, ip_address, firmware_version, rssi,
               hardware_profile, bell_frequency_hz, hook_flash_enabled,
               device_public_key, free_heap, free_psram, last_noise_floor_db,
               is_online, last_seen
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
            [
              deviceId,
              mac || '',
              ip,
              firmwareVersion || '1.3.0',
              rssi ?? -52,
              hardwareProfile || 'western_electric_500',
              bellFrequencyHz || 20.0,
              hookFlashEnabled !== false ? 1 : 0,
              cleanPubKey,
              cleanHeap,
              cleanPsram,
              cleanNoise
            ]
          );
          phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
        } else {
          await execute(
            `UPDATE phones SET
               is_online = 1,
               last_seen = CURRENT_TIMESTAMP,
               ip_address = ?,
               firmware_version = ?,
               rssi = ?,
               hardware_profile = ?,
               bell_frequency_hz = ?,
               device_public_key = COALESCE(device_public_key, ?),
               free_heap = COALESCE(?, free_heap),
               free_psram = COALESCE(?, free_psram),
               last_noise_floor_db = COALESCE(?, last_noise_floor_db)
             WHERE device_id = ?`,
            [
              ip,
              firmwareVersion || phone.firmware_version || '1.3.0',
              rssi ?? phone.rssi ?? -52,
              hardwareProfile || phone.hardware_profile || 'western_electric_500',
              bellFrequencyHz || phone.bell_frequency_hz || 20.0,
              cleanPubKey,
              cleanHeap,
              cleanPsram,
              cleanNoise,
              deviceId
            ]
          );
          phone = await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);
        }

        let user: any = null;
        if (phone.user_id) {
          user = await queryOne<any>(
            `SELECT id, username, display_name, phone_number, call_privacy,
                    dnd_manual_state, dnd_schedule_enabled, dnd_schedule_start, dnd_schedule_end,
                    dnd_schedule_days, dnd_override_period, dnd_override_until, dnd_repeated_call_breakthrough
             FROM users WHERE id = ?`,
            [phone.user_id]
          );
        }

        let pairingWord = '---';
        let pairingCode = '---';
        let fullPairingCode = '---';

        if (!phone.user_id) {
          const enrollment = await this.getOrCreatePendingEnrollment(deviceId, ip);
          pairingWord = enrollment.word;
          pairingCode = enrollment.numeric;
          fullPairingCode = enrollment.fullCode;

          ws.send(
            JSON.stringify({
              type: 'pairing_info',
              word: pairingWord,
              code: pairingCode,
              fullCode: fullPairingCode
            })
          );
        }

        const now = Date.now();
        const client: PhoneSocketClient = {
          ws,
          deviceId,
          userId: user?.id,
          phoneNumber: user?.phone_number,
          ipAddress: ip,
          lastHeartbeat: now,
          lastDbWriteAt: now,
          hookState: (phone.hook_state as any) || 'on_hook',
          telemetry: {
            rssi: phone.rssi ?? -52,
            freeHeap: phone.free_heap ?? undefined,
            freePsram: phone.free_psram ?? undefined,
            noiseFloorDb: phone.last_noise_floor_db ?? undefined,
            pps: phone.last_pps ?? undefined,
            breakRatio: phone.last_break_ratio ?? undefined
          }
        };

        this.phoneClients.set(deviceId, client);

        const ackPayload: any = {
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
          intercomEnabled: phone.intercom_enabled !== 0,
          hookFlashEnabled: phone.hook_flash_enabled !== 0,
          wrappedVmKey: phone.wrapped_vm_key || null
        };
        ws.send(JSON.stringify(ackPayload));

        this.sendToUserWeb(
          user?.id,
          {
            type: 'phone_status_change',
            deviceId,
            isOnline: true,
            isPaired: !!phone.user_id,
            ownerUsername: user?.username || null,
            phoneNumber: user?.phone_number || null,
            hardwareProfile: phone.hardware_profile,
            bellFrequencyHz: phone.bell_frequency_hz
          },
          true
        );

        homeAssistantMqttService.registerPhoneDiscovery(phone, user).catch(e => console.error(e));
        console.log(`[Switch] Telephone registered: ${deviceId} (${ip}) - Paired: ${!!phone.user_id} - Bell: ${phone.bell_frequency_hz || 20}Hz`);
        return;
      }

      // All remaining switchboard commands strictly require an authenticated registeredId (no spoofing via msg.deviceId!)
      const deviceId = registeredId;
      if (!deviceId) {
        return;
      }

      if (type === 'e2ee_pub') {
        if (typeof msg.publicKey !== 'string') return;
        const call = (msg.callId ? this.activeCalls.get(msg.callId) : undefined) || this.deviceToCall.get(deviceId);
        if (!call || !this.isDeviceInCall(call, deviceId)) return;

        // Look up expected identity pubkey from DB for verification
        let expectedIdentityPublicKey: string | null = null;
        if (isWebDeviceId(deviceId)) {
          const cl = this.phoneClients.get(deviceId);
          if (cl?.userId) {
            const uRow = await queryOne<{ encryption_public_key: string }>('SELECT encryption_public_key FROM users WHERE id = ?', [cl.userId]);
            expectedIdentityPublicKey = uRow?.encryption_public_key || null;
          }
        } else {
          const pRow = await queryOne<{ device_public_key: string }>('SELECT device_public_key FROM phones WHERE device_id = ?', [deviceId]);
          expectedIdentityPublicKey = pRow?.device_public_key || null;
        }

        const identityPublicKey = typeof msg.identityPublicKey === 'string' ? msg.identityPublicKey : null;
        const signature = typeof msg.signature === 'string' ? msg.signature : null;
        const legacyUnsigned = !signature;

        call.participantPubKeys.set(deviceId, msg.publicKey);
        if (!call.participantE2eeMeta) call.participantE2eeMeta = new Map();
        call.participantE2eeMeta.set(deviceId, {
          ephPub: msg.publicKey,
          identityPublicKey,
          signature,
          expectedIdentityPublicKey,
          legacyUnsigned
        });

        for (const [peerDeviceId, existingPub] of call.participantPubKeys.entries()) {
          if (peerDeviceId !== deviceId) {
            const peerMeta = call.participantE2eeMeta.get(peerDeviceId);
            this.sendToDevice(deviceId, {
              type: 'e2ee_peer_pub',
              callId: call.id,
              peerDeviceId,
              publicKey: existingPub,
              identityPublicKey: peerMeta?.identityPublicKey || null,
              signature: peerMeta?.signature || null,
              expectedIdentityPublicKey: peerMeta?.expectedIdentityPublicKey || null,
              legacyUnsigned: peerMeta?.legacyUnsigned ?? true
            });
          }
        }

        for (const peerDeviceId of this.getCallConnectedPeerDevices(call)) {
          if (peerDeviceId !== deviceId) {
            this.sendToDevice(peerDeviceId, {
              type: 'e2ee_peer_pub',
              callId: call.id,
              peerDeviceId: deviceId,
              publicKey: msg.publicKey,
              identityPublicKey,
              signature,
              expectedIdentityPublicKey,
              legacyUnsigned
            });
          }
        }
        return;
      }

      if (type === 'e2ee_media_key') {
        if (typeof msg.targetDeviceId !== 'string') return;
        const call = (msg.callId ? this.activeCalls.get(msg.callId) : undefined) || this.deviceToCall.get(deviceId);
        if (!call) return;
        if (!this.isDeviceInCall(call, deviceId) || !this.isDeviceInCall(call, msg.targetDeviceId)) {
          return;
        }

        this.sendToDevice(msg.targetDeviceId, {
          type: 'e2ee_media_key',
          callId: call.id,
          targetDeviceId: msg.targetDeviceId,
          senderDeviceId: deviceId,
          senderPublicKey: msg.senderPublicKey,
          keyId: msg.keyId,
          iv: msg.iv,
          tag: msg.tag,
          wrappedKey: msg.wrappedKey
        });
        return;
      }

      if (type === 'calibration_sample') {
        acousticCalibrationService.handleCalibrationSample(
          deviceId,
          Number(msg.frequency),
          Number(msg.rmsAmplitude)
        );
        return;
      }

      if (type === 'voicemail_playback_done') {
        const vmSess = this.activeVmInboxSessions.get(deviceId);
        if (vmSess && Number(msg.vmId) === vmSess.activeVmId) {
          vmSess.playbackDoneVmId = Number(msg.vmId);
          vmSess.wakeFn?.();
        }
        return;
      }

      switch (type) {

      case 'heartbeat': {
        const now = Date.now();
        const client = this.phoneClients.get(deviceId);
        const rssiVal = typeof msg.rssi === 'number' ? msg.rssi : undefined;
        const heapVal = typeof msg.freeHeap === 'number' ? Math.round(msg.freeHeap) : undefined;
        const psramVal = typeof msg.freePsram === 'number' ? Math.round(msg.freePsram) : undefined;
        const noiseVal = typeof msg.noiseFloorDb === 'number' ? msg.noiseFloorDb : undefined;

        if (client) {
          client.lastHeartbeat = now;
          client.telemetry = {
            ...client.telemetry,
            ...(rssiVal !== undefined ? { rssi: rssiVal } : {}),
            ...(heapVal !== undefined ? { freeHeap: heapVal } : {}),
            ...(psramVal !== undefined ? { freePsram: psramVal } : {}),
            ...(noiseVal !== undefined ? { noiseFloorDb: noiseVal } : {})
          };

          // Throttle SQLite heartbeat writes to once per 60 seconds per device
          if (!isWebDeviceId(deviceId) && now - client.lastDbWriteAt >= 60000) {
            client.lastDbWriteAt = now;
            await execute(
              `UPDATE phones SET
                 is_online = 1,
                 last_seen = CURRENT_TIMESTAMP,
                 rssi = COALESCE(?, rssi),
                 free_heap = COALESCE(?, free_heap),
                 free_psram = COALESCE(?, free_psram),
                 last_noise_floor_db = COALESCE(?, last_noise_floor_db)
               WHERE device_id = ?`,
              [rssiVal ?? null, heapVal ?? null, psramVal ?? null, noiseVal ?? null, deviceId]
            );
            homeAssistantMqttService.publishTelemetryMetrics(deviceId, { rssi: rssiVal });
          }
        }
        ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: now }));
        break;
      }

      case 'telemetry': {
        const client = this.phoneClients.get(deviceId);
        const heapVal = typeof msg.freeHeap === 'number' ? Math.round(msg.freeHeap) : null;
        const psramVal = typeof msg.freePsram === 'number' ? Math.round(msg.freePsram) : null;
        const noiseVal = typeof msg.noiseFloorDb === 'number' ? msg.noiseFloorDb : null;
        const ppsVal = typeof msg.pps === 'number' ? msg.pps : null;
        const breakVal = typeof msg.breakRatio === 'number' ? msg.breakRatio : null;

        if (client) {
          client.telemetry = {
            ...client.telemetry,
            ...(heapVal !== null ? { freeHeap: heapVal } : {}),
            ...(psramVal !== null ? { freePsram: psramVal } : {}),
            ...(noiseVal !== null ? { noiseFloorDb: noiseVal } : {}),
            ...(ppsVal !== null ? { pps: ppsVal } : {}),
            ...(breakVal !== null ? { breakRatio: breakVal } : {})
          };
        }

        if (!isWebDeviceId(deviceId)) {
          await execute(
            `UPDATE phones SET
               free_heap = COALESCE(?, free_heap),
               free_psram = COALESCE(?, free_psram),
               last_noise_floor_db = COALESCE(?, last_noise_floor_db),
               last_pps = COALESCE(?, last_pps),
               last_break_ratio = COALESCE(?, last_break_ratio)
             WHERE device_id = ?`,
            [heapVal, psramVal, noiseVal, ppsVal, breakVal, deviceId]
          );
        }
        break;
      }

      case 'hook_state': {
        const { state } = msg;
        if (state === 'off_hook' || state === 'on_hook') {
          await this.handleHookStateChange(deviceId, state);
        }
        break;
      }

      case 'hook_flash': {
        await this.handleHookFlash(deviceId);
        break;
      }

      case 'dial_digit': {
        const { digit, pps, breakRatio, pulseCount, pulseDurationsMs } = msg;
        if (digit !== undefined && digit !== null) {
          await this.handleDialDigit(deviceId, String(digit), { pps, breakRatio, pulseCount, pulseDurationsMs });
        }
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

      case 'call_decline_to_voicemail': {
        await this.declineToVoicemail(deviceId, msg.callId);
        break;
      }

      case 'web_dial': {
        if (msg.destination) {
          await this.initiateCall(deviceId, String(msg.destination));
        }
        break;
      }
    }
  }

  private async getOrCreatePendingEnrollment(deviceId: string, ip: string): Promise<{ word: string; numeric: string; fullCode: string }> {
    const pending = await queryOne<any>(
      'SELECT * FROM pending_device_enrollments WHERE device_id = ? AND expires_at > datetime("now")',
      [deviceId]
    );

    if (pending) {
      const word = pending.pairing_code_word;
      const numeric = pending.pairing_code_numeric;
      const fullCode = pending.pairing_code || `${word}-${numeric}`;
      return { word, numeric, fullCode };
    }

    const word = PAIRING_WORDS[crypto.randomInt(0, PAIRING_WORDS.length)];
    const numeric = String(crypto.randomInt(1000, 10000));
    const fullCode = `${word}-${numeric}`;

    await execute(
      `INSERT OR REPLACE INTO pending_device_enrollments (device_id, ip_address, pairing_code_word, pairing_code_numeric, pairing_code, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+24 hours'))`,
      [deviceId, ip, word, numeric, fullCode]
    );

    return { word, numeric, fullCode };
  }

  public async handleHookFlash(deviceId: string) {
    const client = this.phoneClients.get(deviceId);
    if (!client) return;

    if (!isWebDeviceId(deviceId)) {
      const phone = await queryOne<any>('SELECT hook_flash_enabled FROM phones WHERE device_id = ?', [deviceId]);
      if (phone && phone.hook_flash_enabled === 0) {
        return;
      }
    }

    // 1. Accept Call Waiting if pending
    const waiting = this.waitingCalls.get(deviceId);
    if (waiting) {
      await this.acceptWaitingCall(deviceId, waiting);
      console.log(`[Switch] Hook-flash accepted waiting call on ${deviceId}`);
      return;
    }

    // 2. Resume Parked Call if user has one parked
    const parkedCall = this.findParkedCallForUser(client.userId);
    if (parkedCall) {
      await this.resumeParkedCall(parkedCall, deviceId);
      return;
    }

    // 3. Toggle Park on currently connected call
    const activeCall = this.findCallByDevice(deviceId);
    if (activeCall && activeCall.state === 'connected') {
      await this.parkCall(activeCall, deviceId);
    }
  }

  private async handleHookStateChange(deviceId: string, state: 'off_hook' | 'on_hook') {
    const client = this.phoneClients.get(deviceId);
    if (client) {
      client.hookState = state;
    }

    await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET hook_state = ? WHERE device_id = ?', [state, deviceId]);

    if (client?.userId) {
      this.sendToUserWeb(client.userId, {
        type: 'phone_hook_change',
        deviceId,
        userId: client.userId,
        hookState: state
      });
    }

    if (!isWebDeviceId(deviceId)) {
      homeAssistantMqttService.publishHookState(deviceId, state === 'off_hook');
    }

    if (state === 'off_hook') {
      if (serviceLinesService.isLoopbackActive(deviceId)) {
        serviceLinesService.endLoopbackSession(deviceId);
      }
      serviceLinesService.cancelRingbackTest(deviceId);

      // Unclaimed phone off-hook -> speak pairing code!
      if (!isWebDeviceId(deviceId) && !client?.userId) {
        const phone = await queryOne<any>('SELECT user_id, ip_address FROM phones WHERE device_id = ?', [deviceId]);
        if (!phone?.user_id && client?.ws) {
          const enrollment = await this.getOrCreatePendingEnrollment(deviceId, client.ipAddress || phone?.ip_address || '127.0.0.1');
          const spelledWord = enrollment.word.split('').join(' ');
          const spelledDigits = enrollment.numeric.split('').join(' ');
          const prompt = `DecaTone setup. Your pairing code is ${enrollment.word}, spelled ${spelledWord}, dash ${spelledDigits}. Again, ${enrollment.word}, ${spelledDigits}.`;
          const speech = await TtsAudioService.synthesizeSpeech(prompt, undefined, { cache: false });
          serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
          return;
        }
      }

      // Check 0: Answering a pending Group Invite (`3` + ext)
      const pendingInvite = this.pendingGroupInvites.get(deviceId);
      if (pendingInvite) {
        clearTimeout(pendingInvite.timer);
        this.pendingGroupInvites.delete(deviceId);
        this.sendToDevice(deviceId, { type: 'stop_ring' });
        const targetCall = this.activeCalls.get(pendingInvite.callId);
        if (targetCall && targetCall.state === 'connected') {
          await this.joinPartyLineCall(targetCall, deviceId);
          return;
        }
      }

      // Check 1: Resuming a Parked Call on this user's account
      const parkedCall = this.findParkedCallForUser(client?.userId);
      if (parkedCall) {
        console.log(`[Switch] Resuming parked call on device ${deviceId} for user ${client?.userId}`);
        await this.resumeParkedCall(parkedCall, deviceId);
        return;
      }

      // Check 2: Answering an active incoming call (or household intercom) ringing for this device or user
      const incomingCall = this.findRingingCallForUserOrDevice(deviceId, client?.userId);
      if (incomingCall && incomingCall.state === 'ringing') {
        await this.connectCall(incomingCall, deviceId);
        return;
      }

      // Check 3: Party-Line Auto-Join (Another phone on this account is in an active connected call)
      const existingCall = this.findActiveConnectedCallForUser(client?.userId, deviceId);
      if (existingCall) {
        console.log(`[Switch] Party-Line auto-join on device ${deviceId} into call ${existingCall.id}`);
        await this.joinPartyLineCall(existingCall, deviceId);
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

        this.dialedBuffers.set(deviceId, { buffer: '' });
        await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['screening', deviceId]);
        console.log(`[Switch] Live Voicemail Screening started for user ${client.userId} on device ${deviceId}`);
        return;
      }

      // Normal Dial Tone Evaluation
      this.dialedBuffers.set(deviceId, { buffer: '' });

      let toneType = 'dial';
      if (client?.userId) {
        const user = await queryOne<any>(
          `SELECT id, dnd_manual_state, dnd_schedule_enabled, dnd_schedule_start, dnd_schedule_end,
                  dnd_schedule_days, dnd_override_period, dnd_override_until, call_privacy
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
      await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['dialing', deviceId]);
      this.startOffHookInactivityTimer(deviceId);
    } else {
      // Handset placed on hook -> clean up timers, streams, and active calls
      this.clearOffHookInactivityTimer(deviceId);
      const vmSess = this.activeVmInboxSessions.get(deviceId);
      if (vmSess) {
        this.activeVmInboxSessions.delete(deviceId);
        vmSess.wakeFn?.();
      }

      serviceLinesService.handleRingbackOnHook(deviceId, (dId, uId) => this.executeRingbackTest(dId, uId));
      serviceLinesService.stopRawPcmPlaybackSession(deviceId);

      if (serviceLinesService.isLoopbackActive(deviceId)) {
        serviceLinesService.endLoopbackSession(deviceId);
      }

      await this.cleanupCallerFromWaitingCalls(deviceId);

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

      const vmTimer = this.directVmTimers.get(deviceId);
      if (vmTimer) {
        clearTimeout(vmTimer);
        this.directVmTimers.delete(deviceId);
      }

      this.clearDialBuffer(deviceId);
      this.sendToDevice(deviceId, { type: 'stop_tone' });
      this.sendToDevice(deviceId, { type: 'stop_ring' });
      await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', deviceId]);

      for (const [, vmCall] of this.activeVoicemailSessions) {
        if (vmCall.calleeScreeningDeviceId === deviceId) {
          vmCall.calleeScreeningDeviceId = undefined;
        }
      }

      const activeCall = this.findCallByDevice(deviceId);
      if (activeCall) {
        if (activeCall.state === 'parked' && activeCall.parkedByDeviceId === deviceId) {
          console.log(`[Switch] Parker handset ${deviceId} placed on hook while call ${activeCall.id} remains parked.`);
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

    // Persist rotary dial governor speed & break ratio telemetry
    if (diagnostics && (typeof diagnostics.pps === 'number' || typeof diagnostics.breakRatio === 'number')) {
      const ppsVal = typeof diagnostics.pps === 'number' ? diagnostics.pps : null;
      const breakVal = typeof diagnostics.breakRatio === 'number' ? diagnostics.breakRatio : null;
      client.telemetry = {
        ...client.telemetry,
        ...(ppsVal !== null ? { pps: ppsVal } : {}),
        ...(breakVal !== null ? { breakRatio: breakVal } : {})
      };
      if (!isWebDeviceId(deviceId)) {
        execute(
          'UPDATE phones SET last_pps = COALESCE(?, last_pps), last_break_ratio = COALESCE(?, last_break_ratio) WHERE device_id = ?',
          [ppsVal, breakVal, deviceId]
        ).catch(() => {});
        if (ppsVal !== null) {
          homeAssistantMqttService.publishTelemetryMetrics(deviceId, { pps: ppsVal });
        }
      }
    }

    this.clearOffHookInactivityTimer(deviceId);
    this.sendToDevice(deviceId, { type: 'stop_tone' });
    serviceLinesService.stopRawPcmPlaybackSession(deviceId);

    // 0. Check Interactive Voicemail Inbox Rotary Controls (1: Replay, 3: Next, 7: Delete, 9: Keep)
    const vmInboxSession = this.activeVmInboxSessions.get(deviceId);
    if (vmInboxSession && ['1', '3', '7', '9'].includes(digit)) {
      const cmdMap: Record<string, 'replay' | 'next' | 'delete' | 'keep'> = {
        '1': 'replay',
        '3': 'next',
        '7': 'delete',
        '9': 'keep'
      };
      vmInboxSession.command = cmdMap[digit];
      this.sendToDevice(deviceId, { type: 'voicemail_playback_abort', vmId: vmInboxSession.activeVmId });
      vmInboxSession.wakeFn?.();
      return;
    }

    // 1. Check Call Waiting Intercept (0 to Reject -> Voicemail, 1 to Accept & Bridge Directly)
    const waiting = this.waitingCalls.get(deviceId);
    if (waiting) {
      if (digit === '0') {
        if (waiting.ringTimeoutTimer) clearTimeout(waiting.ringTimeoutTimer);
        this.waitingCalls.delete(deviceId);
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'beep' });
        await this.routeToVoicemail(
          waiting.callerDeviceId,
          waiting.callerUserId,
          waiting.callerNumber,
          waiting.callerName,
          waiting.calleeUser,
          waiting.cdrId
        );
        console.log(`[Switch] Call waiting rejected by ${deviceId}, routed to voicemail.`);
        return;
      } else if (digit === '1') {
        await this.acceptWaitingCall(deviceId, waiting);
        console.log(`[Switch] Call waiting accepted by ${deviceId}, previous call ended.`);
        return;
      }
    }

    // 2. Check Live Voicemail Screening Intercept (Digit '1' to intercept and take call live)
    for (const [calleeUserId, vmCall] of this.activeVoicemailSessions) {
      if (vmCall.calleeScreeningDeviceId === deviceId) {
        if (digit === '1') {
          console.log(`[Switch] Live Screening Intercepted! Converting voicemail to live E2EE 2-way call.`);
          this.activeVoicemailSessions.delete(calleeUserId);
          vmCall.calleeScreeningDeviceId = undefined;
          if (vmCall.ringTimeoutTimer) {
            clearTimeout(vmCall.ringTimeoutTimer);
            vmCall.ringTimeoutTimer = undefined;
          }
          serviceLinesService.stopRawPcmPlaybackSession(vmCall.callerDeviceId);

          // Seal and save whatever partial audio was recorded so far as zero-access voicemail
          await this.sealAndSaveVoicemail(vmCall);

          // Transition to connected two-way E2EE call
          vmCall.state = 'connected';
          vmCall.calleeDeviceId = deviceId;
          vmCall.connectedAt = Date.now();
          vmCall.sessionKey = crypto.randomBytes(16).toString('hex');
          vmCall.keyLeaderDeviceId = vmCall.callerDeviceId;
          this.indexCallDevices(vmCall);

          if (vmCall.cdrId) {
            await execute('UPDATE calls SET status = ? WHERE id = ?', ['connected', vmCall.cdrId]);
          }

          this.sendToDevice(vmCall.callerDeviceId, {
            type: 'call_connected',
            callId: vmCall.id,
            isKeyLeader: true,
            calleeNumber: vmCall.calleeNumber,
            calleeName: vmCall.calleeName,
            sessionKey: vmCall.sessionKey
          });

          this.sendToDevice(deviceId, {
            type: 'call_connected',
            callId: vmCall.id,
            isKeyLeader: deviceId === vmCall.keyLeaderDeviceId,
            callerNumber: vmCall.callerNumber,
            callerName: vmCall.callerName,
            sessionKey: vmCall.sessionKey
          });

          await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', deviceId]);
          return;
        }
      }
    }

    // 3. Check Parked Call Resume ('8') and Active In-Call Controls (2 Mute, 3 Invite, 8 Park)
    const activeCall = this.findCallByDevice(deviceId);
    if (activeCall && activeCall.state === 'parked') {
      if (digit === '8') {
        await this.resumeParkedCall(activeCall, deviceId);
        return;
      }
      return;
    }

    if (activeCall && activeCall.state === 'connected') {
      const inviteState = this.inCallInviteStates.get(deviceId);
      if (inviteState) {
        inviteState.buffer += digit;
        if (inviteState.interdigitTimer) clearTimeout(inviteState.interdigitTimer);

        inviteState.interdigitTimer = setTimeout(() => {
          this.executeInCallGroupInvite(deviceId, inviteState.callId, inviteState.buffer).catch(console.error);
          this.inCallInviteStates.delete(deviceId);
        }, 2000);
        if (typeof inviteState.interdigitTimer.unref === 'function') inviteState.interdigitTimer.unref();
        return;
      }

      if (digit === '2') {
        if (!activeCall.mutedDevices) activeCall.mutedDevices = new Set();
        const isMuted = !activeCall.mutedDevices.has(deviceId);
        if (isMuted) {
          activeCall.mutedDevices.add(deviceId);
        } else {
          activeCall.mutedDevices.delete(deviceId);
        }
        this.sendToDevice(deviceId, { type: 'mic_mute_state', isMuted, muted: isMuted });
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'chirp' });
        console.log(`[Switch] Handset Mic on ${deviceId} ${isMuted ? 'MUTED' : 'UNMUTED'}`);
        return;
      }

      if (digit === '3') {
        if (activeCall.participants && activeCall.participants.size >= 5) {
          this.sendToDevice(deviceId, { type: 'play_tone', tone: 'busy' });
          return;
        }
        this.inCallInviteStates.set(deviceId, {
          callId: activeCall.id,
          inviterDeviceId: deviceId,
          buffer: ''
        });
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'whisper_dial' });
        console.log(`[Switch] In-Call Group Invite mode started by ${deviceId}. Waiting for extension.`);
        return;
      }

      if (digit === '8') {
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

    if (client.userId) {
      this.sendToUserWeb(client.userId, {
        type: 'phone_dialing_digit',
        deviceId,
        userId: client.userId,
        digit,
        currentBuffer,
        diagnostics
      });
    }

    if (!isWebDeviceId(deviceId)) {
      homeAssistantMqttService.publishLastDialed(deviceId, currentBuffer);
    }

    if (dialObj.timer) clearTimeout(dialObj.timer);

    // Immediate check for emergency numbers (911, 112, 999, 000, 9911)
    if (EMERGENCY_NUMBERS.has(currentBuffer)) {
      const pendingVm = this.directVmTimers.get(deviceId);
      if (pendingVm) {
        clearTimeout(pendingVm);
        this.directVmTimers.delete(deviceId);
      }
      this.clearDialBuffer(deviceId);
      await this.handleEmergencyIntercept(deviceId, currentBuffer);
      return;
    }

    // Direct Voicemail ('0' alone -> own inbox after 2.0s; '00' -> intercom; '072...' / '073' / '078' / '079' / '069' -> feature codes)
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
      if (typeof vmTimer.unref === 'function') vmTimer.unref();
      this.directVmTimers.set(deviceId, vmTimer);
      return;
    } else {
      const pendingVm = this.directVmTimers.get(deviceId);
      if (pendingVm) {
        clearTimeout(pendingVm);
        this.directVmTimers.delete(deviceId);
      }
    }

    // Household Intercom ('00') — wait briefly in case user is dialing '000' emergency
    if (currentBuffer === '00') {
      dialObj.timer = setTimeout(async () => {
        if (this.dialedBuffers.get(deviceId)?.buffer === '00') {
          this.clearDialBuffer(deviceId);
          await this.startHouseholdIntercom(deviceId);
        }
      }, 1500);
      if (typeof dialObj.timer.unref === 'function') dialObj.timer.unref();
      return;
    }

    // Direct-to-Voicemail Memo ('0' + extension, excluding feature prefixes)
    if (
      currentBuffer.startsWith('0') &&
      currentBuffer.length > 1 &&
      !['069', '072', '073', '078', '079', '00', '099'].some(p => currentBuffer.startsWith(p)) &&
      !'069'.startsWith(currentBuffer) &&
      !'072'.startsWith(currentBuffer) &&
      !'073'.startsWith(currentBuffer) &&
      !'078'.startsWith(currentBuffer) &&
      !'079'.startsWith(currentBuffer) &&
      !'099'.startsWith(currentBuffer)
    ) {
      dialObj.timer = setTimeout(async () => {
        const targetExt = currentBuffer.substring(1);
        this.clearDialBuffer(deviceId);
        console.log(`[Switch] Direct-to-Voicemail Memo to extension ${targetExt} by ${deviceId}`);
        const targetUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [targetExt]);
        if (targetUser && !targetUser.is_disabled) {
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
      if (typeof dialObj.timer.unref === 'function') dialObj.timer.unref();
      return;
    }

    // Phone Control Codes: 078 (Toggle DND), 079 (DND Status), 073 (Disable Call Forwarding)
    if (currentBuffer === '078' || currentBuffer === '079' || currentBuffer === '073') {
      dialObj.timer = setTimeout(async () => {
        if (this.dialedBuffers.get(deviceId)?.buffer === currentBuffer) {
          await this.processCompletedDialBuffer(deviceId, currentBuffer);
        }
      }, 1800);
      if (typeof dialObj.timer.unref === 'function') dialObj.timer.unref();
      return;
    }

    // General inter-digit delay before executing call / service lines / speed dials / 072+ext
    dialObj.timer = setTimeout(async () => {
      await this.processCompletedDialBuffer(deviceId, currentBuffer);
    }, 2300);
    if (typeof dialObj.timer.unref === 'function') dialObj.timer.unref();
  }

  public async handleEmergencyIntercept(deviceId: string, dialedNumber: string) {
    console.warn(`[Switch] EMERGENCY INTERCEPT triggered on ${deviceId} for dialed digits '${dialedNumber}'`);
    const client = this.phoneClients.get(deviceId);
    const callId = `EMG-${Date.now()}`;

    this.sendToDevice(deviceId, { type: 'stop_tone' });
    this.sendToDevice(deviceId, {
      type: 'call_connected',
      callId,
      calleeNumber: dialedNumber,
      calleeName: 'Emergency Services Unavailable',
      isSystemLine: true
    });

    if (client?.userId) {
      this.sendToUserWeb(client.userId, {
        type: 'emergency_intercept',
        callId,
        deviceId,
        dialedNumber
      });
    }

    if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
      const sitSiren = TtsAudioService.generateSpecialInformationTone();
      const spoken = await TtsAudioService.synthesizeSpeech(
        'Attention. Emergency calls such as 9 1 1 cannot be placed from this DecaTone internet telephone. Please hang up immediately and dial emergency services using a mobile phone or traditional landline.'
      );
      const fullWarning = Buffer.concat([sitSiren, spoken, sitSiren]);
      await serviceLinesService.startRawPcmPlaybackSession(deviceId, fullWarning, client.ws);
      this.sendToDevice(deviceId, {
        type: 'call_ended',
        callId,
        reason: 'emergency_intercept'
      });
    }
  }

  public async startHouseholdIntercom(callerDeviceId: string) {
    const callerClient = this.phoneClients.get(callerDeviceId);
    if (!callerClient?.userId) {
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [callerClient.userId]);
    const otherPhones = await query<any>(
      'SELECT * FROM phones WHERE user_id = ? AND is_online = 1 AND intercom_enabled != 0 AND device_id != ?',
      [callerClient.userId, callerDeviceId]
    );

    if (otherPhones.length === 0) {
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    const callId = crypto.randomUUID();
    const sessionKey = crypto.randomBytes(16).toString('hex');
    const ringingIds = new Set<string>(otherPhones.map(p => p.device_id));

    const intercomCall: ActiveCall = {
      id: callId,
      callerDeviceId,
      callerUserId: callerClient.userId,
      callerNumber: user?.phone_number || '00',
      callerName: `${user?.display_name || user?.username || 'Household'} Intercom`,
      calleeDeviceId: otherPhones[0].device_id,
      calleeUserId: callerClient.userId,
      calleeNumber: '00',
      calleeName: 'Household Intercom',
      sessionKey,
      keyLeaderDeviceId: callerDeviceId,
      participantPubKeys: new Map(),
      state: 'ringing',
      startedAt: Date.now(),
      isIntercom: true,
      isGroupCall: true,
      participants: new Set([callerDeviceId]),
      participantUserIds: new Set([callerClient.userId]),
      ringingDevices: ringingIds
    };

    intercomCall.ringTimeoutTimer = setTimeout(async () => {
      if (intercomCall.state === 'ringing') {
        await this.terminateCall(callId, 'intercom_timeout');
      }
    }, 25000);
    if (typeof intercomCall.ringTimeoutTimer.unref === 'function') intercomCall.ringTimeoutTimer.unref();

    this.activeCalls.set(callId, intercomCall);
    this.indexCallDevices(intercomCall);

    for (const p of otherPhones) {
      this.sendToDevice(p.device_id, {
        type: 'incoming_call',
        callId,
        isIntercom: true,
        callerNumber: '00',
        callerName: intercomCall.callerName,
        ringStyle: 'pulse',
        ringCadence: '400,200,400,1000',
        bellFrequencyHz: p.bell_frequency_hz ?? 20.0
      });
      await this.safeUpdatePhoneSql(p.device_id, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', p.device_id]);
    }

    this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'ringback' });
    await this.safeUpdatePhoneSql(callerDeviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['dialing', callerDeviceId]);
    console.log(`[Switch] Household Intercom '00' ringing ${otherPhones.length} device(s) for user ${callerClient.userId}`);
  }

  public async processCompletedDialBuffer(deviceId: string, buffer: string) {
    const client = this.phoneClients.get(deviceId);
    this.clearDialBuffer(deviceId);

    if (!buffer) return;

    // 0. Emergency Numbers Intercept
    if (EMERGENCY_NUMBERS.has(buffer)) {
      await this.handleEmergencyIntercept(deviceId, buffer);
      return;
    }

    // 1. Voicemail Inbox ('0') & Household Intercom ('00')
    if (buffer === '0') {
      if (client?.userId) {
        await this.startVoicemailPlaybackSession(deviceId, client.userId);
      } else {
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
      }
      return;
    }

    if (buffer === '00') {
      await this.startHouseholdIntercom(deviceId);
      return;
    }

    // 2. Single-Digit Rotary Speed Dials ('1'..'9')
    if (/^[1-9]$/.test(buffer)) {
      if (client?.userId) {
        const slotDigit = parseInt(buffer, 10);
        const speedDial = await queryOne<{ target_phone_number: string }>(
          'SELECT target_phone_number FROM speed_dials WHERE user_id = ? AND slot_digit = ?',
          [client.userId, slotDigit]
        );
        if (speedDial?.target_phone_number) {
          console.log(`[Switch] Speed dial slot ${slotDigit} on ${deviceId} -> dialing ${speedDial.target_phone_number}`);
          await this.initiateCall(deviceId, speedDial.target_phone_number);
          return;
        }
      }
      this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    // 3. Call Forwarding Rotary Codes: 072 + targetExt (Enable), 073 (Disable)
    if (buffer === '073' && client?.userId) {
      await execute(
        'UPDATE phones SET call_forwarding_enabled = 0, forward_to_number = NULL WHERE user_id = ?',
        [client.userId]
      );
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        this.sendToDevice(deviceId, {
          type: 'call_connected',
          callId: `SVC-073-${Date.now()}`,
          calleeNumber: '073',
          calleeName: 'Call Forwarding Disabled',
          isSystemLine: true
        });
        const speech = await TtsAudioService.synthesizeSpeech('Call forwarding is now disabled.');
        await serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
        this.sendToDevice(deviceId, { type: 'call_ended', reason: 'service_completed' });
      }
      return;
    }

    if (buffer.startsWith('072') && client?.userId) {
      const targetExt = buffer.slice(3).trim();
      if (!targetExt || targetExt === client.phoneNumber || EMERGENCY_NUMBERS.has(targetExt)) {
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
        return;
      }
      await execute(
        'UPDATE phones SET call_forwarding_enabled = 1, forward_to_number = ? WHERE user_id = ?',
        [targetExt, client.userId]
      );
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        this.sendToDevice(deviceId, {
          type: 'call_connected',
          callId: `SVC-072-${Date.now()}`,
          calleeNumber: '072',
          calleeName: 'Call Forwarding Enabled',
          isSystemLine: true
        });
        const speech = await TtsAudioService.synthesizeSpeech(
          `Call forwarding enabled to extension ${targetExt}.`
        );
        await serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
        this.sendToDevice(deviceId, { type: 'call_ended', reason: 'service_completed' });
      }
      return;
    }

    // 4. DND Feature Codes: 078 (Toggle), 079 (Status)
    if (buffer === '078' && client?.userId) {
      const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [client.userId]);
      if (user) {
        const currentlyDnd = this.isDndActiveForUser(user);
        const newManual = currentlyDnd ? 0 : 1;
        let overrideUntil: string | null = null;
        if (newManual === 0) {
          const windowEnd = this.computeActiveDndWindowEnd(user, new Date());
          overrideUntil = windowEnd ? windowEnd.toISOString() : null;
        }
        await execute(
          'UPDATE users SET dnd_manual_state = ?, dnd_override_until = ?, dnd_override_period = NULL WHERE id = ?',
          [newManual, overrideUntil, client.userId]
        );
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          this.sendToDevice(deviceId, {
            type: 'call_connected',
            callId: `SVC-078-${Date.now()}`,
            calleeNumber: '078',
            calleeName: 'Do Not Disturb Control',
            isSystemLine: true
          });
          const speech = await TtsAudioService.synthesizeSpeech(
            newManual === 1 ? 'Do not disturb is now enabled.' : 'Do not disturb is now disabled.'
          );
          await serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
          this.sendToDevice(deviceId, { type: 'call_ended', reason: 'service_completed' });
        }
      }
      return;
    }

    if (buffer === '079' && client?.userId) {
      const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [client.userId]);
      const isActive = this.isDndActiveForUser(user);
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        this.sendToDevice(deviceId, {
          type: 'call_connected',
          callId: `SVC-079-${Date.now()}`,
          calleeNumber: '079',
          calleeName: 'Do Not Disturb Status',
          isSystemLine: true
        });
        const speech = await TtsAudioService.synthesizeSpeech(
          isActive ? 'Do not disturb is currently active.' : 'Do not disturb is currently off.'
        );
        await serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
        this.sendToDevice(deviceId, { type: 'call_ended', reason: 'service_completed' });
      }
      return;
    }

    // 5. Built-in Service Lines
    if (buffer === '111') {
      if (client?.ws) {
        client.ws.send(
          JSON.stringify({
            type: 'call_connected',
            callId: `SVC-111-${Date.now()}`,
            calleeNumber: '111',
            calleeName: 'Ringback Test Service',
            isSystemLine: true
          })
        );
        await serviceLinesService.startRingbackTestSession(deviceId, client.userId, client.ws);
      }
      return;
    }

    if (buffer === '119' || buffer === '099') {
      if (client?.ws) {
        client.ws.send(
          JSON.stringify({
            type: 'call_connected',
            callId: `SVC-119-${Date.now()}`,
            calleeNumber: '119',
            calleeName: 'Audio Loopback Echo Test',
            isSystemLine: true
          })
        );
        await serviceLinesService.startLoopbackSession(deviceId, client.ws);
      }
      return;
    }

    if (buffer === '411') {
      if (client?.ws) {
        client.ws.send(
          JSON.stringify({
            type: 'call_connected',
            callId: `SVC-411-${Date.now()}`,
            calleeNumber: '411',
            calleeName: 'Speaking Clock Service',
            isSystemLine: true
          })
        );
        await serviceLinesService.startSpeakingClockSession(deviceId, client.ws);
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'call_ended', reason: 'service_completed' }));
        }
      }
      return;
    }

    if (buffer === '567' || buffer === '300') {
      if (client?.ws) {
        client.ws.send(
          JSON.stringify({
            type: 'call_connected',
            callId: `SVC-567-${Date.now()}`,
            calleeNumber: '567',
            calleeName: 'Dial-Up Modem Simulator',
            isSystemLine: true
          })
        );
        await serviceLinesService.startModemHandshakeSession(deviceId, client.ws);
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'call_ended', reason: 'service_completed' }));
        }
      }
      return;
    }

    if (buffer === '611') {
      if (client?.ws) {
        client.ws.send(
          JSON.stringify({
            type: 'call_connected',
            callId: `SVC-611-${Date.now()}`,
            calleeNumber: '611',
            calleeName: 'Line Diagnostics Service',
            isSystemLine: true
          })
        );
        await serviceLinesService.startLineDiagnosticsSession(deviceId, client.ws, client.telemetry);
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'call_ended', reason: 'service_completed' }));
        }
      }
      return;
    }

    if (buffer === '711') {
      if (client?.ws) {
        client.ws.send(
          JSON.stringify({
            type: 'call_connected',
            callId: `SVC-711-${Date.now()}`,
            calleeNumber: '711',
            calleeName: 'Automated Weather Hotline',
            isSystemLine: true
          })
        );
        await serviceLinesService.startWeatherSession(deviceId, client?.ipAddress, client.ws);
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'call_ended', reason: 'service_completed' }));
        }
      }
      return;
    }

    if (buffer === '069' && client?.userId) {
      const lastCall = await queryOne<any>(
        'SELECT caller_number FROM calls WHERE callee_user_id = ? ORDER BY id DESC LIMIT 1',
        [client.userId]
      );
      if (lastCall?.caller_number && lastCall.caller_number !== 'Unknown') {
        await this.initiateCall(deviceId, lastCall.caller_number);
      } else {
        this.sendToDevice(deviceId, { type: 'play_tone', tone: 'reorder' });
      }
      return;
    }

    // 5.5 Home Assistant Rotary Triggers (configured ha_rotary_triggers_json or 90x when MQTT active)
    if (await this.tryHandleHomeAssistantTrigger(deviceId, buffer)) {
      return;
    }

    // 6. Outbound User Extension Call
    await this.initiateCall(deviceId, buffer);
  }

  /**
   * Dispatches configured Home Assistant rotary trigger codes (`ha_rotary_triggers_json` or `90x`) when MQTT is enabled.
   */
  private async tryHandleHomeAssistantTrigger(deviceId: string, buffer: string): Promise<boolean> {
    const client = this.phoneClients.get(deviceId);
    const haSettings = await homeAssistantMqttService.getMqttSettings();
    if (haSettings.enabled !== 'true') {
      return false;
    }

    let triggersMap: Record<string, string> = {};
    try {
      const trigRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['ha_rotary_triggers_json']);
      if (trigRow?.value) {
        triggersMap = JSON.parse(trigRow.value) || {};
      }
    } catch {}

    const explicitLabel = triggersMap[buffer];
    if (!explicitLabel && !/^90\d$/.test(buffer)) {
      return false;
    }

    const existingUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE phone_number = ?', [buffer]);
    if (existingUser) {
      return false;
    }

    homeAssistantMqttService.publishRotaryTrigger(deviceId, buffer, explicitLabel);
    if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(
        JSON.stringify({
          type: 'call_connected',
          callId: `SVC-HA-${Date.now()}`,
          calleeNumber: buffer,
          calleeName: explicitLabel ? `Home Assistant: ${explicitLabel}` : `HA Trigger ${buffer}`,
          isSystemLine: true
        })
      );
      const spoken = await TtsAudioService.synthesizeSpeech(
        `Home Assistant automation ${explicitLabel || buffer} triggered.`
      );
      await serviceLinesService.startRawPcmPlaybackSession(deviceId, spoken, client.ws);
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'call_ended', reason: 'service_completed' }));
      }
    }
    return true;
  }

  // Execute in-call multi-party invite (Digit 3 + Extension) using pendingGroupInvites (NOT pre-adding to participants!)
  private async executeInCallGroupInvite(inviterDeviceId: string, callId: string, targetExtension: string) {
    const call = this.activeCalls.get(callId);
    if (!call || call.state !== 'connected') return;

    const inviterClient = this.phoneClients.get(inviterDeviceId);
    if (!inviterClient?.userId) return;

    const targetUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [targetExtension.trim()]);
    if (!targetUser || targetUser.is_disabled) {
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    if (targetUser.call_privacy === 'closed') {
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    const friendship = await queryOne<any>(
      `SELECT id FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
      [inviterClient.userId, targetUser.id, targetUser.id, inviterClient.userId]
    );

    if (!friendship && targetUser.call_privacy === 'friends_only') {
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    const friendPref = await queryOne<any>(
      'SELECT is_vip, ring_style, ring_cadence_custom FROM friend_preferences WHERE user_id = ? AND friend_id = ?',
      [targetUser.id, inviterClient.userId]
    );

    if (this.isDndActiveForUser(targetUser) && friendPref?.is_vip !== 1) {
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    const targetPhones = await query<any>('SELECT * FROM phones WHERE user_id = ? AND is_online = 1', [targetUser.id]);
    const ringingTarget = targetPhones.find(p => p.ring_enabled !== 0) || targetPhones[0];

    if (!ringingTarget) {
      this.sendToDevice(inviterDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    const existingInvite = this.pendingGroupInvites.get(ringingTarget.device_id);
    if (existingInvite) {
      clearTimeout(existingInvite.timer);
    }

    const inviteTimer = setTimeout(async () => {
      if (this.pendingGroupInvites.has(ringingTarget.device_id)) {
        this.pendingGroupInvites.delete(ringingTarget.device_id);
        this.sendToDevice(ringingTarget.device_id, { type: 'stop_ring' });
        await this.safeUpdatePhoneSql(ringingTarget.device_id, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', ringingTarget.device_id]);
      }
    }, 25000);
    if (typeof inviteTimer.unref === 'function') inviteTimer.unref();

    this.pendingGroupInvites.set(ringingTarget.device_id, {
      callId: call.id,
      inviterDeviceId,
      targetUserId: targetUser.id,
      timer: inviteTimer
    });

    const ringStyle =
      friendPref?.ring_style && friendPref.ring_style !== 'default'
        ? friendPref.ring_style
        : (ringingTarget.ring_style || 'traditional');
    const ringCadence = friendPref?.ring_cadence_custom || ringingTarget.ring_cadence_custom || '2000,4000';

    this.sendToDevice(ringingTarget.device_id, {
      type: 'incoming_call',
      callId: call.id,
      isGroupInvite: true,
      callerNumber: call.callerNumber,
      callerName: `${call.callerName} (Group Call)`,
      ringStyle,
      ringCadence,
      bellFrequencyHz: ringingTarget.bell_frequency_hz ?? 20.0
    });

    this.sendToUserWeb(targetUser.id, {
      type: 'incoming_call',
      callId: call.id,
      isGroupInvite: true,
      calleeUserId: targetUser.id,
      callerNumber: call.callerNumber,
      callerName: `${call.callerName} (Group Call)`
    });

    await this.safeUpdatePhoneSql(ringingTarget.device_id, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', ringingTarget.device_id]);
    console.log(`[Switch] Group invite ringing on ${ringingTarget.device_id} for user ${targetUser.username} (pending answer)`);
  }

  // Initiate Outbound Call (with Call Forwarding hopCount <= 3 loop guard & full CDR lifecycle)
  public async initiateCall(callerDeviceId: string, destinationNumber: string, hopCount = 0): Promise<void> {
    const callerClient = this.phoneClients.get(callerDeviceId);
    const dest = destinationNumber.trim();

    if (!dest) {
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    // Emergency Calling Intercept
    if (EMERGENCY_NUMBERS.has(dest)) {
      await this.handleEmergencyIntercept(callerDeviceId, dest);
      return;
    }

    // Special service lines / feature codes / speed dials / voicemail inbox ('0') / HA 90x
    if (
      ['0', '00', '411', '111', '119', '099', '611', '711', '567', '300', '069', '073', '078', '079'].includes(dest) ||
      dest.startsWith('072') ||
      (hopCount === 0 && /^[1-9]$/.test(dest))
    ) {
      await this.processCompletedDialBuffer(callerDeviceId, dest);
      return;
    }

    const callerUser = callerClient?.userId ? await queryOne<any>('SELECT * FROM users WHERE id = ?', [callerClient.userId]) : null;
    const callerNumber = callerUser?.phone_number || 'Unknown';
    const callerName = callerUser?.display_name || callerUser?.username || 'Caller';

    // Direct dialing own number (when not forwarded) -> Voicemail Inbox
    if (hopCount === 0 && callerUser && callerUser.phone_number === dest) {
      console.log(`[Switch] User on ${callerDeviceId} dialed own number -> Voicemail Inbox`);
      await this.startVoicemailPlaybackSession(callerDeviceId, callerUser.id);
      return;
    }

    // Direct-to-Voicemail Memo ('0' + extension) via softphone / API dial
    if (
      hopCount === 0 &&
      dest.startsWith('0') &&
      dest.length > 1 &&
      !['069', '072', '073', '078', '079', '00', '099'].some(p => dest.startsWith(p))
    ) {
      const exactUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [dest]);
      if (!exactUser) {
        const memoTargetExt = dest.substring(1);
        const memoTargetUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [memoTargetExt]);
        if (memoTargetUser && !memoTargetUser.is_disabled) {
          console.log(`[Switch] Direct-to-Voicemail Memo to extension ${memoTargetExt} by ${callerDeviceId}`);
          await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, memoTargetUser);
          return;
        }
      }
    }

    const calleeUser = await queryOne<any>('SELECT * FROM users WHERE phone_number = ?', [dest]);
    if (!calleeUser) {
      if (hopCount === 0 && (await this.tryHandleHomeAssistantTrigger(callerDeviceId, dest))) {
        return;
      }
      console.log(`[Switch] Call failed: Extension ${dest} not found.`);
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'reorder' });
      return;
    }

    if (calleeUser.is_disabled) {
      await execute(
        `INSERT INTO calls (caller_user_id, callee_user_id, caller_number, callee_number, status, duration_sec, started_at, ended_at)
         VALUES (?, ?, ?, ?, 'busy', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [callerUser?.id || null, calleeUser.id, callerNumber, calleeUser.phone_number]
      );
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'busy' });
      return;
    }

    // Check Call Forwarding on callee's configured phones (with hopCount <= 3 loop guard)
    const allCalleePhones = await query<any>('SELECT * FROM phones WHERE user_id = ? ORDER BY id ASC', [calleeUser.id]);
    const forwardingPhone = allCalleePhones.find(p => p.call_forwarding_enabled === 1 && p.forward_to_number);
    if (forwardingPhone && forwardingPhone.forward_to_number && forwardingPhone.forward_to_number !== calleeUser.phone_number) {
      if (hopCount < 3) {
        console.log(
          `[Switch] Forwarding call for ${calleeUser.phone_number} -> ${forwardingPhone.forward_to_number} (hop ${hopCount + 1})`
        );
        return this.initiateCall(callerDeviceId, forwardingPhone.forward_to_number, hopCount + 1);
      } else {
        console.warn(`[Switch] Call forwarding loop limit (3 hops) reached at ${calleeUser.phone_number}; routing to voicemail.`);
        await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser);
        return;
      }
    }

    // Insert initial 'ringing' CDR row
    const cdrResult = await execute(
      `INSERT INTO calls (caller_user_id, callee_user_id, caller_number, callee_number, status, started_at)
       VALUES (?, ?, ?, ?, 'ringing', CURRENT_TIMESTAMP)`,
      [callerUser?.id || null, calleeUser.id, callerNumber, calleeUser.phone_number]
    );
    const cdrId = cdrResult.lastID;

    // Check Friendship & directional Friend Preferences (callee's preferences for caller)
    const friendship = callerUser
      ? await queryOne<any>(
          `SELECT id FROM friends
           WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
          [calleeUser.id, callerUser.id, callerUser.id, calleeUser.id]
        )
      : null;

    const friendPref = callerUser
      ? await queryOne<any>(
          'SELECT is_vip, ring_style, ring_cadence_custom FROM friend_preferences WHERE user_id = ? AND friend_id = ?',
          [calleeUser.id, callerUser.id]
        )
      : null;

    const isFriend = !!friendship;
    const isVip = friendPref?.is_vip === 1;

    // Call Privacy: 'closed' routes ALL incoming calls directly to voicemail
    if (calleeUser.call_privacy === 'closed') {
      console.log(`[Switch] Callee call_privacy is 'closed'. Routing caller to voicemail.`);
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser, cdrId);
      return;
    }

    // Call Privacy: 'friends_only' routes non-friends to voicemail
    if (calleeUser.call_privacy === 'friends_only' && !isFriend) {
      console.log(`[Switch] Callee only accepts calls from friends. Routing caller to voicemail.`);
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser, cdrId);
      return;
    }

    // DND & 'dnd' Call Privacy Check (VIP bypasses DND; repeated call within 3m breaks through if enabled)
    const isDnd = this.isDndActiveForUser(calleeUser);
    if (isDnd && !isVip) {
      const allowsBreakthrough = calleeUser.dnd_repeated_call_breakthrough !== 0;
      const attemptKey = `${calleeUser.id}_${callerUser?.phone_number || callerDeviceId}`;
      const lastAttempt = this.recentDndAttempts.get(attemptKey);
      const now = Date.now();

      if (allowsBreakthrough && lastAttempt && now - lastAttempt < 180000) {
        console.log(`[Switch] DND Breakthrough! Repeated call from ${callerNumber} within 3 minutes bypassed DND.`);
        this.recentDndAttempts.delete(attemptKey);
      } else {
        if (allowsBreakthrough) {
          this.recentDndAttempts.set(attemptKey, now);
        }
        console.log(`[Switch] Callee is in Do Not Disturb and caller is not VIP. Routing to voicemail.`);
        await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser, cdrId);
        return;
      }
    }

    // Find all online hardware phones + active non-monitor web softphone clients for callee
    const calleePhones = allCalleePhones.filter(p => p.is_online === 1);
    const calleeWebSoftphones: string[] = [];
    for (const [devId, cl] of this.phoneClients.entries()) {
      if (cl.isWebSoftphone && !cl.isMonitorOnly && cl.userId === calleeUser.id && cl.ws.readyState === WebSocket.OPEN) {
        calleeWebSoftphones.push(devId);
      }
    }

    if (calleePhones.length === 0 && calleeWebSoftphones.length === 0) {
      console.log(`[Switch] Callee has no online phones or softphones -> routing to voicemail`);
      await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser, cdrId);
      return;
    }

    const enabledPhones = calleePhones.filter(p => p.ring_enabled !== 0);
    const phonesToRing = enabledPhones.length > 0 ? enabledPhones : calleePhones;
    const primaryPhone = phonesToRing[0];

    // Call Waiting Check across ANY active connected device (hardware or web softphone) owned by callee
    let busyDeviceId: string | null = null;
    for (const activeCall of this.activeCalls.values()) {
      if (activeCall.state === 'connected') {
        for (const devId of this.getCallConnectedPeerDevices(activeCall)) {
          const cl = this.phoneClients.get(devId);
          if (cl && !cl.isMonitorOnly && cl.userId === calleeUser.id && devId !== callerDeviceId) {
            busyDeviceId = devId;
            break;
          }
        }
        if (busyDeviceId) break;
      }
    }

    if (busyDeviceId) {
      console.log(`[Switch] Callee active on ${busyDeviceId}. Sending in-ear call waiting tone.`);
      this.sendToDevice(busyDeviceId, {
        type: 'play_tone',
        tone: 'call_waiting',
        callerNumber,
        callerName
      });
      this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'ringback' });

      const ringTimeoutSec = primaryPhone?.ring_timeout_sec || 25;
      const ringTimer = setTimeout(async () => {
        if (this.waitingCalls.get(busyDeviceId!)?.callerDeviceId === callerDeviceId) {
          this.waitingCalls.delete(busyDeviceId!);
          await this.routeToVoicemail(callerDeviceId, callerUser?.id, callerNumber, callerName, calleeUser, cdrId);
        }
      }, ringTimeoutSec * 1000);
      if (typeof ringTimer.unref === 'function') ringTimer.unref();

      this.waitingCalls.set(busyDeviceId, {
        callerDeviceId,
        callerUserId: callerUser?.id,
        callerNumber,
        callerName,
        calleeUser,
        cdrId,
        ringTimeoutTimer: ringTimer
      });
      return;
    }

    const callId = crypto.randomUUID();
    const sessionKey = crypto.randomBytes(16).toString('hex');

    const ringStyle =
      friendPref?.ring_style && friendPref.ring_style !== 'default'
        ? friendPref.ring_style
        : (primaryPhone?.ring_style || 'traditional');
    const ringCadence = friendPref?.ring_cadence_custom || primaryPhone?.ring_cadence_custom || '2000,4000';

    const allRingingIds = new Set<string>([
      ...phonesToRing.map(p => p.device_id),
      ...calleeWebSoftphones
    ]);

    const primaryTargetDeviceId = primaryPhone?.device_id || calleeWebSoftphones[0];

    const newCall: ActiveCall = {
      id: callId,
      cdrId,
      callerDeviceId,
      callerUserId: callerUser?.id,
      callerNumber,
      callerName,
      calleeDeviceId: primaryTargetDeviceId,
      calleeUserId: calleeUser.id,
      calleeNumber: calleeUser.phone_number,
      calleeName: calleeUser.display_name || calleeUser.username,
      sessionKey,
      keyLeaderDeviceId: callerDeviceId,
      participantPubKeys: new Map(),
      state: 'ringing',
      startedAt: Date.now(),
      participantUserIds: new Set([callerUser?.id, calleeUser.id].filter(Boolean) as number[]),
      ringingDevices: allRingingIds
    };

    const ringTimeoutSec = primaryPhone?.ring_timeout_sec || 25;
    newCall.ringTimeoutTimer = setTimeout(async () => {
      await this.terminateCall(callId, 'timeout', undefined, true);
    }, ringTimeoutSec * 1000);
    if (typeof newCall.ringTimeoutTimer.unref === 'function') newCall.ringTimeoutTimer.unref();

    this.activeCalls.set(callId, newCall);
    this.indexCallDevices(newCall);

    for (const p of phonesToRing) {
      const effectiveStyle =
        friendPref?.ring_style && friendPref.ring_style !== 'default'
          ? friendPref.ring_style
          : (p.ring_style || ringStyle);
      const effectiveCadence = friendPref?.ring_cadence_custom || p.ring_cadence_custom || ringCadence;

      this.sendToDevice(p.device_id, {
        type: 'incoming_call',
        callId,
        callerNumber: newCall.callerNumber,
        callerName: newCall.callerName,
        ringStyle: effectiveStyle,
        ringCadence: effectiveCadence,
        bellFrequencyHz: p.bell_frequency_hz ?? 20.0
      });
      await this.safeUpdatePhoneSql(p.device_id, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['ringing', p.device_id]);
    }

    for (const webDevId of calleeWebSoftphones) {
      this.sendToDevice(webDevId, {
        type: 'incoming_call',
        callId,
        callerNumber: newCall.callerNumber,
        callerName: newCall.callerName,
        ringStyle,
        ringCadence
      });
    }

    // Notify ONLY caller and callee web dashboards
    this.sendToUserWeb(calleeUser.id, {
      type: 'incoming_call',
      callId,
      calleeUserId: calleeUser.id,
      callerNumber: newCall.callerNumber,
      callerName: newCall.callerName
    });

    if (callerUser?.id && callerUser.id !== calleeUser.id) {
      this.sendToUserWeb(callerUser.id, {
        type: 'call_state_change',
        callId,
        state: 'ringing',
        callerNumber: newCall.callerNumber,
        callerName: newCall.callerName,
        calleeNumber: newCall.calleeNumber,
        calleeName: newCall.calleeName
      });
    }

    this.sendToDevice(callerDeviceId, { type: 'play_tone', tone: 'ringback' });
    await this.safeUpdatePhoneSql(callerDeviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['dialing', callerDeviceId]);
  }

  // Answer Incoming Call (or Pending Group Invite)
  public async handleCallAnswer(deviceId: string, callId?: string): Promise<boolean> {
    const pendingInvite = this.pendingGroupInvites.get(deviceId);
    if (pendingInvite) {
      clearTimeout(pendingInvite.timer);
      this.pendingGroupInvites.delete(deviceId);
      this.sendToDevice(deviceId, { type: 'stop_ring' });
      const invitedCall = this.activeCalls.get(pendingInvite.callId);
      if (invitedCall && invitedCall.state === 'connected') {
        await this.joinPartyLineCall(invitedCall, deviceId);
        return true;
      }
    }

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
      // Verify device belongs to callee user (or ringingDevices)
      const client = this.phoneClients.get(deviceId);
      if (
        call.calleeDeviceId === deviceId ||
        call.ringingDevices?.has(deviceId) ||
        (client?.userId && client.userId === call.calleeUserId)
      ) {
        await this.connectCall(call, deviceId);
        return true;
      }
    }
    return false;
  }

  private async cleanupCallerFromWaitingCalls(callerDeviceId: string): Promise<void> {
    for (const [calleeDevId, waiting] of Array.from(this.waitingCalls.entries())) {
      if (waiting.callerDeviceId === callerDeviceId) {
        if (waiting.ringTimeoutTimer) clearTimeout(waiting.ringTimeoutTimer);
        this.waitingCalls.delete(calleeDevId);
        if (waiting.cdrId) {
          await execute(
            "UPDATE calls SET status = 'missed', duration_sec = 0, ended_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ringing'",
            [waiting.cdrId]
          ).catch(() => {});
        }
      }
    }
  }

  private async acceptWaitingCall(calleeDeviceId: string, waiting: WaitingCall): Promise<void> {
    if (waiting.ringTimeoutTimer) clearTimeout(waiting.ringTimeoutTimer);
    this.waitingCalls.delete(calleeDeviceId);

    const currentCall = this.findCallByDevice(calleeDeviceId);
    if (currentCall) {
      await this.terminateCall(currentCall.id, 'swapped', calleeDeviceId);
    }

    const callerClient = this.phoneClients.get(waiting.callerDeviceId);
    if (!callerClient || callerClient.ws.readyState !== WebSocket.OPEN) {
      if (waiting.cdrId) {
        await execute(
          "UPDATE calls SET status = 'missed', duration_sec = 0, ended_at = CURRENT_TIMESTAMP WHERE id = ?",
          [waiting.cdrId]
        ).catch(() => {});
      }
      return;
    }

    const bridgedCall: ActiveCall = {
      id: crypto.randomUUID(),
      cdrId: waiting.cdrId,
      callerDeviceId: waiting.callerDeviceId,
      callerUserId: waiting.callerUserId,
      callerNumber: waiting.callerNumber,
      callerName: waiting.callerName,
      calleeDeviceId,
      calleeUserId: waiting.calleeUser.id,
      calleeNumber: waiting.calleeUser.phone_number,
      calleeName: waiting.calleeUser.display_name || waiting.calleeUser.username,
      sessionKey: crypto.randomBytes(16).toString('hex'),
      keyLeaderDeviceId: waiting.callerDeviceId,
      participantPubKeys: new Map(),
      state: 'ringing',
      startedAt: Date.now(),
      participantUserIds: new Set([waiting.callerUserId, waiting.calleeUser.id].filter(Boolean) as number[])
    };

    this.activeCalls.set(bridgedCall.id, bridgedCall);
    await this.connectCall(bridgedCall, calleeDeviceId);
  }

  public async declineToVoicemail(deviceId: string, callId?: string): Promise<boolean> {
    const client = this.phoneClients.get(deviceId);
    let call = callId ? this.activeCalls.get(callId) : undefined;
    if (!call) {
      call = this.findRingingCallForUserOrDevice(deviceId, client?.userId);
    }
    if (!call || call.state !== 'ringing') return false;

    const authorized =
      call.calleeDeviceId === deviceId ||
      call.ringingDevices?.has(deviceId) ||
      (client?.userId && client.userId === call.calleeUserId);
    if (!authorized) return false;

    if (call.ringTimeoutTimer) {
      clearTimeout(call.ringTimeoutTimer);
      call.ringTimeoutTimer = undefined;
    }
    this.activeCalls.delete(call.id);
    this.unindexCallDevices(call);

    if (call.ringingDevices) {
      for (const rDevId of call.ringingDevices) {
        this.sendToDevice(rDevId, { type: 'stop_ring' });
        await this.safeUpdatePhoneSql(rDevId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', rDevId]);
      }
    }

    this.sendCallEventToWeb(call, {
      type: 'call_ended',
      callId: call.id,
      reason: 'declined_to_voicemail'
    });

    const calleeUser = call.calleeUserId
      ? await queryOne<any>('SELECT * FROM users WHERE id = ?', [call.calleeUserId])
      : null;

    if (calleeUser) {
      await this.routeToVoicemail(
        call.callerDeviceId,
        call.callerUserId,
        call.callerNumber,
        call.callerName,
        calleeUser,
        call.cdrId
      );
      return true;
    }
    return false;
  }

  public async answerForUser(userId: number, requestedDeviceId?: string, callId?: string): Promise<boolean> {
    for (const [devId, inv] of this.pendingGroupInvites.entries()) {
      if (inv.targetUserId === userId && (!requestedDeviceId || requestedDeviceId === devId)) {
        return this.handleCallAnswer(devId, inv.callId);
      }
    }

    let targetCall: ActiveCall | undefined;
    if (callId) {
      const candidate = this.activeCalls.get(callId);
      if (candidate && candidate.calleeUserId === userId && candidate.state === 'ringing') {
        targetCall = candidate;
      }
    }
    if (!targetCall) {
      for (const c of this.activeCalls.values()) {
        if (c.state === 'ringing' && c.calleeUserId === userId) {
          targetCall = c;
          break;
        }
      }
    }
    if (!targetCall) return false;

    let answerDevId = requestedDeviceId;
    if (answerDevId) {
      const cl = this.phoneClients.get(answerDevId);
      if (!cl || cl.userId !== userId || cl.isMonitorOnly) {
        answerDevId = undefined;
      }
    }
    if (!answerDevId) {
      answerDevId = this.findActiveWebSoftphoneDeviceId(userId) || undefined;
    }
    if (!answerDevId) {
      answerDevId = targetCall.calleeDeviceId;
    }

    await this.connectCall(targetCall, answerDevId);
    return true;
  }

  public async hangupAllForUser(userId: number): Promise<void> {
    const userDevices = new Set<string>();
    const phones = await query<any>('SELECT device_id FROM phones WHERE user_id = ?', [userId]);
    for (const p of phones) {
      if (p.device_id) userDevices.add(p.device_id);
    }
    for (const [devId, cl] of this.phoneClients.entries()) {
      if (cl.userId === userId) {
        userDevices.add(devId);
      }
    }

    for (const devId of userDevices) {
      await this.handleCallHangup(devId);
    }

    // Also terminate any ringing incoming/outgoing calls belonging to userId
    for (const call of Array.from(this.activeCalls.values())) {
      if (call.callerUserId === userId || call.calleeUserId === userId) {
        await this.terminateCall(call.id, 'hangup');
      }
    }
  }

  // Connect Call & Start E2EE Audio Negotiation
  public async connectCall(call: ActiveCall, answeringDeviceId?: string) {
    if (call.ringTimeoutTimer) {
      clearTimeout(call.ringTimeoutTimer);
      call.ringTimeoutTimer = undefined;
    }

    if (answeringDeviceId) {
      call.calleeDeviceId = answeringDeviceId;
    }

    if (!call.keyLeaderDeviceId) {
      call.keyLeaderDeviceId = call.callerDeviceId;
    }

    if (call.isIntercom || call.isGroupCall) {
      if (!call.participants) {
        call.participants = new Set([call.callerDeviceId]);
      }
      if (call.calleeDeviceId) {
        call.participants.add(call.calleeDeviceId);
      }
    }

    call.state = 'connected';
    call.connectedAt = Date.now();
    this.indexCallDevices(call);

    this.sendToDevice(call.callerDeviceId, { type: 'stop_tone' });

    if (call.ringingDevices) {
      for (const devId of call.ringingDevices) {
        this.sendToDevice(devId, { type: 'stop_ring' });
        if (devId !== call.calleeDeviceId) {
          if (this.deviceToCall.get(devId)?.id === call.id && devId !== call.callerDeviceId) {
            this.deviceToCall.delete(devId);
          }
          await this.safeUpdatePhoneSql(devId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', devId]);
        }
      }
    } else if (call.calleeDeviceId) {
      this.sendToDevice(call.calleeDeviceId, { type: 'stop_ring' });
    }

    const callerSlot = this.getOrAssignCallSlot(call, call.callerDeviceId);
    const calleeSlot = call.calleeDeviceId ? this.getOrAssignCallSlot(call, call.calleeDeviceId) : 1;

    this.sendToDevice(call.callerDeviceId, {
      type: 'call_connected',
      callId: call.id,
      isKeyLeader: call.callerDeviceId === call.keyLeaderDeviceId,
      senderSlot: callerSlot,
      isGroupCall: !!call.isGroupCall,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName,
      sessionKey: call.sessionKey
    });

    if (call.calleeDeviceId) {
      this.sendToDevice(call.calleeDeviceId, {
        type: 'call_connected',
        callId: call.id,
        isKeyLeader: call.calleeDeviceId === call.keyLeaderDeviceId,
        senderSlot: calleeSlot,
        isGroupCall: !!call.isGroupCall,
        callerNumber: call.callerNumber,
        callerName: call.callerName,
        sessionKey: call.sessionKey
      });
    }

    this.sendCallEventToWeb(call, {
      type: 'call_state_change',
      callId: call.id,
      state: 'connected',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName
    });

    await this.safeUpdatePhoneSql(call.callerDeviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', call.callerDeviceId]);
    if (call.calleeDeviceId) {
      await this.safeUpdatePhoneSql(call.calleeDeviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', call.calleeDeviceId]);
    }

    if (call.cdrId) {
      await execute('UPDATE calls SET status = ? WHERE id = ?', ['connected', call.cdrId]);
    } else if (!call.isIntercom) {
      const cdrRes = await execute(
        `INSERT INTO calls (caller_user_id, callee_user_id, caller_number, callee_number, status, started_at)
         VALUES (?, ?, ?, ?, 'connected', CURRENT_TIMESTAMP)`,
        [call.callerUserId || null, call.calleeUserId || null, call.callerNumber, call.calleeNumber]
      );
      call.cdrId = cdrRes.lastID;
    }

    console.log(`[Switch] Call ${call.id} CONNECTED between ${call.callerNumber} and ${call.calleeNumber} (Answered by ${call.calleeDeviceId})`);
  }

  // Route to Zero-Access Voicemail
  public async routeToVoicemail(
    callerDeviceId: string,
    callerUserId: number | undefined,
    callerNumber: string,
    callerName: string,
    calleeUser: any,
    existingCdrId?: number
  ) {
    const callId = crypto.randomUUID();

    const freshCallee =
      (await queryOne<any>('SELECT * FROM users WHERE id = ?', [calleeUser.id])) || calleeUser;

    // Require recipient to have initialized their ECIES public key so voicemails remain permanently decryptable
    if (!freshCallee.encryption_public_key) {
      if (existingCdrId) {
        await execute("UPDATE calls SET status = 'missed', ended_at = CURRENT_TIMESTAMP WHERE id = ?", [existingCdrId]);
      }
      const callerClient = this.phoneClients.get(callerDeviceId);
      this.sendToDevice(callerDeviceId, {
        type: 'call_connected',
        callId,
        calleeNumber: freshCallee.phone_number,
        calleeName: `${freshCallee.display_name || freshCallee.username} Mailbox`,
        isSystemLine: true
      });
      if (callerClient?.ws && callerClient.ws.readyState === WebSocket.OPEN) {
        const msg = await TtsAudioService.synthesizeSpeech(
          'This extension has not initialized its encrypted voicemail mailbox yet. Goodbye.'
        );
        await serviceLinesService.startRawPcmPlaybackSession(callerDeviceId, msg, callerClient.ws);
      }
      this.sendToDevice(callerDeviceId, { type: 'call_ended', callId, reason: 'mailbox_uninitialized' });
      return;
    }

    let cdrId = existingCdrId;
    if (cdrId) {
      await execute('UPDATE calls SET status = ? WHERE id = ?', ['voicemail', cdrId]);
    } else {
      const cdrRes = await execute(
        `INSERT INTO calls (caller_user_id, callee_user_id, caller_number, callee_number, status, started_at)
         VALUES (?, ?, ?, ?, 'voicemail', CURRENT_TIMESTAMP)`,
        [callerUserId || null, freshCallee.id, callerNumber, freshCallee.phone_number]
      );
      cdrId = cdrRes.lastID;
    }

    const vmCall: ActiveCall = {
      id: callId,
      cdrId,
      callerDeviceId,
      callerUserId,
      callerNumber,
      callerName,
      calleeDeviceId: '',
      calleeUserId: freshCallee.id,
      calleeNumber: freshCallee.phone_number,
      calleeName: freshCallee.display_name || freshCallee.username,
      sessionKey: '',
      keyLeaderDeviceId: callerDeviceId,
      participantPubKeys: new Map(),
      state: 'voicemail',
      startedAt: Date.now(),
      voicemailChunks: [],
      voicemailBytesRecorded: 0,
      participantUserIds: new Set([callerUserId, freshCallee.id].filter(Boolean) as number[])
    };

    this.activeCalls.set(callId, vmCall);
    this.deviceToCall.set(callerDeviceId, vmCall);
    this.activeVoicemailSessions.set(freshCallee.id, vmCall);

    this.sendToDevice(callerDeviceId, { type: 'stop_tone' });

    // Send standard system line call_connected + voicemail_start metadata
    this.sendToDevice(callerDeviceId, {
      type: 'call_connected',
      callId,
      calleeNumber: freshCallee.phone_number,
      calleeName: `${freshCallee.display_name || freshCallee.username} Voicemail`,
      isSystemLine: true,
      isVoicemail: true
    });

    this.sendToDevice(callerDeviceId, {
      type: 'voicemail_start',
      callId,
      recipientPublicKey: freshCallee.encryption_public_key || null,
      maxDurationSec: 300
    });

    vmCall.ringTimeoutTimer = setTimeout(async () => {
      await this.terminateCall(callId, 'voicemail_max_timeout');
    }, 300000);
    if (typeof vmCall.ringTimeoutTimer.unref === 'function') vmCall.ringTimeoutTimer.unref();

    await this.safeUpdatePhoneSql(callerDeviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', callerDeviceId]);

    this.sendCallEventToWeb(vmCall, {
      type: 'voicemail_recording_started',
      callId,
      callerNumber,
      calleeNumber: freshCallee.phone_number
    });

    // Stream custom greeting WAV (decoded to 16kHz s16le) or synthesized TTS greeting + 800Hz beep as [0x00] frames
    const callerClient = this.phoneClients.get(callerDeviceId);
    if (callerClient?.ws && callerClient.ws.readyState === WebSocket.OPEN) {
      (async () => {
        try {
          let greetingPcm: Buffer | null = null;
          const greetingRow = await queryOne<any>(
            'SELECT audio_url FROM voicemail_greetings WHERE user_id = ?',
            [freshCallee.id]
          );
          if (greetingRow?.audio_url) {
            const filename = path.basename(greetingRow.audio_url);
            const greetingPath = path.join(GREETINGS_DIR, filename);
            if (fs.existsSync(greetingPath)) {
              const wavBuf = await fs.promises.readFile(greetingPath);
              greetingPcm = VoicemailCryptoService.decodeWavTo16kMonoPcm(wavBuf);
            }
          }
          if (!greetingPcm || greetingPcm.length === 0) {
            greetingPcm = await TtsAudioService.synthesizeSpeech(
              `Please leave a message for ${freshCallee.display_name || freshCallee.username} at extension ${freshCallee.phone_number} after the tone.`,
              undefined,
              { cache: false }
            );
          }
          const preBeepSilence = Buffer.alloc(Math.floor(TtsAudioService.SAMPLE_RATE * 0.25) * 2);
          const beep = TtsAudioService.generateSineTone(800, 350, 0.5);
          const fullPrompt = Buffer.concat([greetingPcm, preBeepSilence, beep]);

          if (this.activeCalls.has(callId) && callerClient.ws.readyState === WebSocket.OPEN) {
            await serviceLinesService.startRawPcmPlaybackSession(callerDeviceId, fullPrompt, callerClient.ws);
          }
        } catch (err) {
          console.error('[Switch] Error streaming voicemail greeting:', err);
        }
      })();
    }
  }

  private async sealAndSaveVoicemail(call: ActiveCall): Promise<number> {
    if (!call.voicemailChunks || call.voicemailChunks.length === 0 || !call.calleeUserId) {
      return 0;
    }

    const chunks = call.voicemailChunks;
    call.voicemailChunks = [];
    call.voicemailBytesRecorded = 0;

    const pcmBuffer = Buffer.concat(chunks);
    for (const ch of chunks) {
      ch.fill(0);
    }

    if (pcmBuffer.length === 0) return 0;

    const durationSec = Math.max(1, Math.round(pcmBuffer.length / 32000));
    const wavBuffer = VoicemailCryptoService.createWavBuffer(pcmBuffer);
    pcmBuffer.fill(0);

    ensureDirectories();

    const calleeUser = await queryOne<any>('SELECT * FROM users WHERE id = ?', [call.calleeUserId]);
    if (!calleeUser || !calleeUser.encryption_public_key) {
      console.warn(`[Switch] Cannot save voicemail for user ${call.calleeUserId}: missing encryption_public_key.`);
      wavBuffer.fill(0);
      return 0;
    }

    const sealed = VoicemailCryptoService.sealAudioForRecipient(wavBuffer, calleeUser.encryption_public_key);
    const filename = `vm_${calleeUser.id}_${crypto.randomUUID()}.enc`;
    const encFilePath = path.join(VOICEMAILS_DIR, filename);

    await fs.promises.writeFile(encFilePath, sealed.ciphertext, { mode: 0o600 });
    sealed.ciphertext.fill(0);

    const insertRes = await execute(
      `INSERT INTO voicemails (
         user_id, caller_user_id, caller_number, audio_url, duration_sec,
         is_read, is_encrypted, encryption_iv, encryption_tag, ephemeral_public_key
       ) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
      [
        calleeUser.id,
        call.callerUserId || null,
        call.callerNumber,
        filename,
        durationSec,
        sealed.iv,
        sealed.tag,
        sealed.ephemeralPublicKey
      ]
    );

    console.log(`[Switch] Zero-access ECIES voicemail ${insertRes.lastID} sealed for user ${calleeUser.id} (${durationSec}s)`);

    this.sendToUserWeb(calleeUser.id, {
      type: 'voicemail_received',
      voicemailId: insertRes.lastID,
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      durationSec
    });

    if (calleeUser.notify_on_voicemail && calleeUser.email) {
      getSafePublicBaseUrl()
        .then(baseUrl =>
          EmailService.sendVoicemailNotification(
            calleeUser.email,
            calleeUser,
            call.callerNumber,
            call.callerName,
            durationSec,
            baseUrl
          )
        )
        .catch(err => console.error('[Switch] Voicemail notification email failed:', err));
    }

    return durationSec;
  }

  // Interactive Zero-Access Voicemail Playback (Dial 0) with Chunked [0x03] Streaming & Rotary Controls
  public async startVoicemailPlaybackSession(deviceId: string, userId: number) {
    const client = this.phoneClients.get(deviceId);
    if (!client?.ws || client.ws.readyState !== WebSocket.OPEN) return;

    const sessionCallId = `VM-INBOX-${Date.now()}`;
    const vmState: VmInboxSessionState = {};
    this.activeVmInboxSessions.set(deviceId, vmState);

    this.sendToDevice(deviceId, { type: 'stop_tone' });
    this.sendToDevice(deviceId, {
      type: 'call_connected',
      callId: sessionCallId,
      calleeNumber: '0',
      calleeName: 'Voicemail Inbox',
      isSystemLine: true
    });

    try {
      const voicemails = await query<any>(
        `SELECT id, caller_number, audio_url, duration_sec, is_read, is_encrypted,
                encryption_iv, encryption_tag, ephemeral_public_key, created_at
         FROM voicemails
         WHERE user_id = ?
         ORDER BY id DESC LIMIT 15`,
        [userId]
      );

      if (voicemails.length === 0) {
        const speech = await TtsAudioService.synthesizeSpeech('You have no messages in your voicemail inbox.');
        await serviceLinesService.startRawPcmPlaybackSession(deviceId, speech, client.ws);
        if (this.activeVmInboxSessions.has(deviceId)) {
          this.sendToDevice(deviceId, { type: 'call_ended', callId: sessionCallId, reason: 'service_completed' });
        }
        return;
      }

      const countText = `You have ${voicemails.length} ${voicemails.length === 1 ? 'message' : 'messages'} in your voicemail inbox. Dial 1 to replay, 3 for next, or 7 to delete.`;
      const countSpeech = await TtsAudioService.synthesizeSpeech(countText, undefined, { cache: false });
      const shortPause = Buffer.alloc(Math.floor(TtsAudioService.SAMPLE_RATE * 0.4) * 2);
      await serviceLinesService.streamAudioBuffer(client.ws, Buffer.concat([countSpeech, shortPause]), deviceId);

      for (let i = 0; i < voicemails.length; i++) {
        if (!this.activeVmInboxSessions.has(deviceId) || client.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const vm = voicemails[i];
        vmState.command = undefined;
        vmState.activeVmId = vm.id;
        vmState.playbackDoneVmId = undefined;

        const callerText = `Message ${i + 1} from extension ${vm.caller_number}.`;
        const headerSpeech = await TtsAudioService.synthesizeSpeech(callerText, undefined, { cache: false });
        const pipTone = TtsAudioService.generateSineTone(800, 200, 0.45);
        await serviceLinesService.streamAudioBuffer(
          client.ws,
          Buffer.concat([headerSpeech, pipTone, shortPause]),
          deviceId
        );

        if (!this.activeVmInboxSessions.has(deviceId) || client.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        if (vmState.command === 'replay') {
          i--;
          continue;
        }
        if (vmState.command === 'next') {
          continue;
        }

        if (vm.ephemeral_public_key && vm.audio_url && !vm.audio_url.startsWith('data:')) {
          const encPath = path.join(VOICEMAILS_DIR, path.basename(vm.audio_url));
          if (fs.existsSync(encPath)) {
            const rawEnc = await fs.promises.readFile(encPath);

            // Chunked [0x03] streaming avoids Base64 inflation, 2MB WS frame limit, and ESP32 RAM spikes
            client.ws.send(
              JSON.stringify({
                type: 'voicemail_stream_start',
                vmId: vm.id,
                ephemeralPublicKey: vm.ephemeral_public_key,
                iv: vm.encryption_iv,
                tag: vm.encryption_tag,
                totalBytes: rawEnc.length,
                durationSec: vm.duration_sec || 1,
                format: 'wav_enc'
              })
            );

            const CHUNK_SIZE = 32768;
            let seq = 0;
            for (let offset = 0; offset < rawEnc.length; offset += CHUNK_SIZE) {
              if (!this.activeVmInboxSessions.has(deviceId) || client.ws.readyState !== WebSocket.OPEN || vmState.command) {
                break;
              }
              const end = Math.min(offset + CHUNK_SIZE, rawEnc.length);
              const isLast = end >= rawEnc.length ? 1 : 0;
              const slice = rawEnc.subarray(offset, end);
              const frame = Buffer.allocUnsafe(8 + slice.length);
              frame[0] = 0x03;
              frame.writeUInt32BE(vm.id >>> 0, 1);
              frame.writeUInt16BE(seq & 0xffff, 5);
              frame[7] = isLast;
              slice.copy(frame, 8);
              client.ws.send(frame);
              seq++;
              await new Promise<void>((r) => setImmediate(r));
            }

            // Wait for client voicemail_playback_done ACK, rotary menu interrupt, or duration-scaled safety timeout (uncapped!)
            if (!vmState.command && this.activeVmInboxSessions.has(deviceId) && client.ws.readyState === WebSocket.OPEN) {
              const timeoutMs = Math.max(15000, (vm.duration_sec || 2) * 1000 + 8000);
              await new Promise<void>((resolve) => {
                if (vmState.playbackDoneVmId === vm.id || vmState.command || !this.activeVmInboxSessions.has(deviceId)) {
                  return resolve();
                }
                const t = setTimeout(() => {
                  vmState.wakeFn = undefined;
                  resolve();
                }, timeoutMs);
                if (typeof t.unref === 'function') t.unref();
                vmState.wakeFn = () => {
                  clearTimeout(t);
                  vmState.wakeFn = undefined;
                  resolve();
                };
              });
            }
          }
        } else if (vm.audio_url && vm.audio_url.startsWith('data:audio/pcm;base64,')) {
          const pcm = Buffer.from(vm.audio_url.replace('data:audio/pcm;base64,', ''), 'base64');
          await serviceLinesService.streamAudioBuffer(client.ws, pcm, deviceId);
        }

        if (!this.activeVmInboxSessions.has(deviceId) || client.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const postCmd = (this.activeVmInboxSessions.get(deviceId) || vmState).command;
        if (postCmd === 'replay') {
          i--;
          continue;
        }
        if (postCmd === 'delete') {
          await execute('UPDATE voicemails SET is_read = 1 WHERE id = ? AND user_id = ?', [vm.id, userId]);
          await execute('DELETE FROM voicemails WHERE id = ? AND user_id = ?', [vm.id, userId]);
          if (vm.audio_url && !String(vm.audio_url).startsWith('data:')) {
            try {
              const encPath = path.join(VOICEMAILS_DIR, path.basename(vm.audio_url));
              if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
            } catch {}
          }
          const delSpeech = await TtsAudioService.synthesizeSpeech('Message deleted.');
          await serviceLinesService.streamAudioBuffer(client.ws, delSpeech, deviceId);
          continue;
        }

        await execute('UPDATE voicemails SET is_read = 1 WHERE id = ? AND user_id = ?', [vm.id, userId]);
        if (postCmd === 'keep') {
          const savedSpeech = await TtsAudioService.synthesizeSpeech('Message saved.');
          await serviceLinesService.streamAudioBuffer(client.ws, savedSpeech, deviceId);
        }
      }

      if (this.activeVmInboxSessions.has(deviceId) && client.ws.readyState === WebSocket.OPEN) {
        const outro = await TtsAudioService.synthesizeSpeech('End of messages.');
        await serviceLinesService.streamAudioBuffer(client.ws, outro, deviceId);
        this.sendToDevice(deviceId, { type: 'call_ended', callId: sessionCallId, reason: 'service_completed' });
      }
    } finally {
      this.activeVmInboxSessions.delete(deviceId);
    }
  }

  // Terminate Call & Finalize CDR + Voicemail Sealing + Missed Call Emails
  public async terminateCall(callId: string, reason: string, hangingUpDeviceId?: string, routeVoicemailOnTimeout = false) {
    const call = this.activeCalls.get(callId);
    if (!call) return;

    if (call.ringTimeoutTimer) {
      clearTimeout(call.ringTimeoutTimer);
      call.ringTimeoutTimer = undefined;
    }

    if (call.calleeUserId && this.activeVoicemailSessions.get(call.calleeUserId)?.id === call.id) {
      this.activeVoicemailSessions.delete(call.calleeUserId);
    }

    // Seal & save zero-access voicemail audio on hangup
    let recordedVmDuration = 0;
    if (call.state === 'voicemail') {
      serviceLinesService.stopRawPcmPlaybackSession(call.callerDeviceId);
      recordedVmDuration = await this.sealAndSaveVoicemail(call);
    }

    // Multi-party group call: if >1 participants remain, keep others connected and rotate keyLeader if needed!
    if (call.state === 'connected' && call.isGroupCall && call.participants && hangingUpDeviceId && call.participants.has(hangingUpDeviceId)) {
      call.participants.delete(hangingUpDeviceId);
      call.participantPubKeys.delete(hangingUpDeviceId);
      if (this.deviceToCall.get(hangingUpDeviceId)?.id === call.id) {
        this.deviceToCall.delete(hangingUpDeviceId);
      }

      serviceLinesService.stopRawPcmPlaybackSession(hangingUpDeviceId);
      this.sendToDevice(hangingUpDeviceId, { type: 'call_ended', callId: call.id, reason });
      await this.safeUpdatePhoneSql(hangingUpDeviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', hangingUpDeviceId]);

      if (call.participants.size > 1) {
        let leaderChanged = false;
        if (call.keyLeaderDeviceId === hangingUpDeviceId) {
          const nextLeader = call.participants.values().next().value;
          if (nextLeader) {
            call.keyLeaderDeviceId = nextLeader;
            leaderChanged = true;
          }
        }
        for (const remDevId of call.participants) {
          this.sendToDevice(remDevId, {
            type: 'participant_left',
            callId: call.id,
            deviceId: hangingUpDeviceId,
            keyLeaderDeviceId: call.keyLeaderDeviceId,
            isKeyLeader: remDevId === call.keyLeaderDeviceId
          });
          if (leaderChanged) {
            this.sendToDevice(remDevId, {
              type: 'e2ee_leader_changed',
              callId: call.id,
              newKeyLeaderDeviceId: call.keyLeaderDeviceId,
              isKeyLeader: remDevId === call.keyLeaderDeviceId
            });
          }
        }
        console.log(`[Switch] Participant ${hangingUpDeviceId} left Group Call ${call.id}. ${call.participants.size} remaining.`);
        return;
      }
    }

    // Cancel any pending group invites targeting this call
    for (const [invDevId, inv] of this.pendingGroupInvites.entries()) {
      if (inv.callId === call.id) {
        clearTimeout(inv.timer);
        this.pendingGroupInvites.delete(invDevId);
        this.sendToDevice(invDevId, { type: 'stop_ring' });
        await this.safeUpdatePhoneSql(invDevId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', invDevId]);
      }
    }

    // End call completely
    this.activeCalls.delete(callId);
    this.unindexCallDevices(call);

    // If ringing timed out and we are routing caller into voicemail, transition cleanly without hanging up caller!
    if (routeVoicemailOnTimeout && !call.connectedAt && call.calleeUserId && !call.isIntercom) {
      if (call.ringingDevices) {
        for (const devId of call.ringingDevices) {
          this.sendToDevice(devId, { type: 'stop_ring' });
          await this.safeUpdatePhoneSql(devId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', devId]);
        }
      }
      const calleeUser = await queryOne<any>('SELECT * FROM users WHERE id = ?', [call.calleeUserId]);
      if (calleeUser) {
        await this.routeToVoicemail(
          call.callerDeviceId,
          call.callerUserId,
          call.callerNumber,
          call.callerName,
          calleeUser,
          call.cdrId
        );
        return;
      }
    }

    // Finalize CDR record
    if (call.cdrId) {
      let finalStatus = 'missed';
      let durationSec = 0;
      if (call.connectedAt) {
        finalStatus = 'connected';
        durationSec = Math.max(0, Math.round((Date.now() - call.connectedAt) / 1000));
      } else if (call.state === 'voicemail') {
        finalStatus = recordedVmDuration > 0 ? 'voicemail' : 'missed';
        durationSec = recordedVmDuration;
      }

      await execute(
        'UPDATE calls SET status = ?, duration_sec = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?',
        [finalStatus, durationSec, call.cdrId]
      );

      if (finalStatus === 'missed' && call.calleeUserId) {
        if (call.calleeDeviceId && !isWebDeviceId(call.calleeDeviceId)) {
          homeAssistantMqttService.publishMissedCall(call.calleeDeviceId, call.callerNumber);
        }
        const calleeUser = await queryOne<any>('SELECT * FROM users WHERE id = ?', [call.calleeUserId]);
        if (calleeUser?.notify_on_missed_call && calleeUser?.email) {
          getSafePublicBaseUrl()
            .then(baseUrl =>
              EmailService.sendMissedCallNotification(
                calleeUser.email,
                calleeUser,
                call.callerNumber,
                call.callerName,
                baseUrl
              )
            )
            .catch(err => console.error('[Switch] Missed call email failed:', err));
        }
      }
    }

    this.sendCallEventToWeb(call, {
      type: 'call_ended',
      callId: call.id,
      reason
    });

    const devicesToNotify = new Set<string>();
    if (call.callerDeviceId) devicesToNotify.add(call.callerDeviceId);
    if (call.calleeDeviceId) devicesToNotify.add(call.calleeDeviceId);
    if (call.participants) {
      for (const d of call.participants) devicesToNotify.add(d);
    }
    if (call.ringingDevices) {
      for (const d of call.ringingDevices) devicesToNotify.add(d);
    }

    for (const devId of devicesToNotify) {
      if (devId) {
        serviceLinesService.stopRawPcmPlaybackSession(devId);
        this.sendToDevice(devId, { type: 'stop_ring' });
        this.sendToDevice(devId, { type: 'call_ended', callId: call.id, reason });
        await this.safeUpdatePhoneSql(devId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', devId]);
        if (!isWebDeviceId(devId)) {
          const phone = await queryOne<any>('SELECT hook_state FROM phones WHERE device_id = ?', [devId]);
          if (phone?.hook_state === 'off_hook') {
            this.startOffHookInactivityTimer(devId);
          }
        }
      }
    }
  }

  // Binary Audio Routing with Strict E2EE (0x01) & Voicemail (0x02) Framing
  public handleAudioPacket(sourceDeviceId: string, packet: Buffer) {
    if (!packet || packet.length === 0) return;

    if (serviceLinesService.isLoopbackActive(sourceDeviceId)) {
      serviceLinesService.handleLoopbackAudioPacket(sourceDeviceId, packet);
      return;
    }

    const call = this.deviceToCall.get(sourceDeviceId);
    if (!call) return;

    if (call.mutedDevices?.has(sourceDeviceId)) {
      return;
    }

    if (call.state === 'connected') {
      // Enforce E2EE framing: [0x01][keyId(1B)][iv12][tag16][ct] OR multi-party [0x04][slot(1B)][keyId(1B)][iv12][tag16][ct]
      const isStandardE2ee = packet.length >= 30 && packet[0] === 0x01;
      const isMultiPartyE2ee = packet.length >= 31 && packet[0] === 0x04;
      if (!isStandardE2ee && !isMultiPartyE2ee) {
        return;
      }

      if (call.isGroupCall && call.participants) {
        const senderSlot = this.getOrAssignCallSlot(call, sourceDeviceId);
        let outboundPacket: Buffer;
        if (packet[0] === 0x01) {
          outboundPacket = Buffer.allocUnsafe(packet.length + 1);
          outboundPacket[0] = 0x04;
          outboundPacket[1] = senderSlot & 0xff;
          packet.subarray(1).copy(outboundPacket, 2);
        } else {
          outboundPacket = Buffer.from(packet);
          outboundPacket[1] = senderSlot & 0xff;
        }
        for (const partDeviceId of call.participants) {
          if (partDeviceId !== sourceDeviceId) {
            const partClient = this.phoneClients.get(partDeviceId);
            if (partClient && partClient.ws.readyState === WebSocket.OPEN) {
              partClient.ws.send(outboundPacket);
            }
          }
        }
        return;
      }

      const peerDeviceId = sourceDeviceId === call.callerDeviceId ? call.calleeDeviceId : call.callerDeviceId;
      const peerClient = this.phoneClients.get(peerDeviceId);
      if (peerClient && peerClient.ws.readyState === WebSocket.OPEN) {
        peerClient.ws.send(packet);
      }
      return;
    }

    if (call.state === 'voicemail' && sourceDeviceId === call.callerDeviceId) {
      let pcmSlice: Buffer;
      if (packet[0] === 0x02 && packet.length % 2 === 1) {
        pcmSlice = packet.subarray(1);
      } else if (packet.length % 2 === 0) {
        // Unprefixed legacy 16-bit PCM fallback
        pcmSlice = packet;
      } else {
        return;
      }

      if (pcmSlice.length === 0) return;

      const currentBytes = call.voicemailBytesRecorded || 0;
      if (call.voicemailChunks && currentBytes < MAX_VOICEMAIL_PCM_BYTES) {
        const remaining = MAX_VOICEMAIL_PCM_BYTES - currentBytes;
        const toStore = pcmSlice.length <= remaining ? Buffer.from(pcmSlice) : Buffer.from(pcmSlice.subarray(0, remaining - (remaining % 2)));
        if (toStore.length > 0) {
          call.voicemailChunks.push(toStore);
          call.voicemailBytesRecorded = currentBytes + toStore.length;
        }
      }

      if (call.calleeScreeningDeviceId) {
        const calleeClient = this.phoneClients.get(call.calleeScreeningDeviceId);
        if (calleeClient && calleeClient.ws.readyState === WebSocket.OPEN) {
          const screeningFrame = Buffer.allocUnsafe(1 + pcmSlice.length);
          screeningFrame[0] = 0x00;
          pcmSlice.copy(screeningFrame, 1);
          calleeClient.ws.send(screeningFrame);
        }
      }
    }
  }

  public async handleCallHangup(deviceId: string) {
    const vmSess = this.activeVmInboxSessions.get(deviceId);
    if (vmSess) {
      this.activeVmInboxSessions.delete(deviceId);
      vmSess.wakeFn?.();
    }
    serviceLinesService.cleanupDevice(deviceId);
    await this.cleanupCallerFromWaitingCalls(deviceId);

    const pendingInv = this.pendingGroupInvites.get(deviceId);
    if (pendingInv) {
      clearTimeout(pendingInv.timer);
      this.pendingGroupInvites.delete(deviceId);
      this.sendToDevice(deviceId, { type: 'stop_ring' });
      await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', deviceId]);
    }

    const call = this.findCallByDevice(deviceId);
    if (call) {
      await this.terminateCall(call.id, 'hangup', deviceId);
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
        if (
          call.callerDeviceId !== excludeDeviceId &&
          call.calleeDeviceId !== excludeDeviceId &&
          (!call.participants || !call.participants.has(excludeDeviceId || ''))
        ) {
          return call;
        }
      }
    }
    return undefined;
  }

  public findRingingCallForUserOrDevice(deviceId: string, userId?: number): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.state === 'ringing') {
        if (
          call.calleeDeviceId === deviceId ||
          (call.ringingDevices && call.ringingDevices.has(deviceId)) ||
          (userId && call.calleeUserId === userId && call.callerDeviceId !== deviceId)
        ) {
          return call;
        }
      }
    }
    return undefined;
  }

  public async joinPartyLineCall(call: ActiveCall, deviceId: string) {
    call.isGroupCall = true;
    if (!call.participants) {
      call.participants = new Set([call.callerDeviceId, call.calleeDeviceId].filter(Boolean));
    }
    call.participants.add(deviceId);

    const joiningClient = this.phoneClients.get(deviceId);
    if (joiningClient?.userId) {
      if (!call.participantUserIds) call.participantUserIds = new Set();
      call.participantUserIds.add(joiningClient.userId);
    }

    this.indexCallDevices(call);

    const slot = this.getOrAssignCallSlot(call, deviceId);
    this.sendToDevice(deviceId, { type: 'stop_tone' });
    this.sendToDevice(deviceId, { type: 'stop_ring' });
    this.sendToDevice(deviceId, {
      type: 'call_connected',
      callId: call.id,
      isKeyLeader: deviceId === call.keyLeaderDeviceId,
      senderSlot: slot,
      isGroupCall: true,
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      sessionKey: call.sessionKey
    });

    // Notify existing participants with audible join chirp + participant_joined event for E2EE key sharing/rotation
    for (const pDevId of call.participants) {
      if (pDevId !== deviceId) {
        this.sendToDevice(pDevId, { type: 'play_tone', tone: 'chirp' });
        this.sendToDevice(pDevId, {
          type: 'participant_joined',
          callId: call.id,
          deviceId,
          senderSlot: slot,
          isKeyLeader: pDevId === call.keyLeaderDeviceId
        });
      }
    }

    await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', deviceId]);
    console.log(`[Switch] Device ${deviceId} joined active Party-Line / Group call ${call.id}`);
  }

  public async parkCall(call: ActiveCall, deviceId: string) {
    const client = this.phoneClients.get(deviceId);
    call.state = 'parked';
    call.parkedByUserId = client?.userId;
    call.parkedByDeviceId = deviceId;

    const peerDeviceId = deviceId === call.callerDeviceId ? call.calleeDeviceId : call.callerDeviceId;
    const peerClient = this.phoneClients.get(peerDeviceId);
    if (peerClient?.ws) {
      const comfortPcm = TtsAudioService.generateComfortTone(180.0);
      serviceLinesService.startRawPcmPlaybackSession(peerDeviceId, comfortPcm, peerClient.ws);
    }

    this.sendToDevice(deviceId, { type: 'play_tone', tone: 'chirp' });
    await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['idle', deviceId]);

    this.sendCallEventToWeb(call, {
      type: 'call_state_change',
      callId: call.id,
      state: 'parked',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName
    });
    console.log(`[Switch] Call ${call.id} PARKED by device ${deviceId} (User ${client?.userId})`);
  }

  public async resumeParkedCall(call: ActiveCall, deviceId: string) {
    const client = this.phoneClients.get(deviceId);
    call.state = 'connected';
    // Clear stale ephemeral pubkeys so both sides negotiate fresh forward-secret keys
    call.participantPubKeys.clear();
    call.participantE2eeMeta?.clear();

    if (call.callerUserId === client?.userId) {
      if (call.callerDeviceId !== deviceId) {
        this.deviceToCall.delete(call.callerDeviceId);
      }
      call.callerDeviceId = deviceId;
    } else {
      if (call.calleeDeviceId !== deviceId) {
        this.deviceToCall.delete(call.calleeDeviceId);
      }
      call.calleeDeviceId = deviceId;
    }

    if (!this.isDeviceInCall(call, call.keyLeaderDeviceId)) {
      call.keyLeaderDeviceId = call.callerDeviceId;
    }

    this.indexCallDevices(call);

    serviceLinesService.stopRawPcmPlaybackSession(call.callerDeviceId);
    serviceLinesService.stopRawPcmPlaybackSession(call.calleeDeviceId);

    this.sendToDevice(deviceId, { type: 'stop_tone' });
    this.sendToDevice(call.callerDeviceId, {
      type: 'call_connected',
      callId: call.id,
      isKeyLeader: call.callerDeviceId === call.keyLeaderDeviceId,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName,
      sessionKey: call.sessionKey
    });
    this.sendToDevice(call.calleeDeviceId, {
      type: 'call_connected',
      callId: call.id,
      isKeyLeader: call.calleeDeviceId === call.keyLeaderDeviceId,
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      sessionKey: call.sessionKey
    });

    this.sendCallEventToWeb(call, {
      type: 'call_state_change',
      callId: call.id,
      state: 'connected',
      callerNumber: call.callerNumber,
      callerName: call.callerName,
      calleeNumber: call.calleeNumber,
      calleeName: call.calleeName
    });

    await this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET call_state = ? WHERE device_id = ?', ['connected', deviceId]);
    console.log(`[Switch] Parked Call ${call.id} RESUMED on device ${deviceId}`);
  }

  public async executeRingbackTest(deviceId: string, userId?: number) {
    let phones: any[] = [];
    if (userId) {
      phones = await query<any>('SELECT * FROM phones WHERE user_id = ? AND is_online = 1', [userId]);
    } else if (!isWebDeviceId(deviceId)) {
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
    const indexed = this.deviceToCall.get(deviceId);
    if (indexed && this.activeCalls.has(indexed.id)) {
      return indexed;
    }
    for (const call of this.activeCalls.values()) {
      if (
        call.callerDeviceId === deviceId ||
        call.calleeDeviceId === deviceId ||
        (call.participants && call.participants.has(deviceId)) ||
        (call.ringingDevices && call.ringingDevices.has(deviceId))
      ) {
        return call;
      }
    }
    return undefined;
  }

  private findCallByCalleeDevice(deviceId: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (
        call.calleeDeviceId === deviceId ||
        (call.ringingDevices && call.ringingDevices.has(deviceId)) ||
        (call.participants && call.participants.has(deviceId))
      ) {
        return call;
      }
    }
    return undefined;
  }

  private async cleanupDisconnectedDevice(deviceId: string) {
    this.clearOffHookInactivityTimer(deviceId);
    this.clearDialBuffer(deviceId);
    const vmSess = this.activeVmInboxSessions.get(deviceId);
    if (vmSess) {
      this.activeVmInboxSessions.delete(deviceId);
      vmSess.wakeFn?.();
    }
    serviceLinesService.cleanupDevice(deviceId);
    await this.cleanupCallerFromWaitingCalls(deviceId);

    const vmTimer = this.directVmTimers.get(deviceId);
    if (vmTimer) {
      clearTimeout(vmTimer);
      this.directVmTimers.delete(deviceId);
    }

    const waiting = this.waitingCalls.get(deviceId);
    if (waiting) {
      clearTimeout(waiting.ringTimeoutTimer);
      this.waitingCalls.delete(deviceId);
    }

    const invState = this.inCallInviteStates.get(deviceId);
    if (invState) {
      if (invState.interdigitTimer) clearTimeout(invState.interdigitTimer);
      this.inCallInviteStates.delete(deviceId);
    }

    const pendingInv = this.pendingGroupInvites.get(deviceId);
    if (pendingInv) {
      clearTimeout(pendingInv.timer);
      this.pendingGroupInvites.delete(deviceId);
    }

    for (const [, vmCall] of this.activeVoicemailSessions) {
      if (vmCall.calleeScreeningDeviceId === deviceId) {
        vmCall.calleeScreeningDeviceId = undefined;
      }
    }

    const activeCall = this.findCallByDevice(deviceId);
    if (activeCall && activeCall.state !== 'parked') {
      if (activeCall.state === 'ringing' && activeCall.ringingDevices && activeCall.ringingDevices.has(deviceId) && activeCall.ringingDevices.size > 1) {
        activeCall.ringingDevices.delete(deviceId);
        if (activeCall.calleeDeviceId === deviceId) {
          const nextRinging = activeCall.ringingDevices.values().next().value;
          if (nextRinging) activeCall.calleeDeviceId = nextRinging;
        }
      } else {
        await this.terminateCall(activeCall.id, 'disconnect', deviceId);
      }
    }
  }

  private cleanupStaleDevices() {
    const now = Date.now();

    // Prune expired DND breakthrough attempt entries (> 3 minutes)
    for (const [key, ts] of this.recentDndAttempts.entries()) {
      if (now - ts >= 180000) {
        this.recentDndAttempts.delete(key);
      }
    }

    for (const [deviceId, client] of this.phoneClients.entries()) {
      if (!client.isWebSoftphone && now - client.lastHeartbeat > 90000) {
        console.log(`[Switch] Device ${deviceId} heartbeat timed out.`);
        this.phoneClients.delete(deviceId);
        this.cleanupDisconnectedDevice(deviceId).catch(() => {});
        this.safeUpdatePhoneSql(deviceId, 'UPDATE phones SET is_online = 0, call_state = "idle" WHERE device_id = ?', [deviceId]).catch(() => {});
        this.sendToUserWeb(client.userId, { type: 'phone_status_change', deviceId, isOnline: false }, true);
      }
    }
  }

  public handleWebSocketConnection(ws: WebSocket, req: any) {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const wsAuthUser: AuthenticatedUser | null = req.wsAuthUser || null;
    let registeredDeviceId: string | null = null;

    if (wsAuthUser) {
      this.registerWebClient(ws, wsAuthUser);
    }

    ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        if (registeredDeviceId) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          this.handleAudioPacket(registeredDeviceId, buf);
        }
      } else {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleJsonMessage(
            ws,
            ip,
            msg,
            wsAuthUser,
            () => registeredDeviceId,
            (id) => {
              registeredDeviceId = id;
            }
          );
        } catch (e) {
          console.error('[Switch] JSON parse/message error:', e);
        }
      }
    });

    ws.on('close', () => {
      if (registeredDeviceId) {
        const currentEntry = this.phoneClients.get(registeredDeviceId);
        // Only mark offline & remove if this closing socket is still the active socket for registeredDeviceId!
        if (currentEntry && currentEntry.ws === ws) {
          this.phoneClients.delete(registeredDeviceId);
          this.cleanupDisconnectedDevice(registeredDeviceId).catch(() => {});
          if (!isWebDeviceId(registeredDeviceId)) {
            execute('UPDATE phones SET is_online = 0, call_state = "idle" WHERE device_id = ?', [registeredDeviceId]).catch(() => {});
            this.sendToUserWeb(currentEntry.userId, { type: 'phone_status_change', deviceId: registeredDeviceId, isOnline: false }, true);
          }
        }
      }
      this.unregisterWebClient(ws);
    });
  }

  public init(server: any) {
    const wss = new WebSocket.Server({
      noServer: true,
      maxPayload: 2 * 1024 * 1024,
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has('decatone-auth')) {
          return 'decatone-auth';
        }
        return false;
      }
    });

    server.on('upgrade', async (request: any, socket: any, head: any) => {
      try {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (pathname !== '/ws/phone') {
          socket.destroy();
          return;
        }

        // Validate Origin header when provided (allows hardware clients with no Origin and dev origins)
        const origin = request.headers.origin;
        if (origin && process.env.NODE_ENV === 'production') {
          const allowedOrigins = new Set(
            (process.env.CORS_ORIGIN || '')
              .split(',')
              .map((o) => o.trim())
              .filter((o) => o && o !== '*')
          );
          let originAllowed = allowedOrigins.has(origin);
          if (!originAllowed) {
            try {
              const originHost = new URL(origin).host.toLowerCase();
              const reqHost = String(request.headers.host || '').toLowerCase();
              if (reqHost && originHost === reqHost) {
                originAllowed = true;
              }
            } catch {}
          }
          if (!originAllowed) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        const wsAuthUser = await authenticateWebSocketRequest(request);
        request.wsAuthUser = wsAuthUser;

        wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleWebSocketConnection(ws as unknown as WebSocket, request);
        });
      } catch (err) {
        console.error('[Switch] Upgrade error:', err);
        socket.destroy();
      }
    });
  }

  public getPhoneClient(deviceId: string): PhoneSocketClient | undefined {
    return this.phoneClients.get(deviceId);
  }

  public sendTestRing(deviceId: string, ringStyle = 'traditional', ringCadence = '2000,4000'): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(
      JSON.stringify({
        type: 'test_ring',
        ringStyle,
        ringCadence
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

  public pushDeviceSettings(deviceId: string, settings: any): boolean {
    const client = this.phoneClients.get(deviceId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    client.ws.send(
      JSON.stringify({
        type: 'update_settings',
        ...settings
      })
    );
    return true;
  }

  public notifyOtaUpdateAvailable(version: string, binaryUrl: string, sha256?: string | null) {
    for (const [devId, client] of this.phoneClients.entries()) {
      if (!isWebDeviceId(devId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'ota_available',
            version,
            binaryUrl,
            downloadUrl: binaryUrl,
            sha256: sha256 || null
          })
        );
      }
    }
  }
}

export const phoneSwitchService = new PhoneSwitchService();
