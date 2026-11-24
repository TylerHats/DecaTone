import https from 'https';
import net from 'net';
import { WebSocket } from 'ws';
import { query, queryOne } from '../db/connection';
import { TtsAudioService } from './ttsAudioService';

interface LoopbackSession {
  deviceId: string;
  ws: WebSocket;
  bufferQueue: { time: number; chunk: Buffer }[];
  intervalTimer?: NodeJS.Timeout;
}

function isPrivateOrLoopbackIp(rawIp: string): boolean {
  if (!rawIp) return true;
  let ip = rawIp.trim().toLowerCase();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (!net.isIP(ip)) return true;

  if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1' || ip === '::') {
    return true;
  }
  if (
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    ip.startsWith('100.64.')
  ) {
    return true;
  }
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1] || '0', 10);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) {
    return true;
  }
  return false;
}

export class ServiceLinesService {
  private loopbackSessions = new Map<string, LoopbackSession>();
  private pendingRingbacks = new Map<string, { userId?: number; timeout?: NodeJS.Timeout }>();
  private activeStreams = new Map<string, { timer: NodeJS.Timeout; resolve: () => void }>();
  private geocodeCache = new Map<string, { lat: number; lon: number; city: string }>();

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
    this.loopbackSessions.set(deviceId, session);

    const introAudio = await TtsAudioService.synthesizeSpeech(
      'DecaTone loopback test active. Speak into the handset to test audio.'
    );

    if (!this.loopbackSessions.has(deviceId)) return;
    await this.streamAudioBuffer(ws, introAudio, deviceId);
    if (!this.loopbackSessions.has(deviceId)) return;

    session.intervalTimer = setInterval(() => {
      const now = Date.now();
      while (session.bufferQueue.length > 0 && now - session.bufferQueue[0].time >= 350) {
        const item = session.bufferQueue.shift();
        if (item && ws.readyState === WebSocket.OPEN) {
          ws.send(item.chunk);
        }
      }
    }, 20);

    if (typeof session.intervalTimer.unref === 'function') {
      session.intervalTimer.unref();
    }

