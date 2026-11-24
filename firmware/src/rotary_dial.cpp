#include "rotary_dial.h"
#include "provisioning.h"
#include <esp_timer.h>
#include <driver/gpio.h>

RotaryDialManager RotaryDial;

portMUX_TYPE RotaryDialManager::s_mux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t RotaryDialManager::s_pulseCount = 0;
volatile uint32_t RotaryDialManager::s_firstPulseTime = 0;
volatile uint32_t RotaryDialManager::s_lastPulseTime = 0;
volatile uint32_t RotaryDialManager::s_totalBreakDurationMs = 0;
volatile uint32_t RotaryDialManager::s_pulseBreakStart = 0;
volatile uint32_t RotaryDialManager::s_totalMakeDurationMs = 0;
volatile uint32_t RotaryDialManager::s_lastMakeStart = 0;
volatile bool RotaryDialManager::s_offNormalActive = false;
volatile bool RotaryDialManager::s_offNormalSeen = false;
volatile uint32_t RotaryDialManager::s_offNormalReleaseTime = 0;
volatile bool RotaryDialManager::s_offHookGate = false;

void IRAM_ATTR RotaryDialManager::handlePulseInterrupt() {
  uint32_t now = (uint32_t)(esp_timer_get_time() / 1000ULL);
  int pinVal = gpio_get_level((gpio_num_t)PIN_DIAL_PULSE);

  portENTER_CRITICAL_ISR(&s_mux);
  if (!s_offHookGate) {
    portEXIT_CRITICAL_ISR(&s_mux);
    return;
  }

  // If phone has an off-normal shunt switch wired, require dial wheel to be off-normal
  // (or within 60ms of governor return release) to reject cradle/cord bounce.
  bool dialActiveOk = !s_offNormalSeen ||
                      s_offNormalActive ||
                      ((uint32_t)(now - s_offNormalReleaseTime) <= 60) ||
                      (s_pulseCount > 0 && (uint32_t)(now - s_lastPulseTime) <= 220);

  if (dialActiveOk) {
    if (pinVal != 0) {
      // Pulse Break Begins (Contact opens)
      if ((uint32_t)(now - s_lastPulseTime) > ROTARY_DEBOUNCE_MS) {
        if (s_pulseCount == 0) {
          s_firstPulseTime = now;
          s_totalBreakDurationMs = 0;
          s_totalMakeDurationMs = 0;
          s_lastMakeStart = 0;
        } else if (s_lastMakeStart > 0) {
          s_totalMakeDurationMs += (uint32_t)(now - s_lastMakeStart);
          s_lastMakeStart = 0;
        }
        s_pulseBreakStart = now;
        s_pulseCount++;
        s_lastPulseTime = now;
      }
    } else {
      // Pulse Make (Contact closes)
      if (s_pulseBreakStart > 0) {
        s_totalBreakDurationMs += (uint32_t)(now - s_pulseBreakStart);
        s_pulseBreakStart = 0;
        s_lastMakeStart = now;
      }
    }
  }
  portEXIT_CRITICAL_ISR(&s_mux);
}

void IRAM_ATTR RotaryDialManager::handleOffNormalInterrupt() {
  bool active = (gpio_get_level((gpio_num_t)PIN_DIAL_OFF_NORMAL) == 0);
  uint32_t now = (uint32_t)(esp_timer_get_time() / 1000ULL);

  portENTER_CRITICAL_ISR(&s_mux);
  if (active) {
    s_offNormalSeen = true;
    s_offNormalActive = true;
  } else {
    if (s_offNormalActive) {
      s_offNormalReleaseTime = now;
    }
    s_offNormalActive = false;
  }
  portEXIT_CRITICAL_ISR(&s_mux);
}

void RotaryDialManager::syncIsrOffHookGate(bool allowPulses) {
  portENTER_CRITICAL(&s_mux);
  s_offHookGate = allowPulses;
  if (!allowPulses) {
    s_pulseCount = 0;
    s_firstPulseTime = 0;
    s_lastPulseTime = 0;
    s_totalBreakDurationMs = 0;
    s_pulseBreakStart = 0;
    s_totalMakeDurationMs = 0;
    s_lastMakeStart = 0;
  }
  portEXIT_CRITICAL(&s_mux);
}

void RotaryDialManager::resetPulseCounters() {
  portENTER_CRITICAL(&s_mux);
  s_pulseCount = 0;
  s_firstPulseTime = 0;
  s_lastPulseTime = 0;
  s_totalBreakDurationMs = 0;
  s_pulseBreakStart = 0;
  s_totalMakeDurationMs = 0;
  s_lastMakeStart = 0;
  portEXIT_CRITICAL(&s_mux);
}

void RotaryDialManager::begin(DigitDialedCallback digitCb, HookStateCallback hookCb, HookFlashCallback flashCb) {
  m_digitCallback = digitCb;
  m_hookCallback = hookCb;
  m_flashCallback = flashCb;

  pinMode(PIN_HOOK_SWITCH, INPUT_PULLUP);
  pinMode(PIN_DIAL_PULSE, INPUT_PULLUP);
  pinMode(PIN_DIAL_OFF_NORMAL, INPUT_PULLUP);

  bool initialOffHook = (digitalRead(PIN_HOOK_SWITCH) == LOW);
  m_currentOffHook = initialOffHook;
  m_debouncedOffHook = initialOffHook;
  m_lastRawOffHook = initialOffHook;
  m_lastHookBounceTime = millis();

  bool initialOffNormal = (digitalRead(PIN_DIAL_OFF_NORMAL) == LOW);
  portENTER_CRITICAL(&s_mux);
  s_offHookGate = initialOffHook;
  s_offNormalActive = initialOffNormal;
  if (initialOffNormal) s_offNormalSeen = true;
  portEXIT_CRITICAL(&s_mux);

  attachInterrupt(digitalPinToInterrupt(PIN_DIAL_PULSE), handlePulseInterrupt, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_DIAL_OFF_NORMAL), handleOffNormalInterrupt, CHANGE);

  Serial.printf("[Rotary Dial] Initialized. Initial Hook State: %s\n", m_currentOffHook ? "OFF HOOK" : "ON HOOK");
}

