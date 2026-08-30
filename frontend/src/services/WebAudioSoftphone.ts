/**
 * DecaTone WebAudioSoftphone
 * Real-time bidirectional 16kHz 16-bit Linear PCM audio streaming over WebSocket.
 * Features full DSP audio pipeline matching ESP32-S3 firmware:
 * - Outbound: Noise gate & adaptive dynamic AGC
 * - Inbound: Dynamic range leveling, vintage bandpass filtering (300Hz-3.4kHz), and carbon mic warmth saturation.
 */

export type SoftphoneCallState = 'idle' | 'dialing' | 'ringing' | 'connected' | 'parked' | 'ended';
export type AudioProfileType = 'vintage_pots' | 'early_1930s' | 'modern_hd';

export interface SoftphoneEvents {
  onStateChange?: (state: SoftphoneCallState) => void;
  onCallConnected?: (info: { number: string; name?: string }) => void;
  onCallEnded?: (reason?: string) => void;
  onError?: (err: string) => void;
}

export class WebAudioSoftphone {
  private static instance: WebAudioSoftphone;
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private ws: WebSocket | null = null;
  private callState: SoftphoneCallState = 'idle';
  private events: SoftphoneEvents = {};
  private activeDeviceId: string = '';
  private nextPlayTime: number = 0;
  private isMuted: boolean = false;

  // Audio DSP Settings (mirrors ESP32 audio_manager)
  private activeProfile: AudioProfileType = 'vintage_pots';
  private speakerVolume: number = 80;
  private micSensitivity: number = 80;
  private outboundAgcEnabled: boolean = true;
  private inboundNormEnabled: boolean = true;

  // DSP Node Graph for Inbound Playback
  private playbackCompressor: DynamicsCompressorNode | null = null;
  private playbackHighpass: BiquadFilterNode | null = null;
  private playbackLowpass: BiquadFilterNode | null = null;
  private playbackWaveShaper: WaveShaperNode | null = null;
  private playbackGainNode: GainNode | null = null;

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

  public setEvents(events: SoftphoneEvents) {
    this.events = events;
  }

  public getCallState(): SoftphoneCallState {
    return this.callState;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public isMicrophoneMuted(): boolean {
    return this.isMuted;
  }

  public setSpeakerVolume(volumePercent: number) {
    this.speakerVolume = Math.max(0, Math.min(100, volumePercent));
    if (this.playbackGainNode) {
      this.playbackGainNode.gain.setValueAtTime(this.speakerVolume / 100.0, this.audioCtx?.currentTime || 0);
    }
  }

  public setMicSensitivity(gainPercent: number) {
    this.micSensitivity = Math.max(0, Math.min(100, gainPercent));
  }

  public setAudioProfile(profile: AudioProfileType) {
    this.activeProfile = profile;
    this.updateDspNodes();
  }

  public setOutboundAgcEnabled(enabled: boolean) {
    this.outboundAgcEnabled = enabled;
  }

  public setInboundNormalizationEnabled(enabled: boolean) {
    this.inboundNormEnabled = enabled;
  }

  /**
   * Generates polynomial soft-saturation curve: f(x) = x - (x^3)/3 (matching ESP32 applyVintageWarmth)
   */
  private makeDistortionCurve(drive = 1.15): any {
    const n_samples = 44100;
    const buffer = new ArrayBuffer(n_samples * 4);
    const curve = new Float32Array(buffer);
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      let scaledX = x * drive;
      if (scaledX > 1.2) scaledX = 1.2;
      if (scaledX < -1.2) scaledX = -1.2;
      curve[i] = scaledX - (scaledX * scaledX * scaledX) * 0.333;
    }
    return curve;
  }

