import https from 'https';
import http from 'http';
import { WebSocket } from 'ws';
import { TtsAudioService } from './ttsAudioService';

interface LoopbackSession {
  deviceId: string;
  ws: WebSocket;
  bufferQueue: { time: number; chunk: Buffer }[];
  intervalTimer?: NodeJS.Timeout;
}

export class ServiceLinesService {
  private loopbackSessions = new Map<string, LoopbackSession>(); // deviceId -> session

  /**
   * 119 / 099: Start Audio Loopback & Sidetone Echo Test (350ms delay)
   */
  public async startLoopbackSession(deviceId: string, ws: WebSocket) {
    this.endLoopbackSession(deviceId);

    const session: LoopbackSession = {
      deviceId,
      ws,
      bufferQueue: []
    };

    // Play intro prompt
    const introAudio = await TtsAudioService.synthesizeSpeech('DecaTone loopback test active. Speak into the handset to test audio.');
    this.streamAudioBuffer(ws, introAudio);

    // Process queued delay buffer every 20ms
    session.intervalTimer = setInterval(() => {
      const now = Date.now();
      while (session.bufferQueue.length > 0 && (now - session.bufferQueue[0].time) >= 350) {
        const item = session.bufferQueue.shift();
        if (item && ws.readyState === WebSocket.OPEN) {
          ws.send(item.chunk);
        }
      }
    }, 20);

    this.loopbackSessions.set(deviceId, session);
    console.log(`[Service Lines] 🔁 Loopback Echo session started for ${deviceId}`);
  }

