#include "rotary_dial.h"

RotaryDialManager RotaryDial;

volatile uint32_t RotaryDialManager::s_pulseCount = 0;
volatile uint32_t RotaryDialManager::s_firstPulseTime = 0;
volatile uint32_t RotaryDialManager::s_lastPulseTime = 0;
volatile uint32_t RotaryDialManager::s_totalBreakDurationMs = 0;
volatile uint32_t RotaryDialManager::s_pulseBreakStart = 0;
volatile bool RotaryDialManager::s_offNormalActive = false;
volatile bool RotaryDialManager::s_hookChanged = false;
volatile uint32_t RotaryDialManager::s_lastHookTime = 0;

void IRAM_ATTR RotaryDialManager::handlePulseInterrupt() {
  uint32_t now = millis();
  int pinVal = digitalRead(PIN_DIAL_PULSE);

  if (pinVal == HIGH) {
    // Pulse Break Begins (Contact opens)
    if (now - s_lastPulseTime > ROTARY_DEBOUNCE_MS) {
      s_pulseBreakStart = now;
      if (s_pulseCount == 0) {
        s_firstPulseTime = now;
        s_totalBreakDurationMs = 0;
      }
      s_pulseCount++;
      s_lastPulseTime = now;
    }
  } else {
    // Pulse Make (Contact closes)
    if (s_pulseBreakStart > 0) {
      s_totalBreakDurationMs += (now - s_pulseBreakStart);
      s_pulseBreakStart = 0;
    }
  }
}

void IRAM_ATTR RotaryDialManager::handleOffNormalInterrupt() {
  s_offNormalActive = (digitalRead(PIN_DIAL_OFF_NORMAL) == LOW);
}

void IRAM_ATTR RotaryDialManager::handleHookInterrupt() {
  uint32_t now = millis();
  if (now - s_lastHookTime > 50) { // 50ms hook switch debounce
    s_hookChanged = true;
    s_lastHookTime = now;
  }
}

void RotaryDialManager::begin(DigitDialedCallback digitCb, HookStateCallback hookCb, HookFlashCallback flashCb) {
  m_digitCallback = digitCb;
  m_hookCallback = hookCb;
  m_flashCallback = flashCb;

  pinMode(PIN_HOOK_SWITCH, INPUT_PULLUP);
  pinMode(PIN_DIAL_PULSE, INPUT_PULLUP);
  pinMode(PIN_DIAL_OFF_NORMAL, INPUT_PULLUP);

  m_currentOffHook = (digitalRead(PIN_HOOK_SWITCH) == LOW);

  attachInterrupt(digitalPinToInterrupt(PIN_DIAL_PULSE), handlePulseInterrupt, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_HOOK_SWITCH), handleHookInterrupt, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_DIAL_OFF_NORMAL), handleOffNormalInterrupt, CHANGE);

  Serial.printf("[Rotary Dial] Initialized. Initial Hook State: %s\n", m_currentOffHook ? "OFF HOOK" : "ON HOOK");
}

bool RotaryDialManager::isOffHook() const {
  return m_currentOffHook;
}

void RotaryDialManager::update() {
  uint32_t now = millis();

  // 1. Process Hook Switch State & Hook-Flash Detection
  if (s_hookChanged) {
    s_hookChanged = false;
    bool reading = (digitalRead(PIN_HOOK_SWITCH) == LOW);

    if (reading != m_currentOffHook) {
      if (m_currentOffHook && !reading) {
        // Handset just tapped down (potential hook-flash or on-hook hangup)
        m_hookDownStartTime = now;
        m_evaluatingHookFlash = true;
      } else if (!m_currentOffHook && reading) {
        // Handset lifted back up
        if (m_evaluatingHookFlash) {
          uint32_t duration = now - m_hookDownStartTime;
          if (duration >= HOOK_FLASH_MIN_MS && duration <= HOOK_FLASH_MAX_MS) {
            Serial.printf("[Rotary Dial] ⚡ Hook-Flash Detected! (%d ms)\n", duration);
            if (m_flashCallback) m_flashCallback();
            m_evaluatingHookFlash = false;
            return;
          }
          m_evaluatingHookFlash = false;
        }

        m_currentOffHook = true;
        if (m_hookCallback) m_hookCallback(true);
      }
    }
  }

  // Check if hook down timed out beyond flash duration -> confirmed hangup
  if (m_evaluatingHookFlash && (now - m_hookDownStartTime > HOOK_FLASH_MAX_MS)) {
    m_evaluatingHookFlash = false;
    m_currentOffHook = false;
    if (m_hookCallback) m_hookCallback(false);
  }

  // 2. Process Completed Dial Digit & Telemetry Calculation
  if (s_pulseCount > 0 && (now - s_lastPulseTime > 250)) { // 250ms inter-digit pause
    uint32_t pulses = s_pulseCount;
    uint32_t totalDurationMs = s_lastPulseTime > s_firstPulseTime ? (s_lastPulseTime - s_firstPulseTime) : 100;
    
    // Calculate Pulses Per Second (PPS)
    float pps = 10.0f;
    if (pulses > 1 && totalDurationMs > 0) {
      pps = ((float)(pulses - 1) / (float)totalDurationMs) * 1000.0f;
    }

    // Calculate Break Ratio % (Standard vintage Bell System is 60% break / 40% make)
    float breakRatio = 60.0f;
    if (totalDurationMs > 0 && s_totalBreakDurationMs > 0) {
      breakRatio = ((float)s_totalBreakDurationMs / (float)totalDurationMs) * 100.0f;
      if (breakRatio > 95.0f) breakRatio = 60.0f; // Bound sanity
    }

    // Decode Pulses (10 pulses = '0', 1-9 = '1'-'9')
    char digit = '0';
    if (pulses >= 1 && pulses <= 9) {
      digit = '0' + pulses;
    } else if (pulses == 10) {
      digit = '0';
    }

    Serial.printf("[Rotary Dial] 🔢 Digit '%c' decoded (%d pulses, %.1f PPS, %.0f%% Break Ratio)\n",
      digit, pulses, pps, breakRatio);

    // Reset Pulse Counters
    s_pulseCount = 0;
    s_firstPulseTime = 0;
    s_lastPulseTime = 0;
    s_totalBreakDurationMs = 0;

    if (m_digitCallback) {
      m_digitCallback(digit, pps, breakRatio, pulses);
    }
  }
}
