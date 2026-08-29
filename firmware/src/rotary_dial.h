#pragma once
#include <Arduino.h>
#include "config.h"

typedef void (*OnDigitDialedCallback)(char digit);
typedef void (*OnHookStateChangedCallback)(bool isOffHook);
typedef void (*OnHookFlashCallback)();

class RotaryDialManager {
public:
  void begin(OnDigitDialedCallback digitCb, OnHookStateChangedCallback hookCb, OnHookFlashCallback flashCb = nullptr);
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
  bool m_hookPendingHangup = false;
  uint32_t m_hookDownTime = 0;
  uint32_t m_lastProcessedPulseTime = 0;
  OnDigitDialedCallback m_digitCallback = nullptr;
  OnHookStateChangedCallback m_hookCallback = nullptr;
  OnHookFlashCallback m_hookFlashCallback = nullptr;
};

extern RotaryDialManager RotaryDial;
