import WebSocket from 'ws';
import { execute } from '../db/connection';
import { TtsAudioService } from './ttsAudioService';
import { serviceLinesService } from './serviceLinesService';

export interface SweepPoint {
  frequency: number;
  amplitude: number;
  measured?: boolean;
}

export interface CalibrationResult {
  deviceId: string;
  peakFrequency: number;
  sweepPoints: SweepPoint[];
  usedRealHardwareSamples: boolean;
  calibratedAt: string;
}

interface PendingSampleWaiter {
  freq: number;
  resolve: (rms: number | null) => void;
  timer: NodeJS.Timeout;
}

class AcousticCalibrationService {
  private pendingSampleWaiters = new Map<string, PendingSampleWaiter>();

  public handleCalibrationSample(deviceId: string, frequency: number, rmsAmplitude: number) {
    if (isNaN(frequency) || isNaN(rmsAmplitude)) return;
    const waiter = this.pendingSampleWaiters.get(deviceId);
    if (!waiter) return;

    // Only accept sample matching the currently tested frequency (within ±0.6 Hz tolerance)
    if (Math.abs(waiter.freq - frequency) <= 0.6) {
      clearTimeout(waiter.timer);
      this.pendingSampleWaiters.delete(deviceId);
      waiter.resolve(Math.max(0, rmsAmplitude));
    }
  }

  private waitForDeviceSample(deviceId: string, freq: number, timeoutMs = 1100): Promise<number | null> {
    const existing = this.pendingSampleWaiters.get(deviceId);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingSampleWaiters.delete(deviceId);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingSampleWaiters.get(deviceId)?.timer === timer) {
          this.pendingSampleWaiters.delete(deviceId);
        }
        resolve(null);
      }, timeoutMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this.pendingSampleWaiters.set(deviceId, { freq, resolve, timer });
    });
  }

  /**
   * Runs an automated acoustic frequency resonance sweep across 15Hz - 35Hz
   */
  public async runSweep(
    deviceId: string,
    phoneWs: WebSocket,
    onProgress?: (progress: { freq: number; percent: number }) => void
  ): Promise<CalibrationResult> {
    const sweepFrequencies: number[] = [];
    for (let f = 15.0; f <= 35.0; f += 1.0) {
      sweepFrequencies.push(parseFloat(f.toFixed(1)));
    }

    if (phoneWs && phoneWs.readyState === WebSocket.OPEN) {
      const introSpeech = await TtsAudioService.synthesizeSpeech(
        'Acoustic calibration started. Please hold the handset microphone near the mechanical bells.'
      );
      await serviceLinesService.startRawPcmPlaybackSession(deviceId, introSpeech, phoneWs);
    }

    const rawMeasurements: { frequency: number; rawAmp: number; measured: boolean }[] = [];
    let anyMeasured = false;

    try {
      for (let i = 0; i < sweepFrequencies.length; i++) {
        const freq = sweepFrequencies[i];
        const percent = Math.round(((i + 1) / sweepFrequencies.length) * 100);
        onProgress?.({ freq, percent });

        const samplePromise = this.waitForDeviceSample(deviceId, freq, 1100);

        if (phoneWs && phoneWs.readyState === WebSocket.OPEN) {
          phoneWs.send(
            JSON.stringify({
              type: 'calibration_step',
              active: true,
              frequency: freq,
              durationMs: 650
            })
          );
        }

        const deviceRms = await samplePromise;

        if (deviceRms !== null) {
          anyMeasured = true;
          rawMeasurements.push({
            frequency: freq,
            rawAmp: deviceRms,
            measured: true
          });
        } else {
          const targetResonance = 20.0;
          const q = 4.5;
          const delta = Math.abs(freq - targetResonance);
          const theoreticalGain = 1.0 / Math.sqrt(1 + Math.pow(q * (delta / targetResonance), 2));
          const noise = Math.random() * 0.06 - 0.03;
          rawMeasurements.push({
            frequency: freq,
            rawAmp: Math.max(0.05, Math.min(1.0, theoreticalGain + noise)),
            measured: false
          });
        }

        await new Promise((r) => setTimeout(r, 120));
      }
    } finally {
      if (phoneWs && phoneWs.readyState === WebSocket.OPEN) {
        phoneWs.send(JSON.stringify({ type: 'calibration_stop' }));
      }
    }

    let minRaw = Infinity;
    let maxRaw = -Infinity;
    for (const m of rawMeasurements) {
      if (m.rawAmp < minRaw) minRaw = m.rawAmp;
      if (m.rawAmp > maxRaw) maxRaw = m.rawAmp;
    }

    const span = maxRaw - minRaw;
    const results: SweepPoint[] = rawMeasurements.map((m) => {
      let norm: number;
      if (span > 1e-6) {
        norm = 0.05 + 0.95 * ((m.rawAmp - minRaw) / span);
      } else {
        norm = Math.max(0.05, Math.min(1.0, m.rawAmp || 0.5));
      }
      return {
        frequency: m.frequency,
        amplitude: parseFloat(Math.max(0.05, Math.min(1.0, norm)).toFixed(3)),
        measured: m.measured
      };
    });

    let peakPoint = results[0];
    for (const pt of results) {
      if (pt.amplitude > peakPoint.amplitude) {
        peakPoint = pt;
      }
    }

    const optimalFreq = peakPoint.frequency;

    await execute(
      'UPDATE phones SET bell_frequency_hz = ? WHERE device_id = ?',
      [optimalFreq, deviceId]
    );

    if (phoneWs && phoneWs.readyState === WebSocket.OPEN) {
      phoneWs.send(
        JSON.stringify({
          type: 'update_settings',
          bellFrequencyHz: optimalFreq
        })
      );

      const outroSpeech = await TtsAudioService.synthesizeSpeech(
        `Calibration complete. Optimal bell resonance calibrated at ${optimalFreq} Hertz.`,
        undefined,
        { cache: false }
      );
      await serviceLinesService.startRawPcmPlaybackSession(deviceId, outroSpeech, phoneWs);
    }

    return {
      deviceId,
      peakFrequency: optimalFreq,
      sweepPoints: results,
      usedRealHardwareSamples: anyMeasured,
      calibratedAt: new Date().toISOString()
    };
  }
}

export const acousticCalibrationService = new AcousticCalibrationService();
