# Audio Normalization, DSP and Bell Ringer Tuning

This guide covers DecaTone's audio processing pipeline, dynamic loudness normalization, vintage acoustic filters, and mechanical bell ringer calibration.

---

## 1. Real-Time Audio Normalization & Mic AGC

Vintage rotary telephones have fixed acoustic cavities and no external volume control knobs. DecaTone solves this using real-time DSP normalization on the ESP32-S3:

### A. Inbound Dynamic Normalization (Earpiece Side)
- **Exponential Moving Average (EMA) Energy Tracking**: Measures the perceptual loudness of incoming voice packets from any caller (other rotary phones, browser softphones, or automated TTS service lines).
- **Target RMS Normalization**: Smoothly scales incoming audio to a reference -18 dBFS telephony baseline.
- **Soft-Knee Peak Limiter**: Tames sudden loud shouts or coughs to prevent ear discomfort.
- **Master Volume Scaling**: Multiplies normalized audio by the user's web-configured earpiece volume setting (`0%` to `100%`).

### B. Outbound Microphone AGC (Transmitter Side)
- **Automatic Gain Control**: Real-time gain expansion and compression standardizes voice levels before transmission over WebSockets.
- **Ambient Noise Gate**: Attenuates background room noise when the speaker is silent.

---

## 2. Acoustic Vintage Profiles

Under **Phone Settings &rarr; Audio DSP Profile**, you can select between three historical acoustic responses:

1. **Vintage POTS (Default)**:
   - Bandpass filter: 300Hz high-pass / 3400Hz low-pass.
   - Non-linear soft-saturation curve modeling the harmonic warmth of carbon granule telephone transmitters.
2. **1930s Early Bell System**:
   - Bandpass filter: 450Hz high-pass / 2500Hz low-pass.
   - Narrowband lo-fi compression characteristic of antique candlestick and early desktop bakelite phones (e.g. Western Electric 202/302).
3. **Modern HD (Linear Wideband)**:
   - Full 16kHz uncolored linear audio.

---

## 3. Sidetone Feedback

In authentic landline telephony, a small portion of the speaker's own voice is fed back into their earpiece so they know the phone is working and don't shout. DecaTone allows users to adjust sidetone levels between `0%` and `30%` (default `10%`).

---

## 4. Mechanical Bell Ringer Tuning & Resonance Sweep

### A. Bell Frequency Tuning
Different telephone bell mechanisms have distinct mechanical resonant frequencies:
- **Western Electric C4A / 500 series**: 20.0 Hz.
- **Automatic Electric (AE) straight-line ringers**: 20.0 Hz – 25.0 Hz.
- **Frequency-selective party-line ringers**: 16.6 Hz, 25.0 Hz, 30.0 Hz, 33.3 Hz, etc.

You can adjust the ringing frequency in `0.1 Hz` increments under **Phone Settings &rarr; Mechanical Resonance Sweep**, or use the interactive sweep tool to test different frequencies (15Hz–30Hz) in real time to find the maximum volume sweet spot for your physical bells.

### B. Customizable Ring Cadences
- **Traditional North American**: 2.0s On / 4.0s Off (`2000,4000`).
- **European Double-Ring**: 0.4s On / 0.2s Off / 0.4s On / 2.0s Off (`400,200,400,2000`).
- **Pulsed Short**: 0.2s On / 0.2s Off / 0.2s On / 0.2s Off / 0.2s On / 2.5s Off.
- **Custom**: Define any comma-separated millisecond sequence in the web portal (e.g. `1000,1000,1000,3000`).
