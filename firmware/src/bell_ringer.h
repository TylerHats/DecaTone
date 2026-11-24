#pragma once
#include <Arduino.h>
#include "config.h"

class BellRingerManager {
public:
  void begin();
  void update();

  void startRing(const String& style = "traditional", const String& customCadence = "2000,4000");
  void startContinuousCalibration(float freqHz);
  void stopRing();
  bool isRinging() const { return m_isRinging; }

  void setRingFrequency(float freqHz);
  float getRingFrequency() const { return m_frequencyHz; }

private:
  bool m_isRinging = false;
  bool m_continuousMode = false;
  uint32_t m_patternIndex = 0;
  uint32_t m_lastPhaseTime = 0;
  bool m_bellStateOn = false;

  // Dynamic AC sub-oscillator for complementary H-bridge switching
  float m_frequencyHz = DEFAULT_BELL_FREQ_HZ;
  uint32_t m_halfPeriodUs = 25000;
  uint32_t m_lastOscillatorTime = 0;
  bool m_oscillatorState = false;

  // Cadence steps (durations in ms: On, Off, On, Off...)
  uint16_t m_cadenceSteps[12];
  uint8_t m_totalSteps = 0;

  void parseCadence(const String& style, const String& customCadence);
  void setBridgeIdle();
};

extern BellRingerManager BellRinger;
