import http from 'http';
import https from 'https';

/**
 * DecaTone High-Quality Speech & Tone Synthesis Service
 * Synthesizes 16kHz 16-bit Mono Linear PCM audio frames for dynamic telephone service lines.
 */
export class TtsAudioService {
  public static readonly SAMPLE_RATE = 16000;

  /**
   * Generates a pure sine tone buffer at 16kHz
   */
  public static generateSineTone(frequencyHz: number, durationMs: number, amplitude = 0.6): Buffer {
    const totalSamples = Math.floor((this.SAMPLE_RATE * durationMs) / 1000);
    const buffer = Buffer.alloc(totalSamples * 2);
    const twoPiF = 2.0 * Math.PI * frequencyHz;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      // Apply smooth 10ms cosine ramp up/down to prevent clicks
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

  /**
   * Generates Stutter Dial Tone (Unread Voicemail Notification):
   * Rapid pulses (0.1s on, 0.1s off) for 2 seconds, followed by standard steady dial tone (350Hz + 440Hz).
   */
  public static generateStutterDialTone(durationSec = 2.0): Buffer {
    const totalSamples = Math.floor(this.SAMPLE_RATE * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      let isBeep = true;
      if (t < 2.0) {
        // Stutter burst: 100ms on, 100ms off
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

  /**
   * Generates Do Not Disturb (DND) Dial Tone:
   * 440Hz + 480Hz modulated with an 8Hz warble envelope indicating active quiet hours.
   */
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

  /**
   * Generates Receiver-Off-Hook (ROH) "Howler" Alert Tone:
   * Authentic multi-frequency chord siren (1400Hz + 2060Hz + 2450Hz + 2600Hz)
   * pulsing at 5Hz (100ms on, 100ms off) at maximum output level.
   */
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

  /**
   * Generates In-Ear Audio Confirmation Chirp (Microphone Mute / Feature Acknowledge):
   * 1200Hz -> 1800Hz upward frequency sweep over 80ms
   */
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

  /**
   * Generates Vintage Call-Park / On-Hold Comfort Chime:
   * Repeating gentle 2-tone melodic chime (523Hz C5 and 659Hz E5) every 4 seconds.
   */
  public static generateComfortTone(durationSec = 60.0): Buffer {
    const totalSamples = Math.floor(this.SAMPLE_RATE * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      const cycleTime = t % 4.0; // Repeat every 4 seconds
      let sample = 0;

      if (cycleTime >= 0 && cycleTime < 0.35) {
        // Tone 1: 523Hz (C5)
        const progress = cycleTime / 0.35;
        const env = Math.exp(-4.0 * progress);
        sample = Math.sin(2.0 * Math.PI * 523.25 * cycleTime) * env * 0.18 * 32767.0;
      } else if (cycleTime >= 0.45 && cycleTime < 0.8) {
        // Tone 2: 659Hz (E5)
        const progress = (cycleTime - 0.45) / 0.35;
        const env = Math.exp(-4.0 * progress);
        sample = Math.sin(2.0 * Math.PI * 659.25 * (cycleTime - 0.45)) * env * 0.18 * 32767.0;
      }

      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }
    return buffer;
  }

  /**
   * Generates Authentic Dial-Up Modem Handshake & Data Squeal Audio:
   * 1. 2100Hz V.8 / V.25 Answer Tone with periodic 180-deg phase reversals
   * 2. V.8 dual-tone probing (980Hz + 1180Hz / 1650Hz + 1850Hz)
   * 3. V.22bis scrambler rushing white noise & carrier lock whistle (1200Hz / 2400Hz)
   * 4. 300/1200 baud FSK/QAM modulation squeals and carrier lock
   */
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
        // Line click & quiet carrier pause
        sample = (nextNoise() * 0.04) * 32767.0;
      } else if (t < 3.2) {
        // Phase 1: 2100Hz ITU-T V.25 Answer Tone with 180-deg phase reversals every 450ms
        const phaseReversal = Math.floor((t - 0.4) / 0.45) % 2 === 1 ? Math.PI : 0;
        const tone2100 = Math.sin(2.0 * Math.PI * 2100.0 * t + phaseReversal);
        // Subtle harmonics and line hiss
        const hiss = nextNoise() * 0.03;
        sample = (tone2100 * 0.35 + hiss) * 32767.0;
      } else if (t < 4.6) {
        // Phase 2: V.8 CM / JM probing dual-tones (980Hz + 1180Hz / 1650Hz + 1850Hz)
        const tone1 = Math.sin(2.0 * Math.PI * 980.0 * t);
        const tone2 = Math.sin(2.0 * Math.PI * 1180.0 * t);
        const tone3 = Math.sin(2.0 * Math.PI * 1850.0 * t) * 0.5;
        const hiss = nextNoise() * 0.06;
        sample = ((tone1 + tone2 + tone3) * 0.18 + hiss) * 32767.0;
      } else if (t < 6.8) {
        // Phase 3: V.22bis / V.34 Scrambler rushing white noise & carrier screech
        const carrier1200 = Math.sin(2.0 * Math.PI * 1200.0 * t) * 0.2;
        const carrier2400 = Math.sin(2.0 * Math.PI * 2400.0 * t) * 0.15;
        // Scrambler wideband rushing noise (simulates pseudo-random sequence)
        const scramblerNoise = nextNoise() * 0.32;
        sample = (carrier1200 + carrier2400 + scramblerNoise) * 32767.0;
      } else {
        // Phase 4: Carrier Lock & FSK Data Transmission Bursts
        const dataFreq = 1200 + (Math.floor(t * 120) % 2 === 0 ? 150 : -150);
        const fskTone = Math.sin(2.0 * Math.PI * dataFreq * t) * 0.22;
        const hiss = nextNoise() * 0.08;
        sample = (fskTone + hiss) * 32767.0;
      }

      // Smooth fade-in and fade-out envelope
      let envelope = 1.0;
      if (t < 0.1) envelope = t / 0.1;
      else if (t > durationSec - 0.2) envelope = (durationSec - t) / 0.2;

      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * envelope))), i * 2);
    }
    return buffer;
  }


  /**
   * Formant-based phonetic voice synthesizer for clean, natural telephone voice audio
   * Generates authentic telephone operator / announcer phonemes at 16kHz PCM
   */
  public static synthesizeSpeech(text: string): Buffer {
    // Clean text and split into words
    const words = text.toLowerCase().replace(/[^a-z0-9\s:,\.\-]/g, '').split(/\s+/).filter(Boolean);
    const pcmChunks: Buffer[] = [];

    // Pre-speech silence
    pcmChunks.push(Buffer.alloc(this.SAMPLE_RATE * 0.15 * 2)); // 150ms silence

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const wordAudio = this.synthesizeWord(word);
      pcmChunks.push(wordAudio);

      // Inter-word pause
      const pauseDuration = word.endsWith('.') || word.endsWith(':') ? 0.35 : (word.endsWith(',') ? 0.2 : 0.08);
      pcmChunks.push(Buffer.alloc(Math.floor(this.SAMPLE_RATE * pauseDuration * 2)));
    }

    return Buffer.concat(pcmChunks);
  }

  private static synthesizeWord(word: string): Buffer {
    // Phonetic formant frequencies for English vowel sounds (F1, F2, F3 in Hz)
    const formants: Record<string, [number, number, number]> = {
      'a': [700, 1220, 2600],
      'e': [530, 1840, 2480],
      'i': [390, 2300, 3000],
      'o': [570, 840, 2410],
      'u': [440, 1020, 2240],
      'neutral': [500, 1500, 2500]
    };

    // Duration estimation based on word length
    const cleanWord = word.replace(/[^a-z0-9]/g, '');
    const durationMs = Math.max(160, Math.min(600, cleanWord.length * 65 + 80));
    const totalSamples = Math.floor((this.SAMPLE_RATE * durationMs) / 1000);
    const buffer = Buffer.alloc(totalSamples * 2);

    // Base pitch modulation (120Hz to 135Hz for warm natural human vocal cord pulse)
    const basePitch = 125.0;
    let primaryVowel = 'neutral';
    for (const char of cleanWord) {
      if (formants[char]) {
        primaryVowel = char;
        break;
      }
    }
    const [f1, f2, f3] = formants[primaryVowel] || formants['neutral'];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / this.SAMPLE_RATE;
      const progress = i / totalSamples;

      // Natural pitch intonation curve (warm vocal pitch)
      const pitchIntonation = basePitch * (1.0 + 0.06 * Math.sin(Math.PI * progress));
      const f0Period = this.SAMPLE_RATE / pitchIntonation;
      const pulsePhase = (i % Math.floor(f0Period)) / f0Period;

      // Formant resonators excited by glottal closure
      const formantDecay = Math.exp(-pulsePhase * 7.5);
      const res1 = Math.sin(2.0 * Math.PI * f1 * (pulsePhase / pitchIntonation)) * 0.55;
      const res2 = Math.sin(2.0 * Math.PI * f2 * (pulsePhase / pitchIntonation)) * 0.35;
      const res3 = Math.sin(2.0 * Math.PI * f3 * (pulsePhase / pitchIntonation)) * 0.18;

      // Envelope shaping
      let env = 1.0;
      if (progress < 0.18) env = progress / 0.18;
      else if (progress > 0.78) env = (1.0 - progress) / 0.22;

      const sample = (res1 + res2 + res3) * formantDecay * env * 0.42 * 32767.0;
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
    }

    return buffer;
  }
}
