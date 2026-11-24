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
  bool isOffHook() const { return m_currentOffHook; }

  // Interrupt Service Routines for high-speed rotary mechanical contacts
  static void IRAM_ATTR handlePulseInterrupt();
  static void IRAM_ATTR handleOffNormalInterrupt();

private:
  DigitDialedCallback m_digitCallback = nullptr;
  HookStateCallback m_hookCallback = nullptr;
  HookFlashCallback m_flashCallback = nullptr;

  bool m_currentOffHook = false;
  bool m_debouncedOffHook = false;
  bool m_lastRawOffHook = false;
  uint32_t m_lastHookBounceTime = 0;

  uint32_t m_hookDownStartTime = 0;
  bool m_evaluatingHookFlash = false;

  void syncIsrOffHookGate(bool allowPulses);
  void resetPulseCounters();

  // Shared ISR Pulse & Rhythm Tracking (protected by s_mux)
  static portMUX_TYPE s_mux;
  static volatile uint32_t s_pulseCount;
  static volatile uint32_t s_firstPulseTime;
  static volatile uint32_t s_lastPulseTime;
  static volatile uint32_t s_totalBreakDurationMs;
  static volatile uint32_t s_pulseBreakStart;
  static volatile uint32_t s_totalMakeDurationMs;
  static volatile uint32_t s_lastMakeStart;
  static volatile bool s_offNormalActive;
  static volatile bool s_offNormalSeen;
  static volatile uint32_t s_offNormalReleaseTime;
  static volatile bool s_offHookGate;
};

extern RotaryDialManager RotaryDial;
