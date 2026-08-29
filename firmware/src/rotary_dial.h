#pragma once
#include <Arduino.h>
#include "config.h"

typedef void (*DigitDialedCallback)(char digit, float pps, float breakRatio, uint32_t pulseCount);
typedef void (*HookStateCallback)(bool isOffHook);
typedef void (*HookFlashCallback)();

class RotaryDialManager {
public:
  void begin(DigitDialedCallback digitCb, HookStateCallback hookCb, HookFlashCallback flashCb = nullptr);
  void update();
  bool isOffHook() const;

  // Interrupt Service Routines
  static void IRAM_ATTR handlePulseInterrupt();
  static void IRAM_ATTR handleHookInterrupt();
  static void IRAM_ATTR handleOffNormalInterrupt();

private:
  DigitDialedCallback m_digitCallback = nullptr;
  HookStateCallback m_hookCallback = nullptr;
  HookFlashCallback m_flashCallback = nullptr;

  bool m_currentOffHook = false;
  uint32_t m_hookDebounceTime = 0;
  uint32_t m_hookDownStartTime = 0;
  bool m_evaluatingHookFlash = false;

  // Pulse & Rhythm Tracking
  static volatile uint32_t s_pulseCount;
  static volatile uint32_t s_firstPulseTime;
  static volatile uint32_t s_lastPulseTime;
  static volatile uint32_t s_totalBreakDurationMs;
  static volatile uint32_t s_pulseBreakStart;
  static volatile bool s_offNormalActive;
  static volatile bool s_hookChanged;
  static volatile uint32_t s_lastHookTime;
};

extern RotaryDialManager RotaryDial;
