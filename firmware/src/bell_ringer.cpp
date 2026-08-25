#include "bell_ringer.h"

BellRingerManager BellRinger;

void BellRingerManager::begin() {
  pinMode(PIN_BELL_RINGER, OUTPUT);
  digitalWrite(PIN_BELL_RINGER, LOW);
  m_isRinging = false;
}

void BellRingerManager::parseCadence(const String& style, const String& customCadence) {
  m_totalSteps = 0;

  if (style == "european") {
    m_cadenceSteps[0] = 400;  // Ring 1
    m_cadenceSteps[1] = 200;  // Pause
    m_cadenceSteps[2] = 400;  // Ring 2
    m_cadenceSteps[3] = 2000; // Long pause
    m_totalSteps = 4;
  } else if (style == "pulse") {
    m_cadenceSteps[0] = 200;
    m_cadenceSteps[1] = 200;
    m_cadenceSteps[2] = 200;
    m_cadenceSteps[3] = 200;
    m_cadenceSteps[4] = 200;
    m_cadenceSteps[5] = 2500;
    m_totalSteps = 6;
  } else if (style == "continuous") {
    m_cadenceSteps[0] = 1500;
    m_cadenceSteps[1] = 1500;
    m_totalSteps = 2;
  } else if (style == "custom" && customCadence.length() > 0) {
    int startIdx = 0;
    while (startIdx < customCadence.length() && m_totalSteps < 10) {
      int commaIdx = customCadence.indexOf(',', startIdx);
      if (commaIdx == -1) commaIdx = customCadence.length();
      String token = customCadence.substring(startIdx, commaIdx);
      token.trim();
      if (token.length() > 0) {
        m_cadenceSteps[m_totalSteps++] = (uint16_t)token.toInt();
      }
      startIdx = commaIdx + 1;
    }
  }

  // Fallback Traditional (2000ms Ring / 4000ms Silence)
  if (m_totalSteps == 0) {
    m_cadenceSteps[0] = 2000;
    m_cadenceSteps[1] = 4000;
    m_totalSteps = 2;
  }
}

void BellRingerManager::startRing(const String& style, const String& customCadence) {
  parseCadence(style, customCadence);
  m_isRinging = true;
  m_patternIndex = 0;
  m_bellStateOn = true; // Even index = ON, Odd index = OFF
  m_lastPhaseTime = millis();
  m_lastOscillatorTime = micros();
  m_oscillatorState = false;
  Serial.println("[Bell] Started physical bell ringing sequence.");
}

void BellRingerManager::stopRing() {
  m_isRinging = false;
  m_bellStateOn = false;
  digitalWrite(PIN_BELL_RINGER, LOW);
  Serial.println("[Bell] Stopped bell ringing.");
}

bool BellRingerManager::isRinging() const {
  return m_isRinging;
}

void BellRingerManager::update() {
  if (!m_isRinging) return;

  uint32_t nowMs = millis();
  uint32_t currentPhaseDuration = m_cadenceSteps[m_patternIndex];

  // Check phase transition in cadence pattern
  if (nowMs - m_lastPhaseTime >= currentPhaseDuration) {
    m_patternIndex = (m_patternIndex + 1) % m_totalSteps;
    m_bellStateOn = (m_patternIndex % 2 == 0);
    m_lastPhaseTime = nowMs;

    if (!m_bellStateOn) {
      digitalWrite(PIN_BELL_RINGER, LOW);
    }
  }

  // Generate 20Hz AC resonance switching on IRF640N MOSFET gate during ON phase
  // 20Hz period = 50ms = 25ms HIGH (25000us) / 25ms LOW (25000us)
  if (m_bellStateOn) {
    uint32_t nowUs = micros();
    if (nowUs - m_lastOscillatorTime >= 25000) {
      m_oscillatorState = !m_oscillatorState;
      digitalWrite(PIN_BELL_RINGER, m_oscillatorState ? HIGH : LOW);
      m_lastOscillatorTime = nowUs;
    }
  } else {
    digitalWrite(PIN_BELL_RINGER, LOW);
  }
}
