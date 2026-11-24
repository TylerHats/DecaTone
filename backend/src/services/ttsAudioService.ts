import fs from 'fs';
import path from 'path';
import https from 'https';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import * as tar from 'tar';
import { KOKORO_DIR, PIPER_DIR, TTS_VOICES_DIR, ensureDirectories } from '../config/paths';
import { execute, query, queryOne } from '../db/connection';
import { VoicemailCryptoService } from './voicemailCryptoService';

export type TtsEngineType = 'piper' | 'kokoro' | 'espeak' | 'procedural';

export interface VoiceCatalogEntry {
  id: string;
  name: string;
  description: string;
  engine: TtsEngineType;
  locale: string;
  gender: 'female' | 'male' | 'neutral';
  hfSubpath?: string;
  kokoroVoiceId?: string;
  espeakVoice?: string;
}

export interface TtsDownloadState {
  status: 'idle' | 'downloading' | 'ready' | 'error';
  engine: TtsEngineType | null;
  voiceId: string | null;
  progress: number;
  file: string;
  loadedBytes: number;
  totalBytes: number;
  message: string;
  error: string | null;
}

export const AVAILABLE_VOICES: VoiceCatalogEntry[] = [
  // Piper Neural ONNX Voices (Recommended Lightweight Default)
  {
    id: 'en_US-lessac-medium',
    name: 'Lessac — US Female Central Office Operator',
    description: 'Piper Neural ONNX — warm, articulate North American switchboard operator (~65 MB).',
    engine: 'piper',
    locale: 'en-US',
    gender: 'female',
    hfSubpath: 'en/en_US/lessac/medium/en_US-lessac-medium'
  },
  {
    id: 'en_US-amy-medium',
    name: 'Amy — US Female Clear Modern',
    description: 'Piper Neural ONNX — crisp, natural modern American English (~65 MB).',
    engine: 'piper',
    locale: 'en-US',
    gender: 'female',
    hfSubpath: 'en/en_US/amy/medium/en_US-amy-medium'
  },
  {
    id: 'en_US-ryan-medium',
    name: 'Ryan — US Male Broadcast Announcer',
    description: 'Piper Neural ONNX — authoritative American broadcast announcer (~65 MB).',
    engine: 'piper',
    locale: 'en-US',
    gender: 'male',
    hfSubpath: 'en/en_US/ryan/medium/en_US-ryan-medium'
  },
  {
    id: 'en_GB-alba-medium',
    name: 'Alba — UK GPO Female Operator',
    description: 'Piper Neural ONNX — classic British General Post Office exchange cadence (~65 MB).',
    engine: 'piper',
    locale: 'en-GB',
    gender: 'female',
    hfSubpath: 'en/en_GB/alba/medium/en_GB-alba-medium'
  },
  {
    id: 'en_GB-alan-medium',
    name: 'Alan — UK GPO Male Operator',
    description: 'Piper Neural ONNX — British male speaking clock & time announcer (~65 MB).',
    engine: 'piper',
    locale: 'en-GB',
    gender: 'male',
    hfSubpath: 'en/en_GB/alan/medium/en_GB-alan-medium'
  },

  // Kokoro-82M Neural ONNX Voices (Optional High-Naturalness Engine)
  {
    id: 'kokoro_af_heart',
    name: 'Heart — US Female Natural Warm',
    description: 'Kokoro Neural ONNX — lifelike conversational warmth and studio prosody.',
    engine: 'kokoro',
    locale: 'en-US',
    gender: 'female',
    kokoroVoiceId: 'af_heart'
  },
  {
    id: 'kokoro_af_bella',
    name: 'Bella — US Female Expressive Operator',
    description: 'Kokoro Neural ONNX — expressive, clear American female switchboard voice.',
    engine: 'kokoro',
    locale: 'en-US',
    gender: 'female',
    kokoroVoiceId: 'af_bella'
  },
  {
    id: 'kokoro_af_nova',
    name: 'Nova — US Female Crisp Modern',
    description: 'Kokoro Neural ONNX — bright, poised American English voice.',
    engine: 'kokoro',
    locale: 'en-US',
    gender: 'female',
    kokoroVoiceId: 'af_nova'
  },
  {
    id: 'kokoro_am_michael',
    name: 'Michael — US Male Classic Announcer',
    description: 'Kokoro Neural ONNX — natural, warm American baritone announcer.',
    engine: 'kokoro',
    locale: 'en-US',
    gender: 'male',
    kokoroVoiceId: 'am_michael'
  },
  {
    id: 'kokoro_am_fenrir',
    name: 'Fenrir — US Male Deep Studio',
    description: 'Kokoro Neural ONNX — deep, authoritative broadcast male voice.',
    engine: 'kokoro',
    locale: 'en-US',
    gender: 'male',
    kokoroVoiceId: 'am_fenrir'
  },
  {
    id: 'kokoro_bf_emma',
    name: 'Emma — UK Female GPO Operator',
    description: 'Kokoro Neural ONNX — polished Southern British operator voice.',
    engine: 'kokoro',
    locale: 'en-GB',
    gender: 'female',
    kokoroVoiceId: 'bf_emma'
  },
  {
    id: 'kokoro_bm_george',
    name: 'George — UK Male Speaking Clock',
    description: 'Kokoro Neural ONNX — dignified British male announcer.',
    engine: 'kokoro',
    locale: 'en-GB',
    gender: 'male',
    kokoroVoiceId: 'bm_george'
  },

  // Zero-Download Local Fallbacks
  {
    id: 'espeak_en_us_f',
    name: 'Local eSpeak-NG US Female',
    description: 'Ultra-light local formant synthesis via system eSpeak-NG (0 MB download).',
    engine: 'espeak',
    locale: 'en-US',
    gender: 'female',
    espeakVoice: 'en-us+f3'
  },
  {
    id: 'espeak_en_us_m',
    name: 'Local eSpeak-NG US Male',
    description: 'Ultra-light local formant synthesis via system eSpeak-NG (0 MB download).',
    engine: 'espeak',
    locale: 'en-US',
    gender: 'male',
    espeakVoice: 'en-us+m3'
  },
  {
    id: 'procedural_vintage',
    name: 'Retro Formant Synthesizer',
    description: 'Built-in zero-dependency Klatt/formant telephone synthesizer (0 MB download).',
    engine: 'procedural',
    locale: 'en-US',
    gender: 'neutral'
  }
];

