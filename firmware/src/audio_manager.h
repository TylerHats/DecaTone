#pragma once
#include <Arduino.h>
#include "driver/i2s.h"
#include "config.h"

enum ToneType {
  TONE_NONE = 0,
  TONE_DIAL,       // 350Hz + 440Hz continuous
  TONE_RINGBACK,   // 440Hz + 480Hz (2s on / 4s off)
  TONE_BUSY        // 480Hz + 620Hz (0.5s on / 0.5s off)
};

enum AudioProfile {
  PROFILE_MODERN_HD = 0,    // 16kHz transparent wideband
  PROFILE_VINTAGE_POTS = 1,  // 300Hz-3400Hz POTS bandpass + carbon mic warmth
  PROFILE_1930S_ANTIQUE = 2  // 400Hz-2500Hz narrow bandpass + lo-fi saturation
};

class AudioManager {
public:
  void begin();
  void update();

  // Tone generation
  void playTone(ToneType tone);
  void stopTone();
  ToneType currentTone() const;

  // Streaming audio I/O with DSP
  size_t readMicSamples(int16_t* buffer, size_t numSamples);
  void writeSpeakerSamples(const int16_t* buffer, size_t numSamples);

  // Volume, Mic Gain & Sidetone
  void setSpeakerVolume(uint8_t volumePercent); // 0-100%
  void setMicSensitivity(uint8_t gainPercent);   // 0-100%
  void setSidetoneLevel(uint8_t sidetonePercent); // 0-30%
  void setAudioProfile(const String& profileName);

private:
  ToneType m_activeTone = TONE_NONE;
  AudioProfile m_activeProfile = PROFILE_VINTAGE_POTS;
  uint8_t m_speakerVolume = 80;
  uint8_t m_micSensitivity = 80;
  uint8_t m_sidetoneLevel = 10;

  float m_volumeMultiplier = 0.8f;
  float m_gainMultiplier = 1.0f;
  float m_sidetoneMultiplier = 0.10f;

  uint32_t m_tonePhase = 0;
  uint32_t m_lastToneToggleTime = 0;

  // Biquad Filter States for DSP Bandpass
  float m_hp_x1 = 0, m_hp_x2 = 0, m_hp_y1 = 0, m_hp_y2 = 0;
  float m_lp_x1 = 0, m_lp_x2 = 0, m_lp_y1 = 0, m_lp_y2 = 0;

  void initI2S();
  void initADC();
  void generateToneChunk(int16_t* buffer, size_t samples, float f1, float f2);

  // DSP Filter Processors
  int16_t processDspSample(int16_t inSample);
  int16_t applyVintageWarmth(int16_t sample, float drive);
};

extern AudioManager Audio;
