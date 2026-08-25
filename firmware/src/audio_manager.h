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

class AudioManager {
public:
  void begin();
  void update();

  // Tone generation
  void playTone(ToneType tone);
  void stopTone();
  ToneType currentTone() const;

  // Streaming audio I/O
  size_t readMicSamples(int16_t* buffer, size_t numSamples);
  void writeSpeakerSamples(const int16_t* buffer, size_t numSamples);

  // Volume & Mic Gain
  void setSpeakerVolume(uint8_t volumePercent); // 0-100
  void setMicSensitivity(uint8_t gainPercent);   // 0-100

private:
  ToneType m_activeTone = TONE_NONE;
  uint8_t m_speakerVolume = 80;
  uint8_t m_micSensitivity = 80;
  float m_volumeMultiplier = 0.8f;
  float m_gainMultiplier = 1.0f;

  uint32_t m_tonePhase = 0;
  uint32_t m_lastToneToggleTime = 0;
  bool m_toneAudioMuted = false;

  void initI2S();
  void initADC();
  void generateToneChunk(int16_t* buffer, size_t samples, float f1, float f2);
};

extern AudioManager Audio;
