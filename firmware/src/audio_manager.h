#pragma once
#include <Arduino.h>
#include "driver/i2s.h"
#include "config.h"

enum AudioProfile {
  PROFILE_VINTAGE_POTS = 0,
  PROFILE_MODERN_HD,
  PROFILE_1930S_ANTIQUE
};

class AudioManager {
public:
  void begin();
  void update();

  // Speaker / Earpiece I2S output with DSP, normalization, and volume scaling
  void writeSpeakerSamples(const int16_t* samples, size_t count);

  // Microphone ADC reading with DC subtraction, AGC, and noise gating
  size_t readMicSamples(int16_t* buffer, size_t maxSamples);

  // User preference configuration
  void setSpeakerVolume(uint8_t volumePercent);
  void setMicSensitivity(uint8_t gainPercent);
  void setSidetoneLevel(uint8_t sidetonePercent);
  void setAudioProfile(const String& profileName);

  // Normalization & AGC control
  void setInboundNormalizationEnabled(bool enabled);
  void setOutboundAgcEnabled(bool enabled);

private:
  uint8_t m_speakerVolume = 80;
  float m_volumeMultiplier = 0.8f;
  uint8_t m_micSensitivity = 80;
  float m_gainMultiplier = 1.6f;
  uint8_t m_sidetoneLevel = 10;
  float m_sidetoneMultiplier = 0.1f;
  AudioProfile m_activeProfile = PROFILE_VINTAGE_POTS;

  // Inbound Audio Normalization & Peak Limiting DSP State
  bool m_inboundNormEnabled = true;
  float m_inboundRmsLevel = 4000.0f; // Nominal initial target (~ -18 dBFS)
  float m_inboundNormGain = 1.0f;

  // Outbound Microphone AGC & Noise Gate DSP State
  bool m_outboundAgcEnabled = true;
  float m_micRmsLevel = 3000.0f;
  float m_micAgcGain = 1.0f;
  int32_t m_micDcBaseline = 2048; // Center of 12-bit ADC (3.3V / 2)

  // Vintage Biquad / IIR Filter State Buffers (16kHz sample rate)
  float m_hp_x1 = 0, m_hp_y1 = 0;
  float m_lp_x1 = 0, m_lp_y1 = 0;

  void initI2S();
  void initADC();

  int16_t processDspSample(int16_t inSample);
  int16_t applyVintageWarmth(int16_t sample, float drive);
  float processInboundLeveler(float sample);
  int16_t processOutboundAgc(int16_t rawSample);
};

extern AudioManager Audio;