void RotaryDialManager::update() {
  uint32_t now = millis();

  // 1. Clean 30ms Stable-State Polling Hook Switch Debouncer (never drops trailing bounce edges)
  bool rawOffHook = (digitalRead(PIN_HOOK_SWITCH) == LOW);
  if (rawOffHook != m_lastRawOffHook) {
    m_lastRawOffHook = rawOffHook;
    m_lastHookBounceTime = now;
  }

  if ((uint32_t)(now - m_lastHookBounceTime) >= HOOK_DEBOUNCE_MS && rawOffHook != m_debouncedOffHook) {
    m_debouncedOffHook = rawOffHook;

    if (m_currentOffHook && !m_debouncedOffHook) {
      // Handset went down on cradle
      syncIsrOffHookGate(false);

      if (Provisioning.getConfig().hookFlashEnabled) {
        m_hookDownStartTime = now;
        m_evaluatingHookFlash = true;
      } else {
        m_evaluatingHookFlash = false;
        m_currentOffHook = false;
        if (m_hookCallback) m_hookCallback(false);
      }
    } else if (!m_debouncedOffHook) {
      // Confirmed on-hook
      m_evaluatingHookFlash = false;
      m_currentOffHook = false;
      syncIsrOffHookGate(false);
    } else {
      // Handset lifted off cradle (m_debouncedOffHook == true)
      if (m_evaluatingHookFlash) {
        uint32_t duration = (uint32_t)(now - m_hookDownStartTime);
        m_evaluatingHookFlash = false;
        syncIsrOffHookGate(true);

        if (duration >= HOOK_FLASH_MIN_MS && duration <= HOOK_FLASH_MAX_MS) {
          Serial.printf("[Rotary Dial] ⚡ Hook-Flash Detected! (%u ms)\n", duration);
          if (m_flashCallback) m_flashCallback();
        }
      } else if (!m_currentOffHook) {
        m_currentOffHook = true;
        syncIsrOffHookGate(true);
        if (m_hookCallback) m_hookCallback(true);
      }
    }
  }

  // Evaluate Hook-Flash expiration -> confirmed hangup
  if (m_evaluatingHookFlash && (uint32_t)(now - m_hookDownStartTime) > HOOK_FLASH_MAX_MS) {
    m_evaluatingHookFlash = false;
    m_currentOffHook = false;
    syncIsrOffHookGate(false);
    if (m_hookCallback) m_hookCallback(false);
  }

  // 2. Process Completed Dial Digit & Telemetry Calculation (320ms completion window)
  uint32_t pulses = 0;
  uint32_t firstPulse = 0;
  uint32_t lastPulse = 0;
  uint32_t totalBreakMs = 0;
  uint32_t totalMakeMs = 0;
  bool readyToDecode = false;

  portENTER_CRITICAL(&s_mux);
  if (s_pulseCount > 0 && !s_offNormalActive && (uint32_t)(now - s_lastPulseTime) > PULSE_COMPLETE_MS) {
    pulses = s_pulseCount;
    firstPulse = s_firstPulseTime;
    lastPulse = s_lastPulseTime;
    totalBreakMs = s_totalBreakDurationMs;
    totalMakeMs = s_totalMakeDurationMs;

    s_pulseCount = 0;
    s_firstPulseTime = 0;
    s_lastPulseTime = 0;
    s_totalBreakDurationMs = 0;
    s_pulseBreakStart = 0;
    s_totalMakeDurationMs = 0;
    s_lastMakeStart = 0;
    readyToDecode = true;
  }
  portEXIT_CRITICAL(&s_mux);

  if (readyToDecode) {
    if (!m_currentOffHook || m_evaluatingHookFlash) {
      return;
    }

    // Reject contact bounce counts > 10 instead of mis-mapping 11+ pulses to '0'
    if (pulses < 1 || pulses > 10) {
      Serial.printf("[Rotary Dial] ⚠️ Ignoring invalid contact bounce pulse count (%u pulses)\n", pulses);
      return;
    }

    uint32_t totalDurationMs = (lastPulse > firstPulse) ? (uint32_t)(lastPulse - firstPulse) : 100;

    float pps = 10.0f;
    if (pulses > 1 && totalDurationMs > 0) {
      pps = ((float)(pulses - 1) / (float)totalDurationMs) * 1000.0f;
    }

    float breakRatio = 60.0f;
    if (pulses >= 2 && totalBreakMs > 0 && totalMakeMs > 0) {
      float meanBreak = (float)totalBreakMs / (float)pulses;
      float meanMake = (float)totalMakeMs / (float)(pulses - 1);
      breakRatio = (meanBreak / (meanBreak + meanMake)) * 100.0f;
      if (breakRatio > 95.0f || breakRatio < 15.0f) breakRatio = 60.0f;
    }

    char digit = (pulses == 10) ? '0' : static_cast<char>('0' + pulses);

    Serial.printf("[Rotary Dial] 🔢 Digit '%c' decoded (%u pulses, %.1f PPS, %.0f%% Break Ratio)\n",
      digit, pulses, pps, breakRatio);

    if (m_digitCallback) {
      m_digitCallback(digit, pps, breakRatio, pulses);
    }
  }
}