  /**
   * Initializes or resumes the AudioContext and sets up the inbound DSP node chain
   */
  public initAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.setupDspChain();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  private setupDspChain() {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;

    // 1. Inbound Dynamic Range Leveler / Compressor (-18 dBFS target)
    this.playbackCompressor = ctx.createDynamicsCompressor();
    this.playbackCompressor.threshold.setValueAtTime(-18, ctx.currentTime);
    this.playbackCompressor.knee.setValueAtTime(12, ctx.currentTime);
    this.playbackCompressor.ratio.setValueAtTime(4, ctx.currentTime);
    this.playbackCompressor.attack.setValueAtTime(0.003, ctx.currentTime);
    this.playbackCompressor.release.setValueAtTime(0.25, ctx.currentTime);

    // 2. High-pass Filter (~300Hz)
    this.playbackHighpass = ctx.createBiquadFilter();
    this.playbackHighpass.type = 'highpass';
    this.playbackHighpass.frequency.setValueAtTime(300, ctx.currentTime);
    this.playbackHighpass.Q.setValueAtTime(0.7, ctx.currentTime);

    // 3. Low-pass Filter (~3400Hz)
    this.playbackLowpass = ctx.createBiquadFilter();
    this.playbackLowpass.type = 'lowpass';
    this.playbackLowpass.frequency.setValueAtTime(3400, ctx.currentTime);
    this.playbackLowpass.Q.setValueAtTime(0.7, ctx.currentTime);

    // 4. Carbon Mic Harmonic Warmth Waveshaper
    this.playbackWaveShaper = ctx.createWaveShaper();
    this.playbackWaveShaper.curve = this.makeDistortionCurve(1.15);
    this.playbackWaveShaper.oversample = '2x';

    // 5. Master Gain Node
    this.playbackGainNode = ctx.createGain();
    this.playbackGainNode.gain.setValueAtTime(this.speakerVolume / 100.0, ctx.currentTime);

    // Wire DSP Chain: Compressor -> HighPass -> LowPass -> WaveShaper -> Gain -> Destination
    this.playbackCompressor.connect(this.playbackHighpass);
    this.playbackHighpass.connect(this.playbackLowpass);
    this.playbackLowpass.connect(this.playbackWaveShaper);
    this.playbackWaveShaper.connect(this.playbackGainNode);
    this.playbackGainNode.connect(ctx.destination);

    this.updateDspNodes();
  }

  private updateDspNodes() {
    if (!this.audioCtx || !this.playbackHighpass || !this.playbackLowpass || !this.playbackWaveShaper) return;
    const ctx = this.audioCtx;

    if (this.activeProfile === 'modern_hd') {
      // Pass-through linear wideband
      this.playbackHighpass.frequency.setValueAtTime(20, ctx.currentTime);
      this.playbackLowpass.frequency.setValueAtTime(20000, ctx.currentTime);
      this.playbackWaveShaper.curve = this.makeDistortionCurve(1.0);
    } else if (this.activeProfile === 'early_1930s') {
      // 1930s Early Bell (450Hz - 2500Hz + heavier non-linear carbon granule saturation)
      this.playbackHighpass.frequency.setValueAtTime(450, ctx.currentTime);
      this.playbackLowpass.frequency.setValueAtTime(2500, ctx.currentTime);
      this.playbackWaveShaper.curve = this.makeDistortionCurve(1.55);
    } else {
      // Vintage POTS (300Hz - 3400Hz standard Bell curve + mild carbon warmth)
      this.playbackHighpass.frequency.setValueAtTime(300, ctx.currentTime);
      this.playbackLowpass.frequency.setValueAtTime(3400, ctx.currentTime);
      this.playbackWaveShaper.curve = this.makeDistortionCurve(1.15);
    }
  }

  /**
   * Connects signaling and audio WebSocket to DecaTone switchboard
   */
  public connectSocket(userId?: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return resolve(this.ws);
      }

