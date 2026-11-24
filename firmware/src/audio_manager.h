#pragma once
#include <Arduino.h>
#include <atomic>
#include "driver/i2s.h"
#include "driver/adc.h"
#include "config.h"

enum AudioProfile {
  PROFILE_VINTAGE_POTS = 0,
  PROFILE_MODERN_HD,
  PROFILE_1930S_ANTIQUE
};

enum LocalToneType {
  TONE_NONE = 0,
  TONE_DIAL,
  TONE_STUTTER_DIAL,
  TONE_DND_DIAL,
  TONE_STUTTER_DND,
  TONE_RINGBACK,
  TONE_BUSY,
  TONE_REORDER,
  TONE_CALL_WAITING,
  TONE_BEEP,
  TONE_CHIRP,
  TONE_WHISPER_DIAL,
  TONE_HOWLER
};

class AudioManager {
public:
  static constexpr uint32_t RX_RING_SIZE = 4096; // Power of 2 (256ms @ 16kHz)
  static constexpr uint32_t TX_RING_SIZE = 2048; // Power of 2 (128ms @ 16kHz)
  static constexpr uint32_t ADC_PCM_RING_SIZE = 2048; // Power of 2 (128ms @ 16kHz)
  static constexpr size_t MAX_MIX_SLOTS = 4;     // Max simultaneous conference audio slots [0x04]

  void begin();
  void update();

  // Non-blocking lock-free SPSC speaker write (safe from WebSocket callback on Core 0)
  void pushInboundSlotAudio(uint8_t slot, const int16_t* samples, size_t count);
  void writeSpeakerSamples(const int16_t* samples, size_t count);
  size_t getSpeakerFreeSamples() const;
  size_t getAvailableSpeakerSamples() const;
  void clearSpeakerBuffer();

  // Non-blocking lock-free SPSC microphone read (paced accurately at 16kHz on Core 1)
  size_t readMicSamples(int16_t* buffer, size_t maxSamples);
  size_t getAvailableMicSamples() const;
  void setMicStreamActive(bool active);
  void clearMicBuffer();

  // Local Bell System Progress Tone Generator (synthesized on Core 1)
  void playTone(const String& toneName);
  void stopTone();
  bool isTonePlaying() const;

  // Acoustic Bell Resonance Calibration RMS Measurement
  void startMicRmsWindow();
  float finishMicRmsWindow();
  float measureMicRms(uint32_t durationMs);
  bool isCalibrating() const { return m_calActive.load(std::memory_order_relaxed); }

  bool isActive() const;

  // User preference configuration
  void setSpeakerVolume(uint8_t volumePercent);
  void setMicSensitivity(uint8_t gainPercent);
  void setSidetoneLevel(uint8_t sidetonePercent);
  void setAudioProfile(const String& profileName);

  // Normalization & AGC control
  void setInboundNormalizationEnabled(bool enabled);
  void setOutboundAgcEnabled(bool enabled);

private:
  struct RxMixSlot {
    int16_t buf[RX_RING_SIZE];
    std::atomic<uint32_t> writeIdx{0};
    std::atomic<uint32_t> readIdx{0};
    float rmsLevel = 4000.0f;
    float normGain = 1.0f;
  };

  // Lock-free SPSC Ring Buffers (Core 0 <-> Core 1)
  RxMixSlot m_rxSlots[MAX_MIX_SLOTS];

  int16_t m_txRingBuf[TX_RING_SIZE];
  std::atomic<uint32_t> m_txWriteIdx{0};
  std::atomic<uint32_t> m_txReadIdx{0};
  std::atomic<bool> m_micStreamActive{false};

  // Continuous 32kHz -> 16kHz Decimated ADC DMA Ring Buffer (Core 1 only)
  bool m_adcDmaReady = false;
  uint8_t m_adcChannel = 0;
  bool m_adcHasOddSample = false;
  int32_t m_adcOddSample = 0;
  int16_t m_adcPcmRing[ADC_PCM_RING_SIZE];
  uint32_t m_adcPcmWriteIdx = 0;
  uint32_t m_adcPcmReadIdx = 0;
  int16_t m_lastAdcSample = 0;

  // Accurate 16kHz sample pacing state (62.5us/sample -> 125 half-us/sample)
  int64_t m_lastUpdateUs = 0;
  uint32_t m_halfUsAccum = 0;

  // User Audio & DSP Gains
  std::atomic<float> m_volumeMultiplier{0.8f};
  std::atomic<float> m_gainMultiplier{1.6f};
  std::atomic<float> m_sidetoneMultiplier{0.1f};
  uint8_t m_speakerVolume = 80;
  uint8_t m_micSensitivity = 80;
  uint8_t m_sidetoneLevel = 10;
  std::atomic<int> m_activeProfile{PROFILE_VINTAGE_POTS};

  // Inbound Audio Normalization Toggle (per-slot state lives in RxMixSlot)
  std::atomic<bool> m_inboundNormEnabled{true};

  // Outbound Microphone AGC & Noise Gate DSP State (Core 1)
  std::atomic<bool> m_outboundAgcEnabled{true};
  float m_micRmsLevel = 3000.0f;
  float m_micAgcGain = 1.0f;
  int32_t m_micDcBaseline = 2048;

  // Vintage Biquad / IIR Filter State Buffers (Core 1)
  float m_hp_x1 = 0.0f, m_hp_y1 = 0.0f;
  float m_lp_x1 = 0.0f, m_lp_y1 = 0.0f;
  std::atomic<bool> m_resetFilterState{false};

  // Local Tone Synth State (guarded by m_toneMux)
  mutable portMUX_TYPE m_toneMux = portMUX_INITIALIZER_UNLOCKED;
  LocalToneType m_toneType = TONE_NONE;
  uint32_t m_toneSamplePos = 0;
  float m_phase1 = 0.0f;
  float m_phase2 = 0.0f;
  float m_phase3 = 0.0f;
  float m_phase4 = 0.0f;
  float m_modPhase = 0.0f;

  // Calibration RMS Window State
  portMUX_TYPE m_calMux = portMUX_INITIALIZER_UNLOCKED;
  std::atomic<bool> m_calActive{false};
  uint64_t m_calSumSq = 0;
  uint32_t m_calSampleCount = 0;

  void initI2S();
  void initADC();
  void pumpAdcDma();

  int16_t sampleMicRawCentered();
  int16_t processDspSample(int16_t inSample);
  int16_t applyVintageWarmth(int16_t sample, float drive);
  float processInboundLeveler(RxMixSlot& slot, float sample);
  int16_t processOutboundAgc(int16_t rawSample);
  int16_t synthesizeNextToneSample();
};

extern AudioManager Audio;
