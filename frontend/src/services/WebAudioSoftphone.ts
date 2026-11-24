/**
 * DecaTone WebAudioSoftphone
 * Real-time bidirectional 16kHz 16-bit Linear PCM audio streaming over WebSocket.
 * Features:
 * - Native ECDH P-256 + ECDSA Identity-Signed AES-256-GCM E2EE framing (`0x01` & `[0x04][slot]`)
 * - AudioWorklet capture + AudioWorklet multi-slot conference & chunked `[0x03]` Zero-Access Voicemail playback
 * - Graceful HTTP/legacy browser fallbacks when AudioWorklet is unavailable
 * - Outbound Noise Gate & Adaptive Dynamic AGC + Inbound Compressor, Bandpass & Carbon Mic Warmth DSP
 * - Full North American / Vintage Switchboard Call-Progress Tone Synthesizer
 */

import {
  bytesToBase64,
  CallE2eeSession,
  decryptVoicemailPayload,
  signEphemeralKey,
  verifyPeerEphemeralKey
} from './e2eeCrypto';

export type SoftphoneCallState =
  | 'idle'
  | 'dialing'
  | 'ringing'
  | 'connected'
  | 'voicemail'
  | 'parked'
  | 'ended';

export type AudioProfileType = 'vintage_pots' | 'early_1930s' | 'modern_hd';
export type SoftphoneSecurityMode =
  | 'none'
  | 'negotiating'
  | 'e2ee'
  | 'e2ee_verified'
  | 'e2ee_unverified'
  | 'e2ee_mismatch'
  | 'system'
  | 'voicemail';

export interface SoftphoneEvents {
  onStateChange?: (state: SoftphoneCallState) => void;
  onCallConnected?: (info: {
    number: string;
    name?: string;
    isSystemLine?: boolean;
    isVoicemail?: boolean;
    callId?: string;
  }) => void;
  onCallEnded?: (reason?: string) => void;
  onError?: (err: string) => void;
  onE2eeEstablished?: (safetyCode: string | null, mode?: SoftphoneSecurityMode) => void;
  onMuteChange?: (muted: boolean) => void;
}

interface VmStreamAssembly {
  vmId: number;
  ephemeralPublicKey: string;
  iv: string;
  tag: string;
  totalBytes: number;
  chunks: Map<number, Uint8Array>;
  maxSeq: number;
}

const CAPTURE_WORKLET_CODE = `
class DecaToneCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const fc = 3600.0;
    const dt = 1.0 / sampleRate;
    const rc = 1.0 / (2.0 * Math.PI * fc);
    this.alpha = dt / (rc + dt);
    this.iirState = 0.0;
    this.fir0 = 0.0;
    this.fir1 = 0.0;
    this.fir2 = 0.0;
    this.ratio = sampleRate / 16000.0;
    this.phase = 0.0;
    this.outBuffer = new Float32Array(256);
    this.outIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const chan = input[0];

    for (let i = 0; i < chan.length; i++) {
      const x = chan[i];
      const fir = 0.25 * (x + this.fir0 + this.fir1 + this.fir2);
      this.fir2 = this.fir1;
      this.fir1 = this.fir0;
      this.fir0 = x;

      this.iirState += this.alpha * (fir - this.iirState);

      this.phase += 1.0;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        this.outBuffer[this.outIndex++] = this.iirState;
        if (this.outIndex >= 256) {
          const frameCopy = new Float32Array(this.outBuffer);
          this.port.postMessage(frameCopy, [frameCopy.buffer]);
          this.outIndex = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('decatone-capture-processor', DecaToneCaptureProcessor);
`;

export class WebAudioSoftphone {
  private static instance: WebAudioSoftphone;
  private static distortionCurveCache = new Map<number, Float32Array>();
  private static captureWorkletContexts = new WeakSet<AudioContext>();
  private static playbackWorkletContexts = new WeakSet<AudioContext>();

  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentSinkNode: GainNode | null = null;

  private playbackWorkletNode: AudioWorkletNode | null = null;
  private playbackWorkletLoading: Promise<boolean> | null = null;

  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private dialTimeouts: ReturnType<typeof setTimeout>[] = [];
  private idleResetTimeout: ReturnType<typeof setTimeout> | null = null;
  private fallbackVmSources: AudioBufferSourceNode[] = [];
  private fallbackVmTimer: ReturnType<typeof setTimeout> | null = null;

  private callState: SoftphoneCallState = 'idle';
  private events: SoftphoneEvents = {};
  private subscribers = new Set<SoftphoneEvents>();

  private deviceId: string = '';
  private currentCallId: string = '';
  private nextPlayTime: number = 0;
  private isMuted: boolean = false;

  // Call Routing / E2EE Flags
  private isSystemLine: boolean = false;
  private isVoicemail: boolean = false;
  private isLoopback: boolean = false;
  private e2eeSession: CallE2eeSession | null = null;
  private e2eeInitPromise: Promise<void> | null = null;
  private e2eeSafetyCode: string | null = null;
  private securityMode: SoftphoneSecurityMode = 'none';
  private peerTrustByDevice = new Map<string, 'verified' | 'unverified' | 'mismatch'>();
  private vmStreamState: VmStreamAssembly | null = null;

  // Audio DSP Settings (mirrors ESP32 audio_manager)
  private activeProfile: AudioProfileType = 'vintage_pots';
  private speakerVolume: number = 80;
  private micSensitivity: number = 80;
  private outboundAgcEnabled: boolean = true;
  private inboundNormEnabled: boolean = true;