    console.log(`[Service Lines] Loopback Echo session started for ${deviceId}`);
  }

  public handleLoopbackAudioPacket(deviceId: string, packet: Buffer) {
    const session = this.loopbackSessions.get(deviceId);
    if (!session || session.ws.readyState !== WebSocket.OPEN || packet.length === 0) return;

    let framed: Buffer;
    if (packet.length > 1 && (packet.length - 1) % 2 === 0 && packet[0] === 0x00) {
      framed = Buffer.from(packet);
    } else if (packet.length > 1 && (packet.length - 1) % 2 === 0 && packet[0] === 0x02) {
      framed = Buffer.concat([Buffer.from([0x00]), packet.subarray(1)]);
    } else if (packet.length % 2 === 0) {
      framed = Buffer.concat([Buffer.from([0x00]), packet]);
    } else {
      return;
    }

    session.bufferQueue.push({
      time: Date.now(),
      chunk: framed
    });

    if (session.bufferQueue.length > 125) {
      session.bufferQueue.shift();
    }
  }

  public endLoopbackSession(deviceId: string) {
    const session = this.loopbackSessions.get(deviceId);
    if (session) {
      if (session.intervalTimer) clearInterval(session.intervalTimer);
      session.bufferQueue = [];
      this.loopbackSessions.delete(deviceId);
      console.log(`[Service Lines] Loopback Echo session ended for ${deviceId}`);
    }
    this.stopRawPcmPlaybackSession(deviceId);
  }

  public isLoopbackActive(deviceId: string): boolean {
    return this.loopbackSessions.has(deviceId);
  }

  /**
   * 411: Speaking Clock & Date Service (timezone-aware, uncached)
   */
  public async startSpeakingClockSession(deviceId: string, ws: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    await this.playSpeakingClock(ws, deviceId);
  }

  public async playSpeakingClock(ws: WebSocket, deviceId?: string) {
    let timeZone = 'UTC';
    try {
      const tzRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['system_timezone']);
      if (tzRow?.value?.trim()) {
        // Validate timezone
        Intl.DateTimeFormat('en-US', { timeZone: tzRow.value.trim() });
        timeZone = tzRow.value.trim();
      }
    } catch {}

    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    }).formatToParts(now);

    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const dayName = getPart('weekday');
    const monthName = getPart('month');
    const dateNum = getPart('day');
    const hours = getPart('hour');
    const minutes = parseInt(getPart('minute'), 10) || 0;
    const seconds = parseInt(getPart('second'), 10) || 0;
    const ampm = getPart('dayPeriod') || 'AM';

    const minStr = minutes === 0 ? "o'clock" : minutes < 10 ? `oh ${minutes}` : `${minutes}`;
    const text = `DecaTone time service. Today is ${dayName}, ${monthName} ${dateNum}. At the tone, the time will be ${hours} ${minStr} ${ampm}, and ${seconds} seconds.`;

    const speechAudio = await TtsAudioService.synthesizeSpeech(text, undefined, { cache: false });
    const pipTone = TtsAudioService.generateSineTone(1000, 600, 0.7);
    const postSilence = Buffer.alloc(Math.floor(TtsAudioService.SAMPLE_RATE * 1.2) * 2);

    const fullAudio = Buffer.concat([speechAudio, pipTone, postSilence]);
    await this.streamAudioBuffer(ws, fullAudio, deviceId);
  }

  /**
   * 611: Line & Hardware Diagnostics Service Line (uncached)
   */
  public async startLineDiagnosticsSession(
    deviceId: string,
    ws: WebSocket,
    liveTelemetry?: { rssi?: number; pps?: number; breakRatio?: number; freeHeap?: number; freePsram?: number }
  ) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const phone = deviceId.startsWith('WEB-')
      ? null
      : await queryOne<any>('SELECT * FROM phones WHERE device_id = ?', [deviceId]);

    let summary: string;
    if (!phone) {
      summary = 'DecaTone 6 1 1 line diagnostics. Connected via browser WebPhone softphone. End to end encryption P 256 active.';
    } else {
      const fw = phone.firmware_version || '1.3.0';
      const rssi = liveTelemetry?.rssi ?? phone.rssi ?? -52;
      const bellHz = Number(phone.bell_frequency_hz ?? 20).toFixed(1);
      const pps = liveTelemetry?.pps ?? phone.last_pps;
      const brk = liveTelemetry?.breakRatio ?? phone.last_break_ratio;
      const heapKb = liveTelemetry?.freeHeap ? Math.round(liveTelemetry.freeHeap / 1024) : phone.free_heap ? Math.round(phone.free_heap / 1024) : null;

      const parts: string[] = [
        `DecaTone 6 1 1 line diagnostics.`,
        `Firmware version ${fw}.`,
        `Wi-Fi signal strength ${rssi} d B m.`,
        `Mechanical bell resonance tuned to ${bellHz} Hertz.`
      ];

      if (typeof pps === 'number') {
        const ppsRounded = pps.toFixed(1);
        parts.push(`Measured rotary dial speed is ${ppsRounded} pulses per second`);
        if (pps < 8.5 || pps > 11.5) {
          parts.push(`Warning: governor speed is outside the standard 8.5 to 11.5 pulse range and may need cleaning or lubrication.`);
        }
      }
      if (typeof brk === 'number') {
        parts.push(`Make break ratio ${brk.toFixed(0)} percent.`);
      }
      if (heapKb !== null) {
        parts.push(`Free controller heap ${heapKb} kilobytes.`);
      }
      parts.push(phone.device_public_key ? 'Hardware identity key and end to end encryption verified.' : 'Device identity key pending enrollment.');
      summary = parts.join(' ');
    }

    const speech = await TtsAudioService.synthesizeSpeech(summary, undefined, { cache: false });
    const postSilence = Buffer.alloc(Math.floor(TtsAudioService.SAMPLE_RATE * 0.8) * 2);
    await this.streamAudioBuffer(ws, Buffer.concat([speech, postSilence]), deviceId);
  }

  /**
   * 711: Live Local Weather Hotline (respects weather_location & weather_units, uncached)
   */
  public async startWeatherSession(deviceId: string, callerIp?: string, ws?: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    await this.playLocalWeather(ws, callerIp || '', deviceId);
  }

  public async playLocalWeather(ws: WebSocket, callerIp: string, deviceId?: string) {
    try {
      const settingRows = await query<{ key: string; value: string }>(
        "SELECT key, value FROM system_settings WHERE key IN ('weather_location', 'weather_units')"
      );
      const settingsMap: Record<string, string> = {};
      for (const r of settingRows) settingsMap[r.key] = r.value;

      const isMetric = settingsMap['weather_units'] === 'metric';
      const configuredLocation = (settingsMap['weather_location'] || '').trim();

      let geo: { lat: number; lon: number; city: string } | null = null;
      if (configuredLocation) {
        geo = await this.geocodePlaceName(configuredLocation);
      }
      if (!geo) {
        const candidateIp = callerIp.split(',')[0].trim();
        const publicIp = isPrivateOrLoopbackIp(candidateIp) ? '' : candidateIp;
        geo = await this.lookupGeoIp(publicIp);
      }

      const lat = geo.lat || 40.7128;
      const lon = geo.lon || -74.006;
      const city = geo.city || 'your area';

      const weather = await this.fetchOpenMeteo(lat, lon, isMetric);
      const temp = Math.round(weather.temperature_2m);
      const humidity = Math.round(weather.relative_humidity_2m);
      const wind = Math.round(weather.wind_speed_10m);
      const condition = this.wmoCodeToDescription(weather.weather_code);
      const tempUnitLabel = isMetric ? 'degrees Celsius' : 'degrees Fahrenheit';
      const windUnitLabel = isMetric ? 'kilometers per hour' : 'miles per hour';

      const text = `DecaTone Weather Service. Current conditions for ${city}: ${condition}, ${temp} ${tempUnitLabel}, humidity ${humidity} percent, with winds at ${wind} ${windUnitLabel}.`;
      const speechAudio = await TtsAudioService.synthesizeSpeech(text, undefined, { cache: false });
      const postSilence = Buffer.alloc(Math.floor(TtsAudioService.SAMPLE_RATE * 1.2) * 2);

      await this.streamAudioBuffer(ws, Buffer.concat([speechAudio, postSilence]), deviceId);
    } catch (err) {
      console.error('[Service Lines] Weather fetch failed:', err);
      const fallbackAudio = await TtsAudioService.synthesizeSpeech(
        'DecaTone weather service. Unable to retrieve current local forecast. Please try again later.',
        undefined,
        { cache: false }
      );
      await this.streamAudioBuffer(ws, fallbackAudio, deviceId);
    }
  }

  /**
   * 111: Ringback Line Test Service
   */
  public async startRingbackTestSession(deviceId: string, userId: number | undefined, ws: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    this.pendingRingbacks.set(deviceId, { userId });

    const text = 'DecaTone ring back test service. Please hang up your receiver now. Your phone will ring in five seconds.';
    const speechAudio = await TtsAudioService.synthesizeSpeech(text);
    const postSilence = Buffer.alloc(Math.floor(TtsAudioService.SAMPLE_RATE * 2.5) * 2);
    await this.streamAudioBuffer(ws, Buffer.concat([speechAudio, postSilence]), deviceId);
  }

  public handleRingbackOnHook(deviceId: string, onTriggerRing: (deviceId: string, userId?: number) => void) {
    const entry = this.pendingRingbacks.get(deviceId);
    if (entry) {
      console.log(`[Service Lines] Handset hung up for Ringback Line Test on ${deviceId}. Ring scheduled in 5 seconds.`);
      if (entry.timeout) clearTimeout(entry.timeout);

      entry.timeout = setTimeout(() => {
        console.log(`[Service Lines] Executing Ringback Test Ring on ${deviceId}`);
        onTriggerRing(deviceId, entry.userId);
        this.pendingRingbacks.delete(deviceId);
      }, 5000);

      if (typeof entry.timeout.unref === 'function') {
        entry.timeout.unref();
      }
    }
  }

  public cancelRingbackTest(deviceId: string) {
    const entry = this.pendingRingbacks.get(deviceId);
    if (entry) {
      if (entry.timeout) clearTimeout(entry.timeout);
      this.pendingRingbacks.delete(deviceId);
    }
  }

  public async startModemHandshakeSession(deviceId: string, ws: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    console.log(`[Service Lines] Starting Dial-Up Modem Handshake Simulator for ${deviceId}`);
    const modemAudio = TtsAudioService.generateModemHandshakeTone(9.0);
    await this.streamAudioBuffer(ws, modemAudio, deviceId);
  }

  public async startRawPcmPlaybackSession(deviceId: string, pcmBuffer: Buffer, ws?: WebSocket) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this.stopRawPcmPlaybackSession(deviceId);
    await this.streamAudioBuffer(ws, pcmBuffer, deviceId);
  }

  public stopRawPcmPlaybackSession(deviceId: string) {
    const active = this.activeStreams.get(deviceId);
    if (active) {
      clearInterval(active.timer);
      this.activeStreams.delete(deviceId);
      active.resolve();
    }
  }

  public cleanupDevice(deviceId: string) {
    this.stopRawPcmPlaybackSession(deviceId);
    this.endLoopbackSession(deviceId);
    this.cancelRingbackTest(deviceId);
  }

  private geocodePlaceName(locationStr: string): Promise<{ lat: number; lon: number; city: string } | null> {
    const cached = this.geocodeCache.get(locationStr.toLowerCase());
    if (cached) return Promise.resolve(cached);

    // Allow explicit "lat,lon" coordinates too
    const coordMatch = locationStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        const res = { lat, lon, city: 'your configured area' };
        this.geocodeCache.set(locationStr.toLowerCase(), res);
        return Promise.resolve(res);
      }
    }

    return new Promise((resolve) => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationStr)}&count=1&format=json`;
      const req = https.get(url, { timeout: 3500, headers: { 'User-Agent': 'DecaTone-Weather/1.3' } }, (res) => {
        let data = '';
        res.on('data', (c) => { if (data.length < 32768) data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const first = parsed?.results?.[0];
            if (first && typeof first.latitude === 'number' && typeof first.longitude === 'number') {
              const out = {
                lat: first.latitude,
                lon: first.longitude,
                city: String(first.name || locationStr)
              };
              this.geocodeCache.set(locationStr.toLowerCase(), out);
              return resolve(out);
            }
          } catch {}
          resolve(null);
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    });
  }

  private lookupGeoIp(ip: string): Promise<{ lat: number; lon: number; city: string }> {
    return new Promise((resolve) => {
      const safePath = ip && !isPrivateOrLoopbackIp(ip) ? encodeURIComponent(ip) : '';
      const url = `https://ipwho.is/${safePath}`;

      const req = https.get(
        url,
        {
          timeout: 3500,
          headers: { 'User-Agent': 'DecaTone-Weather/1.3', Accept: 'application/json' }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            if (data.length < 32768) data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed && parsed.success !== false) {
                const lat = Number(parsed.latitude ?? parsed.lat);
                const lon = Number(parsed.longitude ?? parsed.lon);
                if (!isNaN(lat) && !isNaN(lon)) {
                  return resolve({
                    lat,
                    lon,
                    city: String(parsed.city || 'your area')
                  });
                }
              }
            } catch {}
            resolve({ lat: 40.7128, lon: -74.006, city: 'Local Region' });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ lat: 40.7128, lon: -74.006, city: 'Local Region' });
      });

      req.on('error', () => {
        resolve({ lat: 40.7128, lon: -74.006, city: 'Local Region' });
      });
    });
  }

  private fetchOpenMeteo(lat: number, lon: number, isMetric: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      const safeLat = encodeURIComponent(lat.toFixed(4));
      const safeLon = encodeURIComponent(lon.toFixed(4));
      const tempUnit = isMetric ? 'celsius' : 'fahrenheit';
      const windUnit = isMetric ? 'kmh' : 'mph';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${safeLat}&longitude=${safeLon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;

      const req = https.get(
        url,
        {
          timeout: 4000,
          headers: { 'User-Agent': 'DecaTone-Weather/1.3', Accept: 'application/json' }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            if (data.length < 65536) data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed?.current) return resolve(parsed.current);
              reject(new Error('No current weather data'));
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Open-Meteo request timed out'));
      });

      req.on('error', reject);
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

  public streamAudioBuffer(ws: WebSocket, pcmBuffer: Buffer, deviceId?: string): Promise<void> {
    if (deviceId) {
      this.stopRawPcmPlaybackSession(deviceId);
    }

    return new Promise((resolve) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || pcmBuffer.length === 0) {
        return resolve();
      }

      const chunkSize = 512;
      let offset = 0;

      const interval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || offset >= pcmBuffer.length) {
          clearInterval(interval);
          if (deviceId) this.activeStreams.delete(deviceId);
          resolve();
          return;
        }

        const pcmSlice = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length));
        const framed = Buffer.allocUnsafe(1 + pcmSlice.length);
        framed[0] = 0x00;
        pcmSlice.copy(framed, 1);

        ws.send(framed);
        offset += chunkSize;
      }, 16);

      if (typeof interval.unref === 'function') {
        interval.unref();
      }

      if (deviceId) {
        this.activeStreams.set(deviceId, { timer: interval, resolve });
      }
    });
  }
}

export const serviceLinesService = new ServiceLinesService();
