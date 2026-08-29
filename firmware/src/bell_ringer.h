#pragma once
#include <Arduino.h>
#include "config.h"

class BellRingerManager {
public:
  void begin();
  void update();

  void startRing(const String& style = "traditional", const String& customCadence = "2000,4000");
  void stopRing();
  bool isRinging() const;

  void setRingFrequency(float freqHz);
  float getRingFrequency() const;

private:
  bool m_isRinging = false;
  uint32_t m_patternIndex = 0;
  uint32_t m_lastPhaseTime = 0;
  bool m_bellStateOn = false;

  // Dynamic PWM AC sub-oscillator for MOSFET gate pulsing
  float m_frequencyHz = DEFAULT_BELL_FREQ_HZ;
  uint32_t m_halfPeriodUs = 25000;
  uint32_t m_lastOscillatorTime = 0;
  bool m_oscillatorState = false;

  // Cadence steps (durations in ms: On, Off, On, Off...)
  uint16_t m_cadenceSteps[10];
  uint8_t m_totalSteps = 0;

  void parseCadence(const String& style, const String& customCadence);
};

extern BellRingerManager BellRinger;