  // DSP Node Graph for Inbound Playback
  private playbackInputGain: GainNode | null = null;
  private playbackCompressor: DynamicsCompressorNode | null = null;
  private playbackHighpass: BiquadFilterNode | null = null;
  private playbackLowpass: BiquadFilterNode | null = null;
  private playbackWaveShaper: WaveShaperNode | null = null;
  private playbackGainNode: GainNode | null = null;

  // Active Synthesized Call Progress Tone State
  private activeToneCleanup: (() => void) | null = null;

  // Outbound AGC state
  private micRmsLevel: number = 0.05;
  private micAgcGain: number = 1.0;

  private constructor() {}

  public static getInstance(): WebAudioSoftphone {
    if (!WebAudioSoftphone.instance) {
      WebAudioSoftphone.instance = new WebAudioSoftphone();
    }
    return WebAudioSoftphone.instance;
  }

  private static getDistortionCurve(drive: number): Float32Array {
    const cached = WebAudioSoftphone.distortionCurveCache.get(drive);
    if (cached) return cached;

    const nSamples = 44100;
    const curve = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; ++i) {
      const x = (i * 2) / nSamples - 1;
      let scaledX = x * drive;
      if (scaledX > 1.2) scaledX = 1.2;
      if (scaledX < -1.2) scaledX = -1.2;
      curve[i] = scaledX - scaledX * scaledX * scaledX * 0.333;
    }
    WebAudioSoftphone.distortionCurveCache.set(drive, curve);
    return curve;
  }

  public setEvents(events: SoftphoneEvents) {
    this.events = events;
  }

  public subscribe(listener: SoftphoneEvents): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private emitStateChange(state: SoftphoneCallState) {
    this.events.onStateChange?.(state);
    this.subscribers.forEach((s) => s.onStateChange?.(state));
  }

  private emitCallConnected(info: {
    number: string;
    name?: string;
    isSystemLine?: boolean;
    isVoicemail?: boolean;
    callId?: string;
  }) {
    this.events.onCallConnected?.(info);
    this.subscribers.forEach((s) => s.onCallConnected?.(info));
  }

  private emitCallEnded(reason?: string) {
    this.events.onCallEnded?.(reason);
    this.subscribers.forEach((s) => s.onCallEnded?.(reason));
  }

  private emitError(err: string) {
    this.events.onError?.(err);
    this.subscribers.forEach((s) => s.onError?.(err));
  }

  private emitE2eeEstablished(safetyCode: string | null, mode: SoftphoneSecurityMode) {
    this.e2eeSafetyCode = safetyCode;
    this.securityMode = mode;
    this.events.onE2eeEstablished?.(safetyCode, mode);
    this.subscribers.forEach((s) => s.onE2eeEstablished?.(safetyCode, mode));
  }

  private emitMuteChange(muted: boolean) {
    this.events.onMuteChange?.(muted);
    this.subscribers.forEach((s) => s.onMuteChange?.(muted));
  }

  public getCallState(): SoftphoneCallState {
    return this.callState;
  }

  public getSafetyCode(): string | null {
    return this.e2eeSafetyCode;
  }

  public getSecurityMode(): SoftphoneSecurityMode {
    return this.securityMode;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    this.emitMuteChange(muted);
  }

  public isMicrophoneMuted(): boolean {
    return this.isMuted;
  }

  public getSpeakerVolume(): number {
    return this.speakerVolume;
  }

  public setSpeakerVolume(volumePercent: number) {
    this.speakerVolume = Math.max(0, Math.min(100, volumePercent));
    if (this.playbackGainNode && this.audioCtx) {
      this.playbackGainNode.gain.setValueAtTime(this.speakerVolume / 100.0, this.audioCtx.currentTime);
    }
  }

  public getMicSensitivity(): number {
    return this.micSensitivity;
  }

  public setMicSensitivity(gainPercent: number) {
    this.micSensitivity = Math.max(0, Math.min(100, gainPercent));
  }

  public getAudioProfile(): AudioProfileType {
    return this.activeProfile;
  }

  public setAudioProfile(profile: AudioProfileType) {
    this.activeProfile = profile;
    this.updateDspNodes();
  }

  public getOutboundAgcEnabled(): boolean {
    return this.outboundAgcEnabled;
  }

  public setOutboundAgcEnabled(enabled: boolean) {
    this.outboundAgcEnabled = enabled;
  }

  public getInboundNormalizationEnabled(): boolean {
    return this.inboundNormEnabled;
  }

  public setInboundNormalizationEnabled(enabled: boolean) {
    this.inboundNormEnabled = enabled;
    this.rewireNormalizationChain();
  }

  public initAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.playbackWorkletNode = null;
      this.playbackWorkletLoading = null;
      this.setupDspChain();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private setupDspChain() {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;

    this.playbackInputGain = ctx.createGain();
    this.playbackInputGain.gain.setValueAtTime(1.0, ctx.currentTime);

    this.playbackCompressor = ctx.createDynamicsCompressor();
    this.playbackCompressor.threshold.setValueAtTime(-18, ctx.currentTime);
    this.playbackCompressor.knee.setValueAtTime(12, ctx.currentTime);
    this.playbackCompressor.ratio.setValueAtTime(4, ctx.currentTime);
    this.playbackCompressor.attack.setValueAtTime(0.003, ctx.currentTime);
    this.playbackCompressor.release.setValueAtTime(0.25, ctx.currentTime);

    this.playbackHighpass = ctx.createBiquadFilter();
    this.playbackHighpass.type = 'highpass';
    this.playbackHighpass.frequency.setValueAtTime(300, ctx.currentTime);
    this.playbackHighpass.Q.setValueAtTime(0.7, ctx.currentTime);

    this.playbackLowpass = ctx.createBiquadFilter();
    this.playbackLowpass.type = 'lowpass';
    this.playbackLowpass.frequency.setValueAtTime(3400, ctx.currentTime);
    this.playbackLowpass.Q.setValueAtTime(0.7, ctx.currentTime);

    this.playbackWaveShaper = ctx.createWaveShaper();
    this.playbackWaveShaper.curve = WebAudioSoftphone.getDistortionCurve(1.15) as any;
    this.playbackWaveShaper.oversample = '2x';

    this.playbackGainNode = ctx.createGain();
    this.playbackGainNode.gain.setValueAtTime(this.speakerVolume / 100.0, ctx.currentTime);

    this.playbackCompressor.connect(this.playbackHighpass);
    this.playbackHighpass.connect(this.playbackLowpass);
    this.playbackLowpass.connect(this.playbackWaveShaper);
    this.playbackWaveShaper.connect(this.playbackGainNode);
    this.playbackGainNode.connect(ctx.destination);

    this.rewireNormalizationChain();
    this.updateDspNodes();
    void this.ensurePlaybackWorklet(ctx);
  }

  private async ensurePlaybackWorklet(ctx: AudioContext): Promise<boolean> {
    if (this.playbackWorkletNode && this.audioCtx === ctx) {
      return true;
    }
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return false;
    }
    if (this.playbackWorkletLoading) {
      return this.playbackWorkletLoading;
    }

    this.playbackWorkletLoading = (async () => {
      try {
        if (!WebAudioSoftphone.playbackWorkletContexts.has(ctx)) {
          await ctx.audioWorklet.addModule('/audio/playback-worklet.js');
          WebAudioSoftphone.playbackWorkletContexts.add(ctx);
        }
        if (this.audioCtx !== ctx || ctx.state === 'closed') {
          return false;
        }
        const node = new AudioWorkletNode(ctx, 'decatone-playback-processor');
        node.port.onmessage = (ev) => {
          const msg = ev.data;
          if (msg?.type === 'voicemail_drain_complete' && msg.vmId !== undefined) {
            this.sendVoicemailPlaybackDone(msg.vmId);
          }
        };
        node.connect(this.playbackInputGain || ctx.destination);
        this.playbackWorkletNode = node;
        return true;
      } catch (err) {
        console.warn('[WebSoftphone] Playback AudioWorklet unavailable, using buffer fallback:', err);
        return false;
      } finally {
        this.playbackWorkletLoading = null;
      }
    })();

    return this.playbackWorkletLoading;
  }

  private rewireNormalizationChain() {
    if (!this.playbackInputGain || !this.playbackCompressor || !this.playbackHighpass) return;
    try {
      this.playbackInputGain.disconnect();
    } catch {
      // Ignore
    }

    if (this.inboundNormEnabled) {
      this.playbackInputGain.connect(this.playbackCompressor);
    } else {
      this.playbackInputGain.connect(this.playbackHighpass);
    }
  }

  private updateDspNodes() {
    if (!this.audioCtx || !this.playbackHighpass || !this.playbackLowpass || !this.playbackWaveShaper) return;
    const ctx = this.audioCtx;

    if (this.activeProfile === 'modern_hd') {
      this.playbackHighpass.frequency.setValueAtTime(20, ctx.currentTime);
      this.playbackLowpass.frequency.setValueAtTime(20000, ctx.currentTime);
      this.playbackWaveShaper.curve = WebAudioSoftphone.getDistortionCurve(1.0) as any;
    } else if (this.activeProfile === 'early_1930s') {
      this.playbackHighpass.frequency.setValueAtTime(450, ctx.currentTime);
      this.playbackLowpass.frequency.setValueAtTime(2500, ctx.currentTime);
      this.playbackWaveShaper.curve = WebAudioSoftphone.getDistortionCurve(1.55) as any;
    } else {
      this.playbackHighpass.frequency.setValueAtTime(300, ctx.currentTime);
      this.playbackLowpass.frequency.setValueAtTime(3400, ctx.currentTime);
      this.playbackWaveShaper.curve = WebAudioSoftphone.getDistortionCurve(1.15) as any;
    }
  }

  private clearHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private clearCallTimers() {
    for (const t of this.dialTimeouts) {
      clearTimeout(t);
    }
    this.dialTimeouts = [];

    if (this.idleResetTimeout) {
      clearTimeout(this.idleResetTimeout);
      this.idleResetTimeout = null;
    }
  }

  private clearFallbackVoicemailPlayback() {
    if (this.fallbackVmTimer) {
      clearTimeout(this.fallbackVmTimer);
      this.fallbackVmTimer = null;
    }
    for (const src of this.fallbackVmSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore
      }
    }
    this.fallbackVmSources = [];
  }

  private sendVoicemailPlaybackDone(vmId: number) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'voicemail_playback_done', deviceId: this.deviceId, vmId }));
      } catch {
        // Ignore transient WS send error
      }
    }
  }

  private computeAggregateE2eeMode(): SoftphoneSecurityMode {
    if (this.peerTrustByDevice.size === 0) {
      return this.e2eeSession?.isReady() ? 'e2ee_unverified' : 'negotiating';
    }
    let hasUnverified = false;
    for (const trust of this.peerTrustByDevice.values()) {
      if (trust === 'mismatch') return 'e2ee_mismatch';
      if (trust === 'unverified') hasUnverified = true;
    }
    return hasUnverified ? 'e2ee_unverified' : 'e2ee_verified';
  }

  /**
   * Connects signaling and audio WebSocket to DecaTone switchboard via HttpOnly session cookie
   */
  public connectSocket(userId?: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return resolve(this.ws);
      }

      this.clearHeartbeat();
      if (!this.deviceId) {
        this.deviceId = `WEB-${userId || 'CLIENT'}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/phone`;
      const socket = new WebSocket(wsUrl);

      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'web_client_init',
            deviceId: this.deviceId,
            userId
          })
        );
        this.ws = socket;

        this.clearHeartbeat();
        this.heartbeatInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ type: 'heartbeat', deviceId: this.deviceId }));
            } catch {
              // Ignore transient send errors
            }
          }
        }, 20000);

        resolve(socket);
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          void this.handleBinaryFrame(new Uint8Array(event.data));
        } else if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            void this.handleJsonMessage(msg);
          } catch {
            // Ignore malformed JSON
          }
        }
      };

      socket.onerror = (err) => {
        console.error('[WebSoftphone] WebSocket error:', err);
        this.clearHeartbeat();
        reject(err);
      };

      socket.onclose = () => {
        this.clearHeartbeat();
        if (this.ws === socket) {
          this.ws = null;
        }
      };
    });
  }

  private async handleBinaryFrame(bytes: Uint8Array): Promise<void> {
    if (bytes.length <= 1) return;

    const frameType = bytes[0];
    if (frameType === 0x00) {
      // Server system audio (16kHz 16-bit signed LE mono PCM)
      this.playPcmPacket(bytes.subarray(1));
    } else if (frameType === 0x01 || frameType === 0x04) {
      // E2EE encrypted peer/group audio ([0x01][keyId][iv][tag][ct] or [0x04][slot][keyId][iv][tag][ct])
      if (this.e2eeSession) {
        const res = await this.e2eeSession.decryptPcmFrameWithSlot(bytes);
        if (res && res.pcm.length > 0) {
          this.playSlotInt16(res.senderSlot, res.pcm);
        }
      }
    } else if (frameType === 0x03 && bytes.length >= 8) {
      await this.handleChunkedVoicemailFrame(bytes);
    }
  }

  private async handleChunkedVoicemailFrame(bytes: Uint8Array): Promise<void> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vmId = view.getUint32(1, false);
    const seq = view.getUint16(5, false);
    const flags = bytes[7];
    const chunkPayload = bytes.subarray(8);

    const stream = this.vmStreamState;
    if (!stream || stream.vmId !== vmId) {
      return;
    }

    stream.chunks.set(seq, new Uint8Array(chunkPayload));
    if (seq > stream.maxSeq) {
      stream.maxSeq = seq;
    }

    if ((flags & 0x01) === 0) {
      return;
    }

    // Final chunk received — assemble and decrypt full Zero-Access ciphertext
    this.vmStreamState = null;

    let totalLen = 0;
    const ordered: Uint8Array[] = [];
    for (let s = 0; s <= stream.maxSeq; s++) {
      const part = stream.chunks.get(s);
      if (!part) {
        this.emitError('Incomplete voicemail audio stream received.');
        this.sendVoicemailPlaybackDone(vmId);
        return;
      }
      ordered.push(part);
      totalLen += part.length;
    }

    const assembled = new Uint8Array(totalLen);
    let writeOffset = 0;
    for (const part of ordered) {
      assembled.set(part, writeOffset);
      writeOffset += part.length;
    }

    try {
      const wavBuffer = await decryptVoicemailPayload({
        ephemeralPublicKey: stream.ephemeralPublicKey,
        iv: stream.iv,
        tag: stream.tag,
        ciphertextBase64: bytesToBase64(assembled)
      });
      await this.playDecryptedVoicemailWav(vmId, new Uint8Array(wavBuffer));
    } catch (err: any) {
      this.emitError(err?.message || 'Unable to decrypt Zero-Access voicemail. Unlock your vault first.');
      this.sendVoicemailPlaybackDone(vmId);
    }
  }

  private async playDecryptedVoicemailWav(vmId: number, wavBytes: Uint8Array): Promise<void> {
    let pcmOffset = 0;
    if (
      wavBytes.length > 44 &&
      wavBytes[0] === 0x52 && // 'R'
      wavBytes[1] === 0x49 && // 'I'
      wavBytes[2] === 0x46 && // 'F'
      wavBytes[3] === 0x46    // 'F'
    ) {
      pcmOffset = 44;
    }

    const pcmBytes = wavBytes.subarray(pcmOffset);
    const sampleCount = Math.floor(pcmBytes.byteLength / 2);
    if (sampleCount <= 0) {
      this.sendVoicemailPlaybackDone(vmId);
      return;
    }

    const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, sampleCount * 2);
    const f32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      f32[i] = view.getInt16(i * 2, true) / 32768.0;
    }

    const ctx = this.initAudioContext();
    const workletReady = await this.ensurePlaybackWorklet(ctx);

    if (workletReady && this.playbackWorkletNode) {
      this.playbackWorkletNode.port.postMessage({ type: 'vm_clear' });
      const CHUNK_SAMPLES = 4096;
      for (let off = 0; off < f32.length; off += CHUNK_SAMPLES) {
        const slice = new Float32Array(f32.subarray(off, Math.min(f32.length, off + CHUNK_SAMPLES)));
        const isLast = off + CHUNK_SAMPLES >= f32.length;
        this.playbackWorkletNode.port.postMessage(
          { type: 'vm_chunk', vmId, samples: slice, isLast },
          [slice.buffer]
        );
      }
      return;
    }

    // Fallback: AudioBufferSourceNode scheduling when AudioWorklet unavailable
    this.clearFallbackVoicemailPlayback();
    const audioBuffer = ctx.createBuffer(1, sampleCount, 16000);
    audioBuffer.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.playbackInputGain || ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + audioBuffer.duration;
    this.fallbackVmSources.push(src);

    const delayMs = Math.max(150, (this.nextPlayTime - ctx.currentTime) * 1000 + 120);
    this.fallbackVmTimer = setTimeout(() => {
      this.fallbackVmTimer = null;
      this.sendVoicemailPlaybackDone(vmId);
    }, delayMs);
  }

  private async handleJsonMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'call_connected': {
        this.stopTone();
        this.currentCallId = msg.callId || this.currentCallId || 'call';
        this.isVoicemail = false;
        this.isSystemLine = false;
        this.isLoopback = false;
        this.peerTrustByDevice.clear();

        const remoteNumber = String(msg.calleeNumber || msg.callerNumber || 'Remote Line');
        const remoteName = msg.calleeName || msg.callerName;

        if (msg.isVoicemail) {
          this.isVoicemail = true;
          this.e2eeSession = null;
          this.callState = 'voicemail';
          this.emitStateChange('voicemail');
          this.emitCallConnected({
            number: remoteNumber,
            name: remoteName,
            isVoicemail: true,
            callId: this.currentCallId
          });
          this.emitE2eeEstablished(null, 'voicemail');
        } else if (msg.isSystemLine) {
          this.isSystemLine = true;
          this.isLoopback = remoteNumber === '119' || remoteNumber === '099';
          this.e2eeSession = null;
          this.callState = 'connected';
          this.emitStateChange('connected');
          this.emitCallConnected({
            number: remoteNumber,
            name: remoteName,
            isSystemLine: true,
            callId: this.currentCallId
          });
          this.emitE2eeEstablished(null, 'system');
        } else {
          this.callState = 'connected';
          this.emitStateChange('connected');
          this.emitCallConnected({
            number: remoteNumber,
            name: remoteName,
            isSystemLine: false,
            callId: this.currentCallId
          });
          this.emitE2eeEstablished(null, 'negotiating');

          const session = new CallE2eeSession(this.currentCallId, !!msg.isKeyLeader);
          const initTask = session.init().then(async () => {
            this.e2eeSession = session;
            const ephPubB64 = session.getPublicKeyBase64();
            const sigPayload = await signEphemeralKey(this.currentCallId, ephPubB64).catch(() => null);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(
                JSON.stringify({
                  type: 'e2ee_pub',
                  callId: this.currentCallId,
                  deviceId: this.deviceId,
                  publicKey: ephPubB64,
                  ...(sigPayload
                    ? {
                        identityPublicKey: sigPayload.identityPublicKey,
                        signature: sigPayload.signature
                      }
                    : {})
                })
              );
            }
          });
          this.e2eeInitPromise = initTask;
          try {
            await initTask;
          } catch (err: any) {
            this.emitError(`E2EE initialization failed: ${err?.message || 'Unknown error'}`);
          }
        }
        break;
      }

      case 'e2ee_peer_pub': {
        if (this.e2eeInitPromise) {
          await this.e2eeInitPromise.catch(() => {});
        }
        const peerDeviceId = String(msg.peerDeviceId || msg.deviceId || '');
        if (!this.e2eeSession || !msg.publicKey || !peerDeviceId || peerDeviceId === this.deviceId) break;

        const targetCallId = String(msg.callId || this.currentCallId);
        const trust = await verifyPeerEphemeralKey({
          callId: targetCallId,
          ephPublicKeyB64: String(msg.publicKey),
          signature: msg.signature,
          identityPublicKey: msg.identityPublicKey,
          expectedIdentityPublicKey: msg.expectedIdentityPublicKey
        });
        this.peerTrustByDevice.set(peerDeviceId, msg.legacyUnsigned ? (trust === 'mismatch' ? 'mismatch' : 'unverified') : trust);

        if (this.e2eeSession.isLeader()) {
          try {
            const wrapped = await this.e2eeSession.wrapMediaKeyForPeer(msg.publicKey);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(
                JSON.stringify({
                  type: 'e2ee_media_key',
                  callId: targetCallId,
                  deviceId: this.deviceId,
                  targetDeviceId: peerDeviceId,
                  targetUserId: msg.userId,
                  ...wrapped
                })
              );
            }
            this.emitE2eeEstablished(this.e2eeSession.getSafetyCode(), this.computeAggregateE2eeMode());
          } catch (err: any) {
            console.error('[WebSoftphone] E2EE key wrap failed:', err);
          }
        } else if (this.e2eeSession.isReady()) {
          this.emitE2eeEstablished(this.e2eeSession.getSafetyCode(), this.computeAggregateE2eeMode());
        }
        break;
      }

      case 'e2ee_media_key': {
        if (this.e2eeInitPromise) {
          await this.e2eeInitPromise.catch(() => {});
        }
        if (!this.e2eeSession || !msg.wrappedKey || !msg.senderPublicKey) break;
        if (msg.targetDeviceId && msg.targetDeviceId !== this.deviceId) break;

        try {
          const safetyCode = await this.e2eeSession.receiveWrappedMediaKey({
            keyId: msg.keyId,
            iv: msg.iv,
            tag: msg.tag,
            wrappedKey: msg.wrappedKey,
            senderPublicKey: msg.senderPublicKey
          });
          this.emitE2eeEstablished(safetyCode, this.computeAggregateE2eeMode());
        } catch (err: any) {
          console.error('[WebSoftphone] E2EE media key unwrap failed:', err);
          this.emitError('Failed to verify E2EE session key');
        }
        break;
      }

      case 'e2ee_leader_changed': {
        if (this.e2eeSession && (!msg.callId || msg.callId === this.currentCallId) && msg.isKeyLeader) {
          this.e2eeSession.promoteToLeader();
        }
        break;
      }

      case 'voicemail_start':
      case 'voicemail_recording_started': {
        this.stopTone();
        this.isVoicemail = true;
        this.isSystemLine = false;
        this.callState = 'voicemail';
        this.emitStateChange('voicemail');
        this.emitE2eeEstablished(null, 'voicemail');
        break;
      }

      case 'voicemail_stream_start': {
        const vmId = Number(msg.vmId);
        this.vmStreamState = {
          vmId,
          ephemeralPublicKey: String(msg.ephemeralPublicKey || ''),
          iv: String(msg.iv || ''),
          tag: String(msg.tag || ''),
          totalBytes: Number(msg.totalBytes) || 0,
          chunks: new Map(),
          maxSeq: -1
        };
        const ctx = this.initAudioContext();
        void this.ensurePlaybackWorklet(ctx);
        break;
      }

      case 'voicemail_playback_abort': {
        this.vmStreamState = null;
        this.clearFallbackVoicemailPlayback();
        this.playbackWorkletNode?.port.postMessage({ type: 'vm_clear' });
        break;
      }

      case 'voicemail_cipher_payload': {
        try {
          const wavBuffer = await decryptVoicemailPayload({
            ephemeralPublicKey: msg.ephemeralPublicKey,
            iv: msg.iv,
            tag: msg.tag,
            ciphertextBase64: msg.ciphertextBase64 ?? msg.ciphertext
          });
          await this.playDecryptedVoicemailWav(Number(msg.vmId) || 0, new Uint8Array(wavBuffer));
        } catch (err: any) {
          this.emitError(err?.message || 'Unable to decrypt Zero-Access voicemail. Unlock your vault first.');
        }
        break;
      }

      case 'call_state_change': {
        if (
          msg.state === 'parked' ||
          msg.state === 'connected' ||
          msg.state === 'ringing' ||
          msg.state === 'voicemail'
        ) {
          this.callState = msg.state;
          this.emitStateChange(msg.state);
        }
        break;
      }

      case 'mic_mute_state': {
        const muted = Boolean(msg.isMuted ?? msg.muted);
        this.isMuted = muted;
        this.emitMuteChange(muted);
        break;
      }

      case 'play_tone': {
        const tone = String(msg.tone || '');
        if (tone === 'ringback' && (this.callState === 'dialing' || this.callState === 'ringing')) {
          this.callState = 'ringing';
          this.emitStateChange('ringing');
        }
        this.playSynthesizedTone(tone);
        break;
      }

      case 'stop_tone': {
        this.stopTone();
        break;
      }

      case 'call_ended': {
        this.endCall(msg.reason || 'remote_hangup', true);
        break;
      }
    }
  }

  private stopTone() {
    if (this.activeToneCleanup) {
      try {
        this.activeToneCleanup();
      } catch {
        // Ignore
      }
      this.activeToneCleanup = null;
    }
  }

  private playSynthesizedTone(toneName: string) {
    const isOneShot = toneName === 'beep' || toneName === 'chirp' || toneName === 'call_waiting';
    if (!isOneShot) {
      this.stopTone();
    }

    const ctx = this.initAudioContext();
    const dest = this.playbackInputGain || ctx.destination;

    if (toneName === 'beep') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      return;
    }

    if (toneName === 'chirp') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(1800, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.085);
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
      return;
    }

    if (toneName === 'call_waiting') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.31);
      return;
    }

    let freqs: number[] = [350, 440];
    let level = 0.12;
    let onMs = 0;
    let offMs = 0;
    let stutterPrefix = false;
    let warble8Hz = false;

    switch (toneName) {
      case 'dial':
        freqs = [350, 440];
        break;
      case 'whisper_dial':
        freqs = [350, 440];
        level = 0.04;
        break;
      case 'stutter_dial':
        freqs = [350, 440];
        stutterPrefix = true;
        break;
      case 'dnd_dial':
        freqs = [440, 480];
        warble8Hz = true;
        break;
      case 'stutter_dnd':
        freqs = [440, 480];
        stutterPrefix = true;
        warble8Hz = true;
        break;
      case 'ringback':
        freqs = [440, 480];
        onMs = 2000;
        offMs = 4000;
        break;
      case 'busy':
        freqs = [480, 620];
        onMs = 500;
        offMs = 500;
        break;
      case 'reorder':
        freqs = [480, 620];
        onMs = 250;
        offMs = 250;
        break;
      case 'howler':
        freqs = [1400, 2060, 2450, 2600];
        level = 0.2;
        onMs = 100;
        offMs = 100;
        break;
      default:
        return;
    }

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(level, ctx.currentTime);
    masterGain.connect(dest);

    const oscillators = freqs.map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, ctx.currentTime);
      osc.connect(masterGain);
      osc.start();
      return osc;
    });

    let warbleOsc: OscillatorNode | null = null;
    let warbleGain: GainNode | null = null;
    if (warble8Hz) {
      warbleOsc = ctx.createOscillator();
      warbleGain = ctx.createGain();
      warbleOsc.frequency.setValueAtTime(8, ctx.currentTime);
      warbleGain.gain.setValueAtTime(level * 0.45, ctx.currentTime);
      warbleOsc.connect(warbleGain);
      warbleGain.connect(masterGain.gain);
      warbleOsc.start();
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    let cadenceInterval: ReturnType<typeof setInterval> | null = null;

    if (stutterPrefix) {
      for (let pulse = 0; pulse < 10; pulse++) {
        const offAt = ctx.currentTime + pulse * 0.2 + 0.1;
        const onAt = ctx.currentTime + pulse * 0.2 + 0.2;
        masterGain.gain.setValueAtTime(level, ctx.currentTime + pulse * 0.2);
        masterGain.gain.setValueAtTime(0.0001, offAt);
        masterGain.gain.setValueAtTime(level, onAt);
      }
    } else if (onMs > 0 && offMs > 0) {
      const runCycle = () => {
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        masterGain.gain.setValueAtTime(level, now);
        masterGain.gain.setValueAtTime(0.0001, now + onMs / 1000);
      };
      runCycle();
      cadenceInterval = setInterval(runCycle, onMs + offMs);
    }

    this.activeToneCleanup = () => {
      timers.forEach((t) => clearTimeout(t));
      if (cadenceInterval) clearInterval(cadenceInterval);
      oscillators.forEach((o) => {
        try {
          o.stop();
          o.disconnect();
        } catch {}
      });
      if (warbleOsc) {
        try {
          warbleOsc.stop();
          warbleOsc.disconnect();
        } catch {}
      }
      if (warbleGain) {
        try {
          warbleGain.disconnect();
        } catch {}
      }
      try {
        masterGain.disconnect();
      } catch {}
    };
  }

  private cleanupMicrophoneNodes() {
    if (this.workletNode) {
      try {
        this.workletNode.port.onmessage = null;
        this.workletNode.disconnect();
      } catch {}
      this.workletNode = null;
    }
    if (this.processorNode) {
      try {
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      } catch {}
      this.processorNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }
    if (this.silentSinkNode) {
      try {
        this.silentSinkNode.disconnect();
      } catch {}
      this.silentSinkNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private processAndTransmit16kFrame(samples256: Float32Array) {
    if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const canSendVoicemail = this.callState === 'voicemail' || this.isVoicemail;
    const canSendLoopback = this.callState === 'connected' && this.isLoopback;
    const canSendE2ee =
      this.callState === 'connected' &&
      !this.isSystemLine &&
      !this.isVoicemail &&
      Boolean(this.e2eeSession?.isReady());

    if (!canSendVoicemail && !canSendLoopback && !canSendE2ee) {
      return;
    }

    const pcm16 = new Int16Array(samples256.length);
    const sensitivityGain = this.micSensitivity / 50.0;

    for (let i = 0; i < samples256.length; i++) {
      let sample = samples256[i] || 0;

      if (this.outboundAgcEnabled) {
        const absVal = Math.abs(sample);
        if (absVal < 0.009) {
          sample = sample * 0.15;
        } else {
          const alpha = absVal > this.micRmsLevel ? 0.01 : 0.001;
          this.micRmsLevel = (1.0 - alpha) * this.micRmsLevel + alpha * absVal;
          let targetGain = 0.14 / (this.micRmsLevel + 0.006);
          targetGain = Math.max(0.5, Math.min(3.5, targetGain));
          this.micAgcGain = 0.99 * this.micAgcGain + 0.01 * targetGain;
          sample = sample * this.micAgcGain * sensitivityGain;
        }
      } else {
        sample = sample * sensitivityGain;
      }

      sample = Math.max(-1, Math.min(1, sample));
      pcm16[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }

    if (canSendVoicemail) {
      const frame = new Uint8Array(1 + pcm16.byteLength);
      frame[0] = 0x02;
      frame.set(new Uint8Array(pcm16.buffer), 1);
      this.ws.send(frame.buffer);
    } else if (canSendLoopback) {
      const frame = new Uint8Array(1 + pcm16.byteLength);
      frame[0] = 0x00;
      frame.set(new Uint8Array(pcm16.buffer), 1);
      this.ws.send(frame.buffer);
    } else if (canSendE2ee && this.e2eeSession) {
      void this.e2eeSession
        .encryptPcmFrame(pcm16)
        .then((encryptedFrame) => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isMuted) {
            this.ws.send(encryptedFrame.buffer);
          }
        })
        .catch(() => {});
    }
  }

  public async startMicrophoneCapture(): Promise<void> {
    this.cleanupMicrophoneNodes();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        }
      });
    } catch (err: any) {
      const msg = `Microphone access denied or unavailable: ${err?.message || 'Permission denied'}`;
      console.warn('[WebSoftphone]', msg);
      this.emitError(msg);
      return;
    }

    const ctx = this.initAudioContext();
    this.mediaStream = stream;
    this.sourceNode = ctx.createMediaStreamSource(stream);
    this.silentSinkNode = ctx.createGain();
    this.silentSinkNode.gain.setValueAtTime(0, ctx.currentTime);
    this.silentSinkNode.connect(ctx.destination);

    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        if (!WebAudioSoftphone.captureWorkletContexts.has(ctx)) {
          const blob = new Blob([CAPTURE_WORKLET_CODE], { type: 'application/javascript' });
          const blobUrl = URL.createObjectURL(blob);
          try {
            await ctx.audioWorklet.addModule(blobUrl);
            WebAudioSoftphone.captureWorkletContexts.add(ctx);
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }

        const worklet = new AudioWorkletNode(ctx, 'decatone-capture-processor');
        worklet.port.onmessage = (ev) => {
          if (ev.data instanceof Float32Array) {
            this.processAndTransmit16kFrame(ev.data);
          }
        };
        this.workletNode = worklet;
        this.sourceNode.connect(worklet);
        worklet.connect(this.silentSinkNode);
        return;
      } catch (workletErr) {
        console.warn('[WebSoftphone] Capture AudioWorklet unavailable, falling back to ScriptProcessor:', workletErr);
      }
    }

    const processor = ctx.createScriptProcessor(1024, 1, 1);
    const dt = 1.0 / ctx.sampleRate;
    const rc = 1.0 / (2.0 * Math.PI * 3600.0);
    const alpha = dt / (rc + dt);
    const ratio = ctx.sampleRate / 16000.0;
    let iirState = 0;
    let fir0 = 0;
    let fir1 = 0;
    let fir2 = 0;
    let phase = 0;
    const frameBuf = new Float32Array(256);
    let frameIdx = 0;

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < inputData.length; i++) {
        const x = inputData[i];
        const fir = 0.25 * (x + fir0 + fir1 + fir2);
        fir2 = fir1;
        fir1 = fir0;
        fir0 = x;
        iirState += alpha * (fir - iirState);

        phase += 1.0;
        if (phase >= ratio) {
          phase -= ratio;
          frameBuf[frameIdx++] = iirState;
          if (frameIdx >= 256) {
            this.processAndTransmit16kFrame(new Float32Array(frameBuf));
            frameIdx = 0;
          }
        }
      }
    };

    this.processorNode = processor;
    this.sourceNode.connect(processor);
    processor.connect(this.silentSinkNode);
  }

  private playPcmPacket(bytesOrBuffer: Uint8Array | ArrayBuffer, slot = 0) {
    const u8 = bytesOrBuffer instanceof Uint8Array ? bytesOrBuffer : new Uint8Array(bytesOrBuffer);
    const sampleCount = Math.floor(u8.byteLength / 2);
    if (sampleCount <= 0) return;

    const aligned = new Int16Array(sampleCount);
    const view = new DataView(u8.buffer, u8.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      aligned[i] = view.getInt16(i * 2, true);
    }
    this.playSlotInt16(slot, aligned);
  }

  private playSlotInt16(slot: number, pcm16: Int16Array) {
    try {
      if (pcm16.length === 0) return;
      const ctx = this.initAudioContext();

      if (this.playbackWorkletNode) {
        const f32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          f32[i] = pcm16[i] / 32768.0;
        }
        this.playbackWorkletNode.port.postMessage({ type: 'pcm', slot: slot & 0x07, samples: f32 }, [f32.buffer]);
        return;
      }

      // Legacy fallback scheduling when AudioWorklet unavailable
      const audioBuffer = ctx.createBuffer(1, pcm16.length, 16000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0;
      }

      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(this.playbackInputGain || ctx.destination);

      const currentTime = ctx.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime + 0.02;
      } else if (this.nextPlayTime > currentTime + 0.35) {
        this.nextPlayTime = currentTime + 0.08;
      }

      bufferSource.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
    } catch (e) {
      console.error('[WebSoftphone] Audio playback error:', e);
    }
  }

  public async call(destination: string, userId?: number): Promise<void> {
    this.clearCallTimers();
    this.stopTone();
    this.nextPlayTime = 0;
    this.isSystemLine = false;
    this.isVoicemail = false;
    this.isLoopback = false;
    this.e2eeSession = null;
    this.peerTrustByDevice.clear();
    this.emitE2eeEstablished(null, 'none');

    this.initAudioContext();
    await this.connectSocket(userId);
    await this.startMicrophoneCapture();

    this.callState = 'dialing';
    this.emitStateChange('dialing');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'hook_state',
          deviceId: this.deviceId,
          state: 'off_hook'
        })
      );

      for (let i = 0; i < destination.length; i++) {
        const digit = destination[i];
        const t = setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({
                type: 'dial_digit',
                deviceId: this.deviceId,
                digit
              })
            );
          }
        }, (i + 1) * 120);
        this.dialTimeouts.push(t);
      }
    }
  }

  public async answer(callId: string, userId?: number): Promise<void> {
    this.clearCallTimers();
    this.stopTone();
    this.nextPlayTime = 0;
    this.currentCallId = callId;
    this.isSystemLine = false;
    this.isVoicemail = false;
    this.isLoopback = false;
    this.peerTrustByDevice.clear();

    this.initAudioContext();
    await this.connectSocket(userId);
    await this.startMicrophoneCapture();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'call_answer',
          deviceId: this.deviceId,
          callId
        })
      );
    }

    this.callState = 'connected';
    this.emitStateChange('connected');
  }

  public async answerIncoming(callId: string, userId?: number): Promise<void> {
    return this.answer(callId, userId);
  }

  public declineToVoicemail(callId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'call_decline_to_voicemail',
            deviceId: this.deviceId,
            callId
          })
        );
      } catch {
        // Ignore
      }
    }
  }

  public sendInCallDigit(digit: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'dial_digit',
          deviceId: this.deviceId,
          digit
        })
      );
    }
  }

  public endCall(reason = 'hangup', fromServer = false) {
    this.clearCallTimers();
    this.stopTone();
    this.clearFallbackVoicemailPlayback();
    this.vmStreamState = null;
    this.nextPlayTime = 0;

    if (this.playbackWorkletNode) {
      try {
        this.playbackWorkletNode.port.postMessage({ type: 'reset' });
      } catch {
        // Ignore
      }
    }

    if (!fromServer && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'call_hangup',
            deviceId: this.deviceId
          })
        );
      } catch {}
    }

    this.cleanupMicrophoneNodes();
    this.e2eeSession = null;
    this.e2eeInitPromise = null;
    this.peerTrustByDevice.clear();
    this.isSystemLine = false;
    this.isVoicemail = false;
    this.isLoopback = false;
    this.isMuted = false;
    this.emitMuteChange(false);
    this.emitE2eeEstablished(null, 'none');

    if (this.callState !== 'idle') {
      this.callState = 'ended';
      this.emitStateChange('ended');
      this.emitCallEnded(reason);

      this.idleResetTimeout = setTimeout(() => {
        this.idleResetTimeout = null;
        this.callState = 'idle';
        this.emitStateChange('idle');
      }, 1500);
    }
  }

  public destroy() {
    this.endCall('destroy', true);
    this.clearHeartbeat();
    if (this.playbackWorkletNode) {
      try {
        this.playbackWorkletNode.port.onmessage = null;
        this.playbackWorkletNode.disconnect();
      } catch {}
      this.playbackWorkletNode = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}

export const softphone = WebAudioSoftphone.getInstance();
