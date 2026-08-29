#include "rotary_dial.h"

RotaryDialManager RotaryDial;

volatile uint32_t RotaryDialManager::s_pulseCount = 0;
volatile uint32_t RotaryDialManager::s_lastPulseTime = 0;
volatile bool RotaryDialManager::s_offNormalActive = false;
volatile bool RotaryDialManager::s_hookChanged = false;
volatile uint32_t RotaryDialManager::s_lastHookTime = 0;

void IRAM_ATTR RotaryDialManager::handlePulseInterrupt() {
  uint32_t now = millis();
  if (now - s_lastPulseTime > ROTARY_DEBOUNCE_MS) {
    s_pulseCount++;
    s_lastPulseTime = now;
  }
}

void IRAM_ATTR RotaryDialManager::handleHookInterrupt() {
  uint32_t now = millis();
  if (now - s_lastHookTime > 50) { // 50ms hook switch debounce
    s_hookChanged = true;
    s_lastHookTime = now;
  }
}

void RotaryDialManager::begin(OnDigitDialedCallback digitCb, OnHookStateChangedCallback hookCb, OnHookFlashCallback flashCb) {
  m_digitCallback = digitCb;
  m_hookCallback = hookCb;
  m_hookFlashCallback = flashCb;

  pinMode(PIN_HOOK_SWITCH, INPUT_PULLUP);
  pinMode(PIN_DIAL_PULSE, INPUT_PULLUP);
  pinMode(PIN_DIAL_OFF_NORMAL, INPUT_PULLUP);

  // Initial hook state read (Active LOW = Ground = Off Hook)
  m_currentOffHook = (digitalRead(PIN_HOOK_SWITCH) == LOW);
  m_hookPendingHangup = false;

  attachInterrupt(digitalPinToInterrupt(PIN_DIAL_PULSE), handlePulseInterrupt, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_HOOK_SWITCH), handleHookInterrupt, CHANGE);

  Serial.printf("[Rotary] Initialized. Handset State: %s\n", m_currentOffHook ? "OFF HOOK" : "ON HOOK");
}

void RotaryDialManager::update() {
  uint32_t now = millis();

  // 1. Process Hook Switch Transitions & Hook-Flash Detection
  if (s_hookChanged) {
    s_hookChanged = false;
    bool isLow = (digitalRead(PIN_HOOK_SWITCH) == LOW); // LOW = Handset lifted (Off-Hook)

    if (!isLow && m_currentOffHook && !m_hookPendingHangup) {
      // Handset placed down (pressed down) while currently off-hook
      m_hookPendingHangup = true;
      m_hookDownTime = now;
    } else if (isLow && m_hookPendingHangup) {
      // Handset was tapped down and lifted back up within flash window
      uint32_t pressDuration = now - m_hookDownTime;
      m_hookPendingHangup = false;

      if (pressDuration >= HOOK_FLASH_MIN_MS && pressDuration <= HOOK_FLASH_MAX_MS) {
        Serial.printf("[Rotary] ⚡ HOOK FLASH DETECTED (%u ms)! Triggering Call Transfer / Hold.\n", pressDuration);
        if (m_hookFlashCallback) {
          m_hookFlashCallback();
        }
      }
    } else if (isLow && !m_currentOffHook) {
      // Handset lifted from cradle (Off-Hook)
      m_currentOffHook = true;
      m_hookPendingHangup = false;
      Serial.println("[Rotary] Handset State Changed: OFF HOOK");
      if (m_hookCallback) {
        m_hookCallback(true);
      }
    }
  }

  // Check if hook switch has remained down for > HOOK_FLASH_MAX_MS (Genuine Hangup)
  if (m_hookPendingHangup && (now - m_hookDownTime > HOOK_FLASH_MAX_MS)) {
    m_hookPendingHangup = false;
    m_currentOffHook = false;
    Serial.println("[Rotary] Handset State Changed: ON HOOK (Hangup)");
    if (m_hookCallback) {
      m_hookCallback(false);
    }
  }

  // 2. Process Rotary Pulse Decoding
  // If we have counted pulses and no new pulses have arrived for > 250ms (dial has stopped spinning back)
  if (s_pulseCount > 0 && (now - s_lastPulseTime > 250)) {
    uint32_t totalPulses = s_pulseCount;
    s_pulseCount = 0;

    char decodedDigit = '0';
    if (totalPulses >= 1 && totalPulses <= 9) {
      decodedDigit = '0' + totalPulses;
    } else if (totalPulses == 10) {
      decodedDigit = '0';
    } else {
      // Noise filter or invalid count
      Serial.printf("[Rotary Warning] Invalid pulse count: %d\n", totalPulses);
      return;
    }

    Serial.printf("[Rotary] Decoded Digit: '%c' (%d pulses)\n", decodedDigit, totalPulses);
    if (m_digitCallback) {
      m_digitCallback(decodedDigit);
    }
  }
}

bool RotaryDialManager::isOffHook() const {
  return m_currentOffHook;
}
