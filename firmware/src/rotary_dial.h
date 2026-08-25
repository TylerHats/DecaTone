#pragma once
#include <Arduino.h>
#include "config.h"

typedef void (*OnDigitDialedCallback)(char digit);
typedef void (*OnHookStateChangedCallback)(bool isOffHook);

class RotaryDialManager {
public:
  void begin(OnDigitDialedCallback digitCb, OnHookStateChangedCallback hookCb);
  void update();
  bool isOffHook() const;

  // Interrupt handlers
  static void IRAM_ATTR handlePulseInterrupt();
  static void IRAM_ATTR handleHookInterrupt();

private:
  static volatile uint32_t s_pulseCount;
  static volatile uint32_t s_lastPulseTime;
  static volatile bool s_offNormalActive;
  static volatile bool s_hookChanged;
  static volatile uint32_t s_lastHookTime;

  bool m_currentOffHook = false;
  uint32_t m_lastProcessedPulseTime = 0;
  OnDigitDialedCallback m_digitCallback = nullptr;
  OnHookStateChangedCallback m_hookCallback = nullptr;
};

extern RotaryDialManager RotaryDial;
