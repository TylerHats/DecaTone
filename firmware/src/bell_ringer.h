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

private:
  bool m_isRinging = false;
  uint32_t m_patternIndex = 0;
  uint32_t m_lastPhaseTime = 0;
  bool m_bellStateOn = false;

  // 20Hz AC Sub-oscillator for MOSFET gate pulsing
  uint32_t m_lastOscillatorTime = 0;
  bool m_oscillatorState = false;

  // Cadence steps (durations in ms: On, Off, On, Off...)
  uint16_t m_cadenceSteps[10];
  uint8_t m_totalSteps = 0;

  void parseCadence(const String& style, const String& customCadence);
};

extern BellRingerManager BellRinger;