// Native ESM dynamic importer compatible with TypeScript module: "CommonJS"
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

function downloadHttpsFile(
  url: string,
  destPath: string,
  redirectsLeft = 5,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) {
      return reject(new Error('Only HTTPS downloads are permitted'));
    }

    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'DecaTone-Local-TTS/1.3' },
        timeout: 120000
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          if (redirectsLeft <= 0) {
            return reject(new Error('Too many redirects while downloading voice model'));
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadHttpsFile(nextUrl, destPath, redirectsLeft - 1, onProgress).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(String(res.headers['content-length'] || '0'), 10) || 0;
        let loadedBytes = 0;

        const tmpPath = `${destPath}.part`;
        const fileStream = fs.createWriteStream(tmpPath);

        res.on('data', (chunk: Buffer) => {
          loadedBytes += chunk.length;
          onProgress?.(loadedBytes, totalBytes);
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              fs.renameSync(tmpPath, destPath);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          try { fs.unlinkSync(tmpPath); } catch {}
          reject(err);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('HTTPS download timed out'));
    });

    req.on('error', (err) => {
      try { fs.unlinkSync(`${destPath}.part`); } catch {}
      reject(err);
    });
  });
}

function hasCachedKokoroModelOnDisk(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name.endsWith('.onnx')) {
          const st = fs.statSync(full);
          if (st.size > 10 * 1024 * 1024) {
            return true;
          }
        }
      }
    }
  } catch {}
  return false;
}

export class TtsAudioService {
  public static readonly SAMPLE_RATE = 16000;
  private static ttsCache = new Map<string, Buffer>();
  private static comfortLoopPcm: Buffer | null = null;
  private static cachedEspeakBin: string | null | undefined = undefined;

  // Lazy-loaded Kokoro singleton + auto-unload idle timer (reclaims ~400MB RAM when idle)
  private static kokoroInstance: any = null;
  private static kokoroLoadingPromise: Promise<any> | null = null;
  private static kokoroIdleUnloadTimer: NodeJS.Timeout | null = null;
  private static readonly KOKORO_IDLE_MS = 10 * 60 * 1000;

  private static downloadState: TtsDownloadState = {
    status: 'idle',
    engine: null,
    voiceId: null,
    progress: 0,
    file: '',
    loadedBytes: 0,
    totalBytes: 0,
    message: '',
    error: null
  };

  public static getDownloadState(): TtsDownloadState {
    return { ...this.downloadState };
  }