      this.activeDeviceId = `WEB-${userId || 'CLIENT'}-${Math.floor(1000 + Math.random() * 9000)}`;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/phone`;
      const socket = new WebSocket(wsUrl);

      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        // Register Web Client with switchboard
        socket.send(JSON.stringify({
          type: 'web_client_init',
          deviceId: this.activeDeviceId,
          userId
        }));
        this.ws = socket;
        resolve(socket);
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary audio packet received from peer / switchboard (16kHz 16-bit linear PCM mono)
          this.playPcmPacket(event.data);
        } else {
          try {
            const msg = JSON.parse(event.data);
            this.handleJsonMessage(msg);
          } catch (e) {}
        }
      };

      socket.onerror = (err) => {
        console.error('[WebSoftphone] WebSocket error:', err);
        reject(err);
      };

      socket.onclose = () => {
        this.ws = null;
      };
    });
  }

  private handleJsonMessage(msg: any) {
    switch (msg.type) {
      case 'call_connected':
        this.callState = 'connected';
        this.events.onStateChange?.('connected');
        this.events.onCallConnected?.({
          number: msg.calleeNumber || msg.callerNumber || 'Remote Line',
          name: msg.calleeName || msg.callerName
        });
        break;

      case 'call_ended':
        this.endCall(msg.reason);
        break;

      case 'play_tone':
        if (msg.tone === 'ringback') {
          this.callState = 'ringing';
          this.events.onStateChange?.('ringing');
        }
        break;
    }
  }

  /**
   * Starts capturing user microphone, applying Outbound AGC & Noise Gate, and streaming 16kHz PCM
   */
  public async startMicrophoneCapture() {
    try {
      const ctx = this.initAudioContext();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false // Using our custom matching AGC
        }
      });

      this.sourceNode = ctx.createMediaStreamSource(this.mediaStream);
      // Process audio in 4096-sample buffers, downsampling to 16kHz
      this.processorNode = ctx.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (this.callState !== 'connected' || this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const inputSampleRate = ctx.sampleRate;
        const targetSampleRate = 16000;

        // Downsample to 16kHz
        const ratio = inputSampleRate / targetSampleRate;
        const newLength = Math.round(inputData.length / ratio);
        const pcm16 = new Int16Array(newLength);
        const sensitivityGain = this.micSensitivity / 50.0; // 0.0 to 2.0x

        for (let i = 0; i < newLength; i++) {
          const originalIndex = Math.floor(i * ratio);
          let sample = inputData[originalIndex] || 0;

          // Outbound AGC & Noise Gate (matching ESP32 processOutboundAgc)
          if (this.outboundAgcEnabled) {
            const absVal = Math.abs(sample);
            if (absVal < 0.009) {
              // Noise gate: suppress background hiss/hum when quiet
              sample = sample * 0.15;
            } else {
              const alpha = (absVal > this.micRmsLevel) ? 0.01 : 0.001;
              this.micRmsLevel = (1.0 - alpha) * this.micRmsLevel + alpha * absVal;
              let targetGain = 0.14 / (this.micRmsLevel + 0.006);
              targetGain = Math.max(0.5, Math.min(3.5, targetGain));
              this.micAgcGain = 0.99 * this.micAgcGain + 0.01 * targetGain;
              sample = sample * this.micAgcGain * sensitivityGain;
            }
          }

          sample = Math.max(-1, Math.min(1, sample));
          pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        this.ws.send(pcm16.buffer);
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(ctx.destination);
    } catch (err: any) {
      console.warn('[WebSoftphone] Microphone access unavailable:', err);
    }
  }

  /**
   * Plays incoming 16kHz 16-bit linear PCM audio routed through the DSP filter chain
   */
  private playPcmPacket(arrayBuffer: ArrayBuffer) {
    try {
      const ctx = this.initAudioContext();
      const pcm16 = new Int16Array(arrayBuffer);
      if (pcm16.length === 0) return;

      const audioBuffer = ctx.createBuffer(1, pcm16.length, 16000);
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0;
      }

      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = audioBuffer;

      // Connect through DSP Filter & Compression Chain:
      if (this.playbackCompressor) {
        bufferSource.connect(this.playbackCompressor);
      } else {
        bufferSource.connect(ctx.destination);
      }

      const currentTime = ctx.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime + 0.02; // 20ms initial buffer
      }

      bufferSource.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
    } catch (e) {
      console.error('[WebSoftphone] Audio playback error:', e);
    }
  }

  /**
   * Places an outbound call from the browser
   */
  public async call(destination: string, userId?: number): Promise<void> {
    this.initAudioContext();
    await this.connectSocket(userId);
    await this.startMicrophoneCapture();

    this.callState = 'dialing';
    this.events.onStateChange?.('dialing');

    // Send dial sequence
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'hook_state',
        deviceId: this.activeDeviceId,
        state: 'off_hook'
      }));

      // Stream out dial digits with 120ms spacing
      for (let i = 0; i < destination.length; i++) {
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'dial_digit',
              deviceId: this.activeDeviceId,
              digit: destination[i]
            }));
          }
        }, (i + 1) * 120);
      }
    }
  }

  /**
   * Answers an incoming call in the browser softphone
   */
  public async answerIncoming(callId: string, userId?: number): Promise<void> {
    this.initAudioContext();
    await this.connectSocket(userId);
    await this.startMicrophoneCapture();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'call_answer',
        deviceId: this.activeDeviceId,
        callId
      }));
    }

    this.callState = 'connected';
    this.events.onStateChange?.('connected');
  }

  /**
   * Sends an in-call digit (e.g. '2' for mute, '3' for invite, '8' for park)
   */
  public sendInCallDigit(digit: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'dial_digit',
        deviceId: this.activeDeviceId,
        digit
      }));
    }
  }

  /**
   * Ends or hangs up active call
   */
  public endCall(reason = 'hangup') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'call_hangup',
          deviceId: this.activeDeviceId
        }));
      } catch (e) {}
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    this.callState = 'ended';
    this.events.onStateChange?.('ended');
    this.events.onCallEnded?.(reason);

    setTimeout(() => {
      this.callState = 'idle';
      this.events.onStateChange?.('idle');
    }, 1500);
  }
}

export const softphone = WebAudioSoftphone.getInstance();
