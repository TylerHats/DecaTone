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

## 2. Real-Time Audio DSP Character Profiles

DecaTone includes on-device Digital Signal Processing (DSP) executed directly on the **ESP32-S3** before audio is encrypted and transmitted over WebSockets. Users can switch audio profiles on the fly from their web interface:

### Available Sound Profiles
1. **Modern HD Voice (`modern_hd`)**:
   - Transparent 16kHz uncompressed linear PCM with wideband frequency response and wide dynamic range.
2. **Vintage POTS Telephone (`vintage_pots` - Default)**:
   - Bandpass filter (300Hz–3400Hz) simulating traditional Plain Old Telephone Service (POTS) copper wire loop limits with subtle harmonic warmth (carbon granule microphone simulation).
3. **1930s Early Bell System (`early_1930s`)**:
   - Resonant 400Hz–2500Hz bandpass filter with antique non-linear saturation, recreating the warm, nostalgic sound of early Western Electric desk sets.

---

## 3. Handset Sidetone Feedback

Vintage telephones used physical hybrid induction coils to feed a small fraction (typically 5%–15%) of the user's spoken voice from the carbon microphone directly back into the earpiece receiver. This creates an authentic tactile sensation and prevents users from shouting.

- **Configurable in Web UI**: Drag the **Sidetone Feedback** slider from **0%** (silent) up to **30%** (loud).
- **Default**: `10%` provides an authentic vintage handset feel.

---

## 4. Real-Time WebSocket Synchronization

When you drag any slider (Earpiece Volume, Mic Sensitivity, Sidetone) or select an Audio Profile in the web interface:
1. The web client immediately sends a PUT request to `/api/phone/settings`.
2. The DecaTone switchboard pushes an `apply_settings` JSON command over the persistent WebSocket to the ESP32-S3.
3. The ESP32-S3 updates its live DSP filter pipeline and amplifier multipliers in sub-millisecond real-time with no audio dropouts!

---

## 5. Audio Gain & Level Optimization

Users can configure audio levels in the web UI under **Hardware & Audio**:

### Earpiece Speaker (MAX98357A I2S DAC)
- Adjust the volume slider between **0% and 100%**.
- Recommended volume is **70%–85%** to prevent acoustic distortion on high-efficiency vintage earpiece transducers.

### Handset Microphone (MAX4466 Analog Pre-Amp)
- Adjust the mic sensitivity slider between **0% and 100%**.
- Also check the physical potentiometer on the back of the MAX4466 breakout board to set the hardware pre-gain.