  public handleLoopbackAudioPacket(deviceId: string, packet: Buffer) {
    const session = this.loopbackSessions.get(deviceId);
    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.bufferQueue.push({
        time: Date.now(),
        chunk: Buffer.from(packet)
      });
      // Safety cap on buffer queue (max 2 seconds of audio)
      if (session.bufferQueue.length > 100) {
        session.bufferQueue.shift();
      }
    }
  }

  public endLoopbackSession(deviceId: string) {
    const session = this.loopbackSessions.get(deviceId);
    if (session) {
      if (session.intervalTimer) clearInterval(session.intervalTimer);
      session.bufferQueue = [];
      this.loopbackSessions.delete(deviceId);
      console.log(`[Service Lines] 🔁 Loopback Echo session ended for ${deviceId}`);
    }
  }

  public isLoopbackActive(deviceId: string): boolean {
    return this.loopbackSessions.has(deviceId);
  }

  /**
   * 411: Speaking Clock & Date Service
   */
  public async startSpeakingClockSession(deviceId: string, ws: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    await this.playSpeakingClock(ws);
  }

  public async playSpeakingClock(ws: WebSocket) {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    const minStr = minutes < 10 ? `oh ${minutes}` : `${minutes}`;
    const text = `DecaTone time service. Today is ${dayName}, ${monthName} ${dateNum}. At the tone, the time will be ${hours}:${minStr} ${ampm}, and ${seconds} seconds.`;

    const speechAudio = await TtsAudioService.synthesizeSpeech(text);
    const pipTone = TtsAudioService.generateSineTone(1000, 600, 0.7); // 1000Hz NIST-style pip tone
    const postSilence = Buffer.alloc(TtsAudioService.SAMPLE_RATE * 1.5 * 2);

    const fullAudio = Buffer.concat([speechAudio, pipTone, postSilence]);
    await this.streamAudioBuffer(ws, fullAudio);
  }

  /**
   * 711: Live Local Weather Hotline
   */
  public async startWeatherSession(deviceId: string, callerIp?: string, ws?: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    await this.playLocalWeather(ws, callerIp || '');
  }

  public async playLocalWeather(ws: WebSocket, callerIp: string) {
    try {
      // 1. Resolve Geolocation from Caller IP (handling reverse-proxies)
      let cleanIp = callerIp.split(',')[0].trim();
      if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.')) {
        cleanIp = ''; // Fallback to server public IP
      }

      const geo = await this.lookupGeoIp(cleanIp);
      const lat = geo.lat || 40.7128;
      const lon = geo.lon || -74.0060;
      const city = geo.city || 'your area';

      // 2. Fetch real-time weather from Open-Meteo
      const weather = await this.fetchOpenMeteo(lat, lon);
      const tempF = Math.round(weather.temperature_2m);
      const humidity = Math.round(weather.relative_humidity_2m);
      const windMph = Math.round(weather.wind_speed_10m);
      const condition = this.wmoCodeToDescription(weather.weather_code);

      const text = `DecaTone Weather Service. Current conditions for ${city}: ${condition}, ${tempF} degrees Fahrenheit, humidity ${humidity} percent, with winds at ${windMph} miles per hour.`;
      const speechAudio = await TtsAudioService.synthesizeSpeech(text);
      const postSilence = Buffer.alloc(TtsAudioService.SAMPLE_RATE * 1.5 * 2);

      await this.streamAudioBuffer(ws, Buffer.concat([speechAudio, postSilence]));
    } catch (err) {
      console.error('[Service Lines] Weather fetch failed:', err);
      const fallbackAudio = await TtsAudioService.synthesizeSpeech('DecaTone weather service. Unable to retrieve current local forecast. Please try again later.');
      await this.streamAudioBuffer(ws, fallbackAudio);
    }
  }

  /**
   * 111: Ringback Line Test Service
   * Prompts user to hang up receiver; after 5 seconds of on-hook, triggers delayed test ring!
   */
  private pendingRingbacks = new Map<string, { userId?: number; timeout?: NodeJS.Timeout }>();

  public async startRingbackTestSession(deviceId: string, userId: number | undefined, ws: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    // Register device as waiting for hangup
    this.pendingRingbacks.set(deviceId, { userId });

    const text = 'DecaTone ring back test service. Please hang up your receiver now. Your phone will ring in five seconds.';
    const speechAudio = await TtsAudioService.synthesizeSpeech(text);
    const postSilence = Buffer.alloc(TtsAudioService.SAMPLE_RATE * 3 * 2);
    await this.streamAudioBuffer(ws, Buffer.concat([speechAudio, postSilence]));
  }

  public handleRingbackOnHook(deviceId: string, onTriggerRing: (deviceId: string, userId?: number) => void) {
    const entry = this.pendingRingbacks.get(deviceId);
    if (entry) {
      console.log(`[Service Lines] ☎️ Handset hung up for Ringback Line Test on ${deviceId}. Ring scheduled in 5 seconds.`);
      if (entry.timeout) clearTimeout(entry.timeout);
      
      entry.timeout = setTimeout(() => {
        console.log(`[Service Lines] 🔔 Executing Ringback Test Ring on ${deviceId}`);
        onTriggerRing(deviceId, entry.userId);
        this.pendingRingbacks.delete(deviceId);
      }, 5000);
    }
  }

  public cancelRingbackTest(deviceId: string) {
    const entry = this.pendingRingbacks.get(deviceId);
    if (entry) {
      if (entry.timeout) clearTimeout(entry.timeout);
      this.pendingRingbacks.delete(deviceId);
    }
  }

  /**
   * 567: Dial-Up Modem Handshake & Data Transmission Nostalgia Line
   */
  public async startModemHandshakeSession(deviceId: string, ws: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    console.log(`[Service Lines] 📠 Starting Dial-Up Modem Handshake Simulator for ${deviceId}`);
    const modemAudio = TtsAudioService.generateModemHandshakeTone(9.0);
    await this.streamAudioBuffer(ws, modemAudio);
  }

  private activeStreams = new Map<string, NodeJS.Timeout>();

  /**
   * Plays raw PCM audio to a device (cancellable)
   */
  public async startRawPcmPlaybackSession(deviceId: string, pcmBuffer: Buffer, ws?: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this.stopRawPcmPlaybackSession(deviceId);
    await this.streamAudioBuffer(ws, pcmBuffer, deviceId);
  }

  public stopRawPcmPlaybackSession(deviceId: string) {
    const timer = this.activeStreams.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.activeStreams.delete(deviceId);
    }
  }

  private lookupGeoIp(ip: string): Promise<{ lat: number; lon: number; city: string }> {
    return new Promise((resolve) => {
      const url = ip ? `http://ip-api.com/json/${ip}` : 'http://ip-api.com/json/';
      http.get(url, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status === 'success') {
              return resolve({ lat: parsed.lat, lon: parsed.lon, city: parsed.city });
            }
          } catch (e) {}
          resolve({ lat: 40.7128, lon: -74.0060, city: 'Local Region' });
        });
      }).on('error', () => {
        resolve({ lat: 40.7128, lon: -74.0060, city: 'Local Region' });
      });
    });
  }

  private fetchOpenMeteo(lat: number, lon: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
      https.get(url, { timeout: 4000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.current) return resolve(parsed.current);
            reject(new Error('No current weather data'));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  private wmoCodeToDescription(code: number): string {
    switch (code) {
      case 0: return 'clear skies';
      case 1:
      case 2: return 'mostly sunny and partly cloudy';
      case 3: return 'overcast';
      case 45:
      case 48: return 'foggy conditions';
      case 51:
      case 53:
      case 55: return 'light drizzle';
      case 61:
      case 63: return 'rain showers';
      case 65: return 'heavy rain';
      case 71:
      case 73:
      case 75: return 'snow showers';
      case 80:
      case 81:
      case 82: return 'passing rain showers';
      case 95:
      case 96:
      case 99: return 'thunderstorms';
      default: return 'fair conditions';
    }
  }

  /**
   * Streams a PCM buffer at real-time 16kHz rate over WebSocket in 512-byte frames (16ms per frame)
   */
  public streamAudioBuffer(ws: WebSocket, pcmBuffer: Buffer, deviceId?: string): Promise<void> {
    return new Promise((resolve) => {
      const chunkSize = 512; // 256 16-bit samples = 16ms of audio
      let offset = 0;

      const interval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || offset >= pcmBuffer.length) {
          clearInterval(interval);
          if (deviceId) this.activeStreams.delete(deviceId);
          resolve();
          return;
        }

        const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length));
        ws.send(chunk);
        offset += chunkSize;
      }, 16);

      if (deviceId) {
        this.activeStreams.set(deviceId, interval);
      }
    });
  }
}

export const serviceLinesService = new ServiceLinesService();
