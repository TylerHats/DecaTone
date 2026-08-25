# Audio and Bell Ringer Tuning

This guide covers fine-tuning audio levels, microphone gain, and mechanical bell ringer resonance.

---

## 1. Bell Ringer Resonance & Cadence

Vintage mechanical telephone bells use an alternating magnetic field to pull a spring-loaded clapper back and forth between two brass gongs.

### 20Hz AC Resonance
- Traditional central offices generated 20Hz (or 25Hz) AC at ~90V RMS.
- In DecaTone, our circuit uses an **IRF640N MOSFET** switching a **24V–48V DC boost supply** at exactly **20Hz** (50ms period = 25ms HIGH / 25ms LOW).
- The **~470nF film capacitor** placed across the coils creates an LC tank with the coil inductance, causing the magnetic polarity across the clapper to alternate smoothly, producing a loud and authentic chime!

### Predefined Cadence Styles

1. **Traditional US Bell**:
   - `2.0s Ring / 4.0s Silence`
2. **European Double-Ring (British / European Cadence)**:
   - `0.4s Ring / 0.2s Silence / 0.4s Ring / 2.0s Silence`
3. **Short Pulse Burst**:
   - `0.2s Ring / 0.2s Silence (x3) / 2.5s Silence`
4. **Rapid / Continuous**:
   - `1.5s Ring / 1.5s Silence`
5. **Custom Millisecond Timing**:
   - Define comma-separated durations (e.g. `1000,500,1000,3000`).

---

## 2. Audio Gain & Level Optimization

Users can configure audio levels in the web UI under **Hardware & Audio**:

### Earpiece Speaker (MAX98357A I2S DAC)
- Adjust the volume slider between **0% and 100%**.
- The MAX98357A amplifies the 16-bit digital PCM stream. Recommended volume is **70%–85%** to prevent acoustic distortion on high-efficiency vintage earpiece transducers.

### Handset Microphone (MAX4466 Analog Pre-Amp)
- Adjust the mic sensitivity slider between **0% and 100%**.
- Also check the physical potentiometer on the back of the MAX4466 breakout board to set the hardware pre-gain.
