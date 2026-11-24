/**
 * DecaTone Playback & Multi-Party Mixer AudioWorkletProcessor
 * Resamples 16 kHz PCM streams cleanly to the browser AudioContext sampleRate
 * inside the audio rendering thread:
 * - Up to 8 concurrent conference call slots (0..7) with adaptive jitter trim
 * - Continuous chunked Zero-Access Voicemail playback queue with drain completion signaling
 */
class DecaTonePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = 16000.0 / sampleRate;

    // 8 independent 16 kHz jitter ring buffers for conference / call slots
    this.slotCapacity = 16000;
    this.slots = new Array(8);
    for (let i = 0; i < 8; i++) {
      this.slots[i] = {
        buf: new Float32Array(this.slotCapacity),
        head: 0,
        tail: 0,
        count: 0,
        phase: 0.0,
        curr: 0.0,
        next: 0.0,
        primed: false
      };
    }

    // Continuous sequential queue for decrypted voicemail chunks
    this.vmChunks = [];
    this.vmReadIndex = 0;
    this.vmPhase = 0.0;
    this.vmCurr = 0.0;
    this.vmNext = 0.0;
    this.vmPrimed = false;
    this.vmActiveId = null;
    this.vmAllChunksReceived = false;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'reset') {
        this.resetAll();
      } else if (msg.type === 'pcm') {
        const slotIdx = (msg.slot | 0) & 0x07;
        if (msg.samples && msg.samples.length > 0) {
          this.pushSlotSamples(slotIdx, msg.samples);
        }
      } else if (msg.type === 'vm_chunk') {
        if (msg.vmId !== undefined && msg.vmId !== this.vmActiveId) {
          this.resetVoicemail();
          this.vmActiveId = msg.vmId;
        }
        if (msg.samples && msg.samples.length > 0) {
          this.vmChunks.push(msg.samples);
        }
        if (msg.isLast) {
          this.vmAllChunksReceived = true;
        }
      } else if (msg.type === 'vm_end') {
        if (this.vmActiveId === null || msg.vmId === this.vmActiveId) {
          this.vmAllChunksReceived = true;
          if (this.vmChunks.length === 0) {
            const doneId = this.vmActiveId;
            this.resetVoicemail();
            this.port.postMessage({ type: 'voicemail_drain_complete', vmId: doneId });
          }
        }
      } else if (msg.type === 'vm_clear') {
        this.resetVoicemail();
      }
    };
  }

  resetAll() {
    for (let i = 0; i < 8; i++) {
      const s = this.slots[i];
      s.head = 0;
      s.tail = 0;
      s.count = 0;
      s.phase = 0.0;
      s.curr = 0.0;
      s.next = 0.0;
      s.primed = false;
    }
    this.resetVoicemail();
  }

  resetVoicemail() {
    this.vmChunks = [];
    this.vmReadIndex = 0;
    this.vmPhase = 0.0;
    this.vmCurr = 0.0;
    this.vmNext = 0.0;
    this.vmPrimed = false;
    this.vmActiveId = null;
    this.vmAllChunksReceived = false;
  }

  pushSlotSamples(slotIdx, samples) {
    const s = this.slots[slotIdx];
    const cap = this.slotCapacity;
    for (let i = 0; i < samples.length; i++) {
      if (s.count >= cap) {
        s.tail = (s.tail + 1) % cap;
        s.count--;
      }
      s.buf[s.head] = samples[i];
      s.head = (s.head + 1) % cap;
      s.count++;
    }
    // Trim excess jitter latency (> 360ms at 16 kHz = 5760 samples)
    while (s.count > 5760) {
      s.tail = (s.tail + 1) % cap;
      s.count--;
    }
  }

  popSlotSample(s) {
    if (s.count <= 0) return null;
    const val = s.buf[s.tail];
    s.tail = (s.tail + 1) % this.slotCapacity;
    s.count--;
    return val;
  }

  nextSlotSample(s) {
    if (!s.primed) {
      if (s.count < 2) return 0.0;
      s.curr = this.popSlotSample(s);
      s.next = this.popSlotSample(s);
      s.phase = 0.0;
      s.primed = true;
    }
    const out = s.curr + (s.next - s.curr) * s.phase;
    s.phase += this.ratio;
    while (s.phase >= 1.0) {
      s.phase -= 1.0;
      s.curr = s.next;
      const nxt = this.popSlotSample(s);
      if (nxt === null) {
        s.next = 0.0;
        s.primed = false;
        break;
      }
      s.next = nxt;
    }
    return out;
  }

  popVmSample() {
    while (this.vmChunks.length > 0) {
      const chunk = this.vmChunks[0];
      if (this.vmReadIndex < chunk.length) {
        return chunk[this.vmReadIndex++];
      }
      this.vmChunks.shift();
      this.vmReadIndex = 0;
    }
    return null;
  }

  nextVmSample() {
    if (!this.vmPrimed) {
      const first = this.popVmSample();
      if (first === null) return null;
      const second = this.popVmSample();
      this.vmCurr = first;
      this.vmNext = second !== null ? second : first;
      this.vmPhase = 0.0;
      this.vmPrimed = true;
    }
    const out = this.vmCurr + (this.vmNext - this.vmCurr) * this.vmPhase;
    this.vmPhase += this.ratio;
    while (this.vmPhase >= 1.0) {
      this.vmPhase -= 1.0;
      this.vmCurr = this.vmNext;
      const nxt = this.popVmSample();
      if (nxt === null) {
        this.vmNext = 0.0;
        this.vmPrimed = false;
        break;
      }
      this.vmNext = nxt;
    }
    return out;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outChan = output[0];

    for (let i = 0; i < outChan.length; i++) {
      let mixed = 0.0;

      for (let slotIdx = 0; slotIdx < 8; slotIdx++) {
        const s = this.slots[slotIdx];
        if (s.primed || s.count >= 256) {
          mixed += this.nextSlotSample(s);
        }
      }

      if (this.vmPrimed || this.vmChunks.length > 0) {
        const vmVal = this.nextVmSample();
        if (vmVal !== null) {
          mixed += vmVal;
        }
      } else if (this.vmAllChunksReceived && this.vmActiveId !== null) {
        const doneId = this.vmActiveId;
        this.resetVoicemail();
        this.port.postMessage({ type: 'voicemail_drain_complete', vmId: doneId });
      }

      if (mixed > 1.0) mixed = 1.0;
      else if (mixed < -1.0) mixed = -1.0;
      outChan[i] = mixed;
    }

    // Mirror mono to any additional output channels
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(outChan);
    }
    return true;
  }
}

registerProcessor('decatone-playback-processor', DecaTonePlaybackProcessor);