  public static resolvePiperBinary(): string | null {
    const bundledCandidates = [
      path.join(PIPER_DIR, 'piper', 'piper'),
      path.join(PIPER_DIR, 'piper')
    ];
    for (const candidate of bundledCandidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {}
    }

    const whichRes = spawnSync('which', ['piper'], { encoding: 'utf8', timeout: 2000 });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      return whichRes.stdout.trim();
    }
    return null;
  }

  public static resolveEspeakBinary(): string | null {
    if (this.cachedEspeakBin !== undefined) {
      return this.cachedEspeakBin;
    }
    for (const bin of ['espeak-ng', 'espeak']) {
      const res = spawnSync('which', [bin], { encoding: 'utf8', timeout: 2000 });
      if (res.status === 0 && res.stdout.trim()) {
        this.cachedEspeakBin = res.stdout.trim();
        return this.cachedEspeakBin;
      }
    }
    this.cachedEspeakBin = null;
    return null;
  }

  public static isPiperModelInstalled(voiceId: string): boolean {
    const onnxPath = path.join(TTS_VOICES_DIR, `${voiceId}.onnx`);
    const jsonPath = path.join(TTS_VOICES_DIR, `${voiceId}.onnx.json`);
    return fs.existsSync(onnxPath) && fs.existsSync(jsonPath);
  }

  public static isKokoroModelInstalled(): boolean {
    return Boolean(this.kokoroInstance) || hasCachedKokoroModelOnDisk(KOKORO_DIR);
  }

  public static async getPreferredConfig(): Promise<{ engine: TtsEngineType; voiceId: string }> {
    try {
      const rows = await query<{ key: string; value: string }>(
        "SELECT key, value FROM system_settings WHERE key IN ('tts_engine', 'tts_voice')"
      );
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;

      const voiceId =
        map['tts_voice'] && AVAILABLE_VOICES.some((v) => v.id === map['tts_voice'])
          ? map['tts_voice']
          : 'en_US-lessac-medium';

      const voiceMeta = AVAILABLE_VOICES.find((v) => v.id === voiceId) || AVAILABLE_VOICES[0];
      const rawEngine = (map['tts_engine'] || '').trim().toLowerCase();
      const engine: TtsEngineType = ['piper', 'kokoro', 'espeak', 'procedural'].includes(rawEngine)
        ? (rawEngine as TtsEngineType)
        : voiceMeta.engine;

      return { engine, voiceId };
    } catch {
      return { engine: 'piper', voiceId: 'en_US-lessac-medium' };
    }
  }

  public static async getPreferredVoiceId(): Promise<string> {
    const cfg = await this.getPreferredConfig();
    return cfg.voiceId;
  }

  public static async setPreferredConfig(opts: { engine?: string; voiceId?: string }): Promise<{ engine: TtsEngineType; voiceId: string }> {
    const current = await this.getPreferredConfig();
    let nextEngine: TtsEngineType = current.engine;
    let nextVoiceId: string = current.voiceId;

    if (opts.engine && ['piper', 'kokoro', 'espeak', 'procedural'].includes(String(opts.engine).trim().toLowerCase())) {
      nextEngine = String(opts.engine).trim().toLowerCase() as TtsEngineType;
    }

    if (opts.voiceId) {
      const found = AVAILABLE_VOICES.find((v) => v.id === String(opts.voiceId).trim());
      if (!found) {
        throw new Error(`Unsupported TTS voice ID: ${opts.voiceId}`);
      }
      nextVoiceId = found.id;
      if (!opts.engine) {
        nextEngine = found.engine;
      }
    }

    // Ensure selected voice matches selected engine if caller switched engine without passing a voiceId
    const chosenMeta = AVAILABLE_VOICES.find((v) => v.id === nextVoiceId);
    if (!chosenMeta || chosenMeta.engine !== nextEngine) {
      const firstMatch = AVAILABLE_VOICES.find((v) => v.engine === nextEngine);
      if (firstMatch) {
        nextVoiceId = firstMatch.id;
      }
    }

    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['tts_engine', nextEngine]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['tts_voice', nextVoiceId]);
    this.ttsCache.clear();
    return { engine: nextEngine, voiceId: nextVoiceId };
  }

  public static async setPreferredVoice(voiceId: string): Promise<void> {
    await this.setPreferredConfig({ voiceId });
  }

  public static async getTtsStatus() {
    ensureDirectories();
    const { engine: configuredEngine, voiceId: selectedVoice } = await this.getPreferredConfig();
    const piperBin = this.resolvePiperBinary();
    const espeakBin = this.resolveEspeakBinary();
    const kokoroInstalled = this.isKokoroModelInstalled();

    const selectedMeta = AVAILABLE_VOICES.find((v) => v.id === selectedVoice) || AVAILABLE_VOICES[0];
    let activeEngine: TtsEngineType = 'procedural';
    let activeVoiceInstalled = true;

    if (configuredEngine === 'kokoro') {
      if (kokoroInstalled && selectedMeta.engine === 'kokoro') {
        activeEngine = 'kokoro';
        activeVoiceInstalled = true;
      } else {
        activeVoiceInstalled = false;
        activeEngine = espeakBin ? 'espeak' : 'procedural';
      }
    } else if (configuredEngine === 'piper') {
      const modelReady = this.isPiperModelInstalled(selectedMeta.id);
      if (piperBin && modelReady && selectedMeta.engine === 'piper') {
        activeEngine = 'piper';
        activeVoiceInstalled = true;
      } else {
        activeVoiceInstalled = false;
        activeEngine = espeakBin ? 'espeak' : 'procedural';
      }
    } else if (configuredEngine === 'espeak') {
      activeVoiceInstalled = !!espeakBin;
      activeEngine = espeakBin ? 'espeak' : 'procedural';
    } else {
      activeEngine = 'procedural';
      activeVoiceInstalled = true;
    }

    const mappedVoices = AVAILABLE_VOICES.map((v) => {
      let installed = true;
      if (v.engine === 'piper') {
        installed = this.isPiperModelInstalled(v.id);
      } else if (v.engine === 'kokoro') {
        installed = kokoroInstalled;
      } else if (v.engine === 'espeak') {
        installed = !!espeakBin;
      }
      return {
        id: v.id,
        name: v.name,
        label: `${v.name} [${v.engine.toUpperCase()}${installed ? ' - Ready' : ' - Download Needed'}]`,
        description: v.description,
        engine: v.engine,
        locale: v.locale,
        gender: v.gender,
        installed,
        requiresPiperBinary: v.engine === 'piper' && !piperBin,
        active: v.id === selectedVoice
      };
    });

    return {
      configuredEngine,
      activeEngine,
      engine: activeEngine,
      selectedVoice,
      voice: selectedVoice,
      activeVoiceInstalled,
      piperInstalled: !!piperBin,
      kokoroInstalled,
      kokoroLoadedInRam: !!this.kokoroInstance,
      espeakInstalled: !!espeakBin,
      downloadState: this.getDownloadState(),
      voices: mappedVoices,
      availableVoices: mappedVoices
    };
  }

  public static async ensurePiperBinaryInstalled(onProgress?: (loaded: number, total: number) => void): Promise<string | null> {
    const existing = this.resolvePiperBinary();
    if (existing) return existing;

    if (os.platform() !== 'linux') {
      return null;
    }

    const arch = os.arch();
    let archiveName = '';
    if (arch === 'x64') archiveName = 'piper_linux_x86_64.tar.gz';
    else if (arch === 'arm64') archiveName = 'piper_linux_aarch64.tar.gz';
    else return null;

    ensureDirectories();
    const tarballUrl = `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/${archiveName}`;
    const tempTar = path.join(PIPER_DIR, archiveName);

    try {
      await downloadHttpsFile(tarballUrl, tempTar, 5, onProgress);
      await tar.x({
        file: tempTar,
        cwd: PIPER_DIR,
        strict: true,
        filter: (entryPath, entry) => {
          const normalized = entryPath.replace(/\\/g, '/');
          if (path.isAbsolute(normalized) || normalized.startsWith('/') || normalized.split('/').includes('..')) {
            return false;
          }
          const entryType = (entry as any)?.type;
          // Reject all symlinks and hardlinks during archive extraction
          if (entryType !== 'File' && entryType !== 'Directory') {
            return false;
          }
          return true;
        }
      });
      const piperBin = path.join(PIPER_DIR, 'piper', 'piper');
      if (fs.existsSync(piperBin)) {
        fs.chmodSync(piperBin, 0o755);
        return piperBin;
      }
    } catch (err) {
      console.warn('[TTS] Standalone Piper binary bootstrap failed:', err);
    } finally {
      try { if (fs.existsSync(tempTar)) fs.unlinkSync(tempTar); } catch {}
    }

    return this.resolvePiperBinary();
  }

  public static async downloadPiperVoiceModel(voiceId: string, bootstrapBinary = true): Promise<{ voiceId: string; piperReady: boolean }> {
    const entry = AVAILABLE_VOICES.find((v) => v.id === voiceId && v.engine === 'piper');
    if (!entry || !entry.hfSubpath) {
      throw new Error(`Voice '${voiceId}' is not a downloadable Piper neural model`);
    }

    ensureDirectories();
    this.downloadState = {
      status: 'downloading',
      engine: 'piper',
      voiceId,
      progress: 2,
      file: 'Initializing Piper setup...',
      loadedBytes: 0,
      totalBytes: 0,
      message: `Downloading Piper voice '${entry.name}'...`,
      error: null
    };

    try {
      if (bootstrapBinary && !this.resolvePiperBinary()) {
        this.downloadState.file = 'Piper runtime binary';
        await this.ensurePiperBinaryInstalled((loaded, total) => {
          const pct = total > 0 ? Math.min(40, Math.round((loaded / total) * 40)) : 20;
          this.downloadState.loadedBytes = loaded;
          this.downloadState.totalBytes = total;
          this.downloadState.progress = pct;
        });
      }

      const baseUrl = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${entry.hfSubpath}`;
      const onnxDest = path.join(TTS_VOICES_DIR, `${entry.id}.onnx`);
      const jsonDest = path.join(TTS_VOICES_DIR, `${entry.id}.onnx.json`);

      this.downloadState.file = `${entry.id}.onnx.json`;
      this.downloadState.progress = 42;
      await downloadHttpsFile(`${baseUrl}.onnx.json`, jsonDest);

      this.downloadState.file = `${entry.id}.onnx`;
      await downloadHttpsFile(`${baseUrl}.onnx`, onnxDest, 5, (loaded, total) => {
        const pct = total > 0 ? 45 + Math.round((loaded / total) * 55) : 70;
        this.downloadState.loadedBytes = loaded;
        this.downloadState.totalBytes = total;
        this.downloadState.progress = Math.min(99, pct);
      });

      const ready = !!this.resolvePiperBinary() && this.isPiperModelInstalled(entry.id);
      this.downloadState = {
        status: ready ? 'ready' : 'error',
        engine: 'piper',
        voiceId: entry.id,
        progress: ready ? 100 : 0,
        file: `${entry.id}.onnx`,
        loadedBytes: 0,
        totalBytes: 0,
        message: ready ? `Piper model '${entry.id}' is ready.` : 'Piper binary or model verification failed.',
        error: ready ? null : 'Piper binary missing for current architecture'
      };
      this.ttsCache.clear();
      return { voiceId: entry.id, piperReady: ready };
    } catch (err: any) {
      this.downloadState = {
        status: 'error',
        engine: 'piper',
        voiceId,
        progress: 0,
        file: '',
        loadedBytes: 0,
        totalBytes: 0,
        message: 'Download failed',
        error: err?.message || 'Failed to download Piper voice model'
      };
      throw err;
    }
  }

  private static scheduleKokoroUnload(): void {
    if (this.kokoroIdleUnloadTimer) clearTimeout(this.kokoroIdleUnloadTimer);
    this.kokoroIdleUnloadTimer = setTimeout(() => {
      if (this.kokoroInstance) {
        this.kokoroInstance = null;
        console.log('[TTS Kokoro] Unloaded idle model weights from RAM (retained in disk cache).');
      }
    }, this.KOKORO_IDLE_MS);
    if (typeof this.kokoroIdleUnloadTimer.unref === 'function') {
      this.kokoroIdleUnloadTimer.unref();
    }
  }

  public static async ensureKokoroLoaded(): Promise<any> {
    if (this.kokoroInstance) {
      this.scheduleKokoroUnload();
      return this.kokoroInstance;
    }
    if (this.kokoroLoadingPromise) {
      return this.kokoroLoadingPromise;
    }

    ensureDirectories();

    this.kokoroLoadingPromise = (async () => {
      const fileTracker = new Map<string, { loaded: number; total: number }>();
      try {
        this.downloadState = {
          status: 'downloading',
          engine: 'kokoro',
          voiceId: null,
          progress: 1,
          file: 'Initializing Kokoro ONNX runtime...',
          loadedBytes: 0,
          totalBytes: 0,
          message: 'Downloading / loading Kokoro-82M quantized ONNX weights (~86 MB)...',
          error: null
        };

        const tf = await dynamicImport('@huggingface/transformers');
        if (tf?.env) {
          tf.env.useFSCache = true;
          tf.env.cacheDir = KOKORO_DIR;
        }

        const kokoroMod = await dynamicImport('kokoro-js');
        const KokoroTTS = kokoroMod.KokoroTTS;

        const instance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'cpu',
          progress_callback: (info: any) => {
            if (!info) return;
            const fileName = String(info.file || '');
            if (fileName && typeof info.total === 'number' && info.total > 0) {
              fileTracker.set(fileName, {
                loaded: Number(info.loaded || 0),
                total: Number(info.total)
              });
            }
            let sumLoaded = 0;
            let sumTotal = 0;
            for (const f of fileTracker.values()) {
              sumLoaded += f.loaded;
              sumTotal += f.total;
            }
            const aggPct =
              sumTotal > 0
                ? Math.min(99, Math.max(1, Math.round((sumLoaded / sumTotal) * 100)))
                : typeof info.progress === 'number'
                ? Math.min(99, Math.round(info.progress))
                : this.downloadState.progress;

            this.downloadState = {
              status: 'downloading',
              engine: 'kokoro',
              voiceId: null,
              progress: aggPct,
              file: fileName || this.downloadState.file,
              loadedBytes: sumLoaded,
              totalBytes: sumTotal,
              message: fileName ? `Fetching ${path.basename(fileName)}...` : 'Downloading Kokoro neural model...',
              error: null
            };
          }
        });

        this.kokoroInstance = instance;
        this.scheduleKokoroUnload();
        this.downloadState = {
          status: 'ready',
          engine: 'kokoro',
          voiceId: null,
          progress: 100,
          file: 'Kokoro-82M-v1.0-ONNX (q8)',
          loadedBytes: 0,
          totalBytes: 0,
          message: 'Kokoro Neural TTS engine ready.',
          error: null
        };
        return instance;
      } catch (err: any) {
        this.downloadState = {
          status: 'error',
          engine: 'kokoro',
          voiceId: null,
          progress: 0,
          file: '',
          loadedBytes: 0,
          totalBytes: 0,
          message: 'Kokoro model download failed',
          error: err?.message || 'Failed to load Kokoro TTS model'
        };
        throw err;
      } finally {
        this.kokoroLoadingPromise = null;
      }
    })();

    return this.kokoroLoadingPromise;
  }

  /**
   * Starts an asynchronous on-demand engine/voice download (for live UI progress polling).
   */
  public static startEngineOrVoiceDownload(opts: { engine?: string; voiceId?: string }): { started: boolean; downloadState: TtsDownloadState } {
    if (this.downloadState.status === 'downloading') {
      return { started: false, downloadState: this.getDownloadState() };
    }

    const rawVoice = opts.voiceId ? String(opts.voiceId).trim() : '';
    const rawEngine = opts.engine ? String(opts.engine).trim().toLowerCase() : '';
    const voiceMeta = rawVoice ? AVAILABLE_VOICES.find((v) => v.id === rawVoice) : undefined;
    const targetEngine = (rawEngine || voiceMeta?.engine || 'piper') as TtsEngineType;

    if (targetEngine === 'kokoro') {
      this.ensureKokoroLoaded()
        .then(() => {
          this.ttsCache.clear();
        })
        .catch((err) => console.warn('[TTS Kokoro Download Error]:', err?.message || err));
      return { started: true, downloadState: this.getDownloadState() };
    }

    if (targetEngine === 'piper') {
      const targetVoiceId = voiceMeta?.engine === 'piper' ? voiceMeta.id : 'en_US-lessac-medium';
      this.downloadPiperVoiceModel(targetVoiceId, true)
        .catch((err) => console.warn('[TTS Piper Download Error]:', err?.message || err));
      return { started: true, downloadState: this.getDownloadState() };
    }

    this.downloadState = {
      status: 'ready',
      engine: targetEngine,
      voiceId: rawVoice || null,
      progress: 100,
      file: targetEngine,
      loadedBytes: 0,
      totalBytes: 0,
      message: `${targetEngine} requires no extra model download.`,
      error: null
    };
    return { started: false, downloadState: this.getDownloadState() };
  }

  // --- Tone Generators ---
  public static generateSineTone(frequencyHz: number, durationMs: number, amplitude = 0.6): Buffer {
    const totalSamples = Math.floor((this.SAMPLE_RATE * durationMs) / 1000);
    const buffer = Buffer.alloc(totalSamples * 2);
    const twoPiF = 2.0 * Math.PI * frequencyHz;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      let envelope = 1.0;
      const rampSamples = (this.SAMPLE_RATE * 10) / 1000;
      if (i < rampSamples) {
        envelope = 0.5 * (1 - Math.cos((Math.PI * i) / rampSamples));
      } else if (i > totalSamples - rampSamples) {
        envelope = 0.5 * (1 - Math.cos((Math.PI * (totalSamples - i)) / rampSamples));
      }

      const sampleVal = Math.sin(twoPiF * t) * 32767.0 * amplitude * envelope;
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sampleVal))), i * 2);
    }
    return buffer;
  }

  public static generateSpecialInformationTone(): Buffer {
    const pip1 = this.generateSineTone(950, 330, 0.55);
    const gap = Buffer.alloc(Math.floor(this.SAMPLE_RATE * 0.03) * 2);
    const pip2 = this.generateSineTone(1400, 330, 0.55);
    const pip3 = this.generateSineTone(1800, 330, 0.55);
    const postGap = Buffer.alloc(Math.floor(this.SAMPLE_RATE * 0.25) * 2);
    return Buffer.concat([pip1, gap, pip2, gap, pip3, postGap]);
  }

  public static generateStutterDialTone(durationSec = 2.0): Buffer {
    const totalSamples = Math.floor(this.SAMPLE_RATE * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      let isBeep = true;
      if (t < 2.0) {
        const pulseCycle = Math.floor(t / 0.1);
        isBeep = pulseCycle % 2 === 0;
      }
      let sample = 0;
      if (isBeep) {
        sample = (Math.sin(2.0 * Math.PI * 350.0 * t) + Math.sin(2.0 * Math.PI * 440.0 * t)) * 0.25 * 32767.0;
      }
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }
    return buffer;
  }

  public static generateDndDialTone(durationSec = 2.0): Buffer {
    const totalSamples = Math.floor(this.SAMPLE_RATE * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      const mod = 0.5 * (1.0 + Math.sin(2.0 * Math.PI * 8.0 * t));
      const sample = (Math.sin(2.0 * Math.PI * 440.0 * t) + Math.sin(2.0 * Math.PI * 480.0 * t)) * 0.25 * mod * 32767.0;
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }
    return buffer;
  }

  public static generateHowlerTone(durationSec = 5.0): Buffer {
    const totalSamples = Math.floor(this.SAMPLE_RATE * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      const isBeep = Math.floor(t / 0.1) % 2 === 0;

      let sample = 0;
      if (isBeep) {
        const tone1 = Math.sin(2.0 * Math.PI * 1400.0 * t);
        const tone2 = Math.sin(2.0 * Math.PI * 2060.0 * t);
        const tone3 = Math.sin(2.0 * Math.PI * 2450.0 * t);
        const tone4 = Math.sin(2.0 * Math.PI * 2600.0 * t);
        sample = (tone1 + tone2 + tone3 + tone4) * 0.24 * 32767.0;
      }
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }
    return buffer;
  }

  public static generateChirpTone(): Buffer {
    const durationMs = 80;
    const totalSamples = Math.floor((this.SAMPLE_RATE * durationMs) / 1000);
    const buffer = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      const progress = i / totalSamples;
      const freq = 1200.0 + (1800.0 - 1200.0) * progress;
      const env = Math.sin(Math.PI * progress);
      const sample = Math.sin(2.0 * Math.PI * freq * t) * env * 0.35 * 32767.0;
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }
    return buffer;
  }

  public static getComfortLoopPcm(): Buffer {
    if (!this.comfortLoopPcm) {
      const cycleSamples = Math.floor(this.SAMPLE_RATE * 4.0);
      const buf = Buffer.alloc(cycleSamples * 2);
      for (let i = 0; i < cycleSamples; i++) {
        const cycleTime = i / this.SAMPLE_RATE;
        let sample = 0;
        if (cycleTime >= 0 && cycleTime < 0.35) {
          const progress = cycleTime / 0.35;
          const env = Math.exp(-4.0 * progress);
          sample = Math.sin(2.0 * Math.PI * 523.25 * cycleTime) * env * 0.18 * 32767.0;
        } else if (cycleTime >= 0.45 && cycleTime < 0.8) {
          const progress = (cycleTime - 0.45) / 0.35;
          const env = Math.exp(-4.0 * progress);
          sample = Math.sin(2.0 * Math.PI * 659.25 * (cycleTime - 0.45)) * env * 0.18 * 32767.0;
        }
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
      }
      this.comfortLoopPcm = buf;
    }
    return this.comfortLoopPcm;
  }

  public static generateComfortTone(durationSec = 60.0): Buffer {
    const loop = this.getComfortLoopPcm();
    const targetBytes = Math.floor(this.SAMPLE_RATE * durationSec) * 2;
    const out = Buffer.allocUnsafe(targetBytes);
    let offset = 0;
    while (offset < targetBytes) {
      const toCopy = Math.min(loop.length, targetBytes - offset);
      loop.copy(out, offset, 0, toCopy);
      offset += toCopy;
    }
    return out;
  }

  public static generateModemHandshakeTone(durationSec = 8.5): Buffer {
    const totalSamples = Math.floor(this.SAMPLE_RATE * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    let noiseSeed = 0x54321;
    const nextNoise = () => {
      noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
      return (noiseSeed / 0x7fffffff) * 2.0 - 1.0;
    };

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      let sample = 0;

      if (t < 0.4) {
        sample = nextNoise() * 0.04 * 32767.0;
      } else if (t < 3.2) {
        const phaseReversal = Math.floor((t - 0.4) / 0.45) % 2 === 1 ? Math.PI : 0;
        const tone2100 = Math.sin(2.0 * Math.PI * 2100.0 * t + phaseReversal);
        const hiss = nextNoise() * 0.03;
        sample = (tone2100 * 0.35 + hiss) * 32767.0;
      } else if (t < 4.6) {
        const tone1 = Math.sin(2.0 * Math.PI * 980.0 * t);
        const tone2 = Math.sin(2.0 * Math.PI * 1180.0 * t);
        const tone3 = Math.sin(2.0 * Math.PI * 1850.0 * t) * 0.5;
        const hiss = nextNoise() * 0.06;
        sample = ((tone1 + tone2 + tone3) * 0.18 + hiss) * 32767.0;
      } else if (t < 6.8) {
        const carrier1200 = Math.sin(2.0 * Math.PI * 1200.0 * t) * 0.2;
        const carrier2400 = Math.sin(2.0 * Math.PI * 2400.0 * t) * 0.15;
        const scramblerNoise = nextNoise() * 0.32;
        sample = (carrier1200 + carrier2400 + scramblerNoise) * 32767.0;
      } else {
        const dataFreq = 1200 + (Math.floor(t * 120) % 2 === 0 ? 150 : -150);
        const fskTone = Math.sin(2.0 * Math.PI * dataFreq * t) * 0.22;
        const hiss = nextNoise() * 0.08;
        sample = (fskTone + hiss) * 32767.0;
      }

      let envelope = 1.0;
      if (t < 0.1) envelope = t / 0.1;
      else if (t > durationSec - 0.2) envelope = (durationSec - t) / 0.2;

      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * envelope))), i * 2);
    }
    return buffer;
  }

  /**
   * Synthesizes spoken audio locally as 16kHz 16-bit Mono Linear PCM:
   * Supports Kokoro Neural ONNX (if selected & cached), Piper Neural ONNX, eSpeak-NG, and Procedural Klatt fallback.
   */
  public static async synthesizeSpeech(
    text: string,
    overrideVoiceId?: string,
    options?: { cache?: boolean; overrideEngine?: TtsEngineType }
  ): Promise<Buffer> {
    const cleanText = text.trim();
    if (!cleanText) return Buffer.alloc(0);

    const cfg = await this.getPreferredConfig();
    const targetVoiceId = overrideVoiceId || cfg.voiceId;
    const voiceEntry = AVAILABLE_VOICES.find((v) => v.id === targetVoiceId) || AVAILABLE_VOICES[0];
    const targetEngine: TtsEngineType = options?.overrideEngine || (overrideVoiceId ? voiceEntry.engine : cfg.engine);

    const useCache = options?.cache !== false;
    const cacheKey = `${targetEngine}:${targetVoiceId}::${cleanText}`;
    if (useCache && this.ttsCache.has(cacheKey)) {
      return Buffer.from(this.ttsCache.get(cacheKey)!);
    }

    let pcm: Buffer | null = null;

    // 1. Kokoro Neural ONNX Engine (if selected & cached on disk / memory)
    if (targetEngine === 'kokoro' && voiceEntry.engine === 'kokoro') {
      if (this.isKokoroModelInstalled()) {
        try {
          pcm = await this.synthesizeWithKokoro(voiceEntry.kokoroVoiceId || 'af_heart', cleanText);
        } catch (err) {
          console.warn('[TTS] Local Kokoro synthesis failed, falling back:', err);
        }
      }
    }

    // 2. Piper Neural ONNX Engine (if selected & installed)
    if ((!pcm || pcm.length === 0) && targetEngine === 'piper' && voiceEntry.engine === 'piper') {
      const piperBin = this.resolvePiperBinary();
      if (piperBin && this.isPiperModelInstalled(voiceEntry.id)) {
        try {
          pcm = await this.synthesizeWithPiper(piperBin, voiceEntry.id, cleanText);
        } catch (err) {
          console.warn('[TTS] Local Piper synthesis failed, falling back:', err);
        }
      }
    }

    // 3. eSpeak-NG Local Formant Fallback (unless explicitly requesting procedural)
    if ((!pcm || pcm.length === 0) && targetEngine !== 'procedural') {
      const espeakBin = this.resolveEspeakBinary();
      if (espeakBin) {
        const mappedEspeakVoice =
          voiceEntry.espeakVoice ||
          (voiceEntry.locale === 'en-GB'
            ? voiceEntry.gender === 'male'
              ? 'en-gb+m3'
              : 'en-gb+f3'
            : voiceEntry.gender === 'male'
            ? 'en-us+m3'
            : 'en-us+f3');
        try {
          pcm = await this.synthesizeWithEspeak(espeakBin, mappedEspeakVoice, cleanText);
        } catch (err) {
          console.warn('[TTS] Local eSpeak synthesis failed, using procedural fallback:', err);
        }
      }
    }

    // 4. Zero-dependency multi-phoneme Klatt/formant fallback
    if (!pcm || pcm.length === 0) {
      pcm = this.synthesizeProceduralSpeech(cleanText);
    }

    if (useCache && pcm.length > 0) {
      if (this.ttsCache.size > 150) {
        const oldestKey = this.ttsCache.keys().next().value;
        if (oldestKey) this.ttsCache.delete(oldestKey);
      }
      this.ttsCache.set(cacheKey, pcm);
    }

    return Buffer.from(pcm);
  }

  public static async synthesizeWav(
    text: string,
    voiceId?: string,
    options?: { cache?: boolean; overrideEngine?: TtsEngineType }
  ): Promise<Buffer> {
    const pcm = await this.synthesizeSpeech(text, voiceId, options);
    return VoicemailCryptoService.createWavBuffer(pcm, this.SAMPLE_RATE, 1, 16);
  }

  private static async synthesizeWithKokoro(kokoroVoiceId: string, text: string): Promise<Buffer> {
    const tts = await this.ensureKokoroLoaded();
    const rawAudio = await tts.generate(text, { voice: kokoroVoiceId, speed: 1.0 });
    const floats: Float32Array = rawAudio.audio;
    const rate: number = rawAudio.sampling_rate || 24000;
    return VoicemailCryptoService.resampleFloatMonoTo16kS16le(floats, rate, this.SAMPLE_RATE);
  }

  private static synthesizeWithPiper(piperBin: string, voiceId: string, text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const onnxPath = path.join(TTS_VOICES_DIR, `${voiceId}.onnx`);
      const jsonPath = path.join(TTS_VOICES_DIR, `${voiceId}.onnx.json`);

      let modelSampleRate = 22050;
      try {
        const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (cfg?.audio?.sample_rate) {
          modelSampleRate = Number(cfg.audio.sample_rate) || 22050;
        }
      } catch {}

      const piperDir = path.dirname(piperBin);
      const env = {
        ...process.env,
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ? `${piperDir}:${process.env.LD_LIBRARY_PATH}` : piperDir
      };

      const proc = spawn(piperBin, ['--model', onnxPath, '--output-raw'], { env });
      const chunks: Buffer[] = [];

      const killTimer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Piper synthesis timed out'));
      }, 15000);

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', () => {});
      proc.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(killTimer);
        if (code !== 0) {
          return reject(new Error(`Piper exited with code ${code}`));
        }
        const rawS16 = Buffer.concat(chunks);
        const resampled = VoicemailCryptoService.resampleS16leMono(rawS16, modelSampleRate, this.SAMPLE_RATE);
        resolve(resampled);
      });

      proc.stdin.write(text + '\n');
      proc.stdin.end();
    });
  }

  private static synthesizeWithEspeak(espeakBin: string, voiceCode: string, text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn(espeakBin, ['--stdout', '-v', voiceCode, '-s', '155', text]);
      const chunks: Buffer[] = [];

      const killTimer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('eSpeak synthesis timed out'));
      }, 8000);

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', () => {});
      proc.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(killTimer);
        if (code !== 0) {
          return reject(new Error(`eSpeak exited with code ${code}`));
        }
        try {
          const wavBuf = Buffer.concat(chunks);
          const pcm16k = VoicemailCryptoService.decodeWavTo16kMonoPcm(wavBuf);
          resolve(pcm16k);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  public static synthesizeProceduralSpeech(text: string): Buffer {
    const digitWords: Record<string, string> = {
      '0': 'zero',
      '1': 'one',
      '2': 'two',
      '3': 'three',
      '4': 'four',
      '5': 'five',
      '6': 'six',
      '7': 'seven',
      '8': 'eight',
      '9': 'nine'
    };

    const expanded = text
      .replace(/\d/g, (d) => ` ${digitWords[d] || d} `)
      .toLowerCase()
      .replace(/[^a-z\s:,\.\-!]/g, ' ');

    const tokens = expanded.split(/\s+/).filter(Boolean);
    const pcmChunks: Buffer[] = [Buffer.alloc(Math.floor(this.SAMPLE_RATE * 0.12) * 2)];

    for (let w = 0; w < tokens.length; w++) {
      const token = tokens[w];
      const cleanWord = token.replace(/[^a-z]/g, '');
      if (cleanWord.length > 0) {
        pcmChunks.push(this.synthesizePhoneticWord(cleanWord, w === tokens.length - 1));
      }

      const endsSentence = token.endsWith('.') || token.endsWith('!') || token.endsWith(':');
      const endsClause = token.endsWith(',') || token.endsWith('-');
      const pauseSec = endsSentence ? 0.28 : endsClause ? 0.16 : 0.065;
      pcmChunks.push(Buffer.alloc(Math.floor(this.SAMPLE_RATE * pauseSec) * 2));
    }

    return Buffer.concat(pcmChunks);
  }

  private static synthesizePhoneticWord(word: string, isPhraseFinal: boolean): Buffer {
    const formants: Record<string, [number, number, number, boolean]> = {
      a: [730, 1090, 2440, false],
      e: [530, 1840, 2480, false],
      i: [270, 2290, 3010, false],
      o: [570, 840, 2410, false],
      u: [300, 870, 2240, false],
      y: [320, 2150, 2900, false],
      r: [490, 1350, 1690, false],
      l: [450, 1100, 2600, false],
      m: [280, 900, 2200, false],
      n: [280, 1450, 2500, false],
      s: [400, 1800, 3400, true],
      z: [360, 1750, 3200, true],
      f: [450, 1400, 2800, true],
      h: [500, 1500, 2500, true],
      t: [420, 1700, 2900, true],
      k: [400, 1550, 2600, true],
      p: [400, 1100, 2300, true],
      default: [500, 1500, 2500, false]
    };

    const chars = word.split('');
    const segDurMs = Math.max(45, Math.min(90, Math.round(280 / Math.max(2, chars.length))));
    const totalMs = Math.max(140, Math.min(680, chars.length * segDurMs));
    const totalSamples = Math.floor((this.SAMPLE_RATE * totalMs) / 1000);
    const buffer = Buffer.alloc(totalSamples * 2);

    const basePitch = isPhraseFinal ? 158.0 : 172.0;
    let phase0 = 0;
    let noiseSeed = 0x13579bdf;
    const nextNoise = () => {
      noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
      return (noiseSeed / 0xffffffff) * 2.0 - 1.0;
    };

    for (let i = 0; i < totalSamples; i++) {
      const progress = i / totalSamples;
      const posFloat = progress * (chars.length - 1);
      const idx0 = Math.floor(posFloat);
      const idx1 = Math.min(chars.length - 1, idx0 + 1);
      const frac = posFloat - idx0;

      const p0 = formants[chars[idx0]] || formants.default;
      const p1 = formants[chars[idx1]] || formants.default;

      const f1 = p0[0] * (1 - frac) + p1[0] * frac;
      const f2 = p0[1] * (1 - frac) + p1[1] * frac;
      const f3 = p0[2] * (1 - frac) + p1[2] * frac;
      const fricativeMix = (p0[3] ? 1 - frac : 0) + (p1[3] ? frac : 0);

      const pitchSlope = isPhraseFinal ? 1.0 - 0.14 * progress : 1.0 + 0.05 * Math.sin(Math.PI * progress);
      const f0 = basePitch * pitchSlope;
      phase0 = (phase0 + f0 / this.SAMPLE_RATE) % 1.0;

      const decay = Math.exp(-phase0 * 6.8);
      const voiced =
        (Math.sin(2.0 * Math.PI * f1 * (phase0 / f0)) * 0.56 +
          Math.sin(2.0 * Math.PI * f2 * (phase0 / f0)) * 0.32 +
          Math.sin(2.0 * Math.PI * f3 * (phase0 / f0)) * 0.14) *
        decay;

      const unvoiced = nextNoise() * Math.sin(2.0 * Math.PI * f3 * (i / this.SAMPLE_RATE)) * 0.28;
      const combined = voiced * (1 - 0.65 * fricativeMix) + unvoiced * fricativeMix;

      let env = 1.0;
      if (progress < 0.12) env = progress / 0.12;
      else if (progress > 0.82) env = (1.0 - progress) / 0.18;

      const sample = combined * env * 0.42 * 32767.0;
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }

    return buffer;
  }
}
