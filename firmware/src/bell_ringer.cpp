#include "bell_ringer.h"
#include "provisioning.h"

BellRingerManager BellRinger;

void BellRingerManager::setBridgeIdle() {
  digitalWrite(PIN_BELL_RINGER, LOW);
  digitalWrite(PIN_BELL_RINGER_IN2, LOW);
}

void BellRingerManager::begin() {
  pinMode(PIN_BELL_RINGER, OUTPUT);
  pinMode(PIN_BELL_RINGER_IN2, OUTPUT);
  setBridgeIdle();
  m_isRinging = false;
  m_continuousMode = false;
  setRingFrequency(Provisioning.getConfig().bellFrequencyHz);
}

void BellRingerManager::parseCadence(const String& style, const String& customCadence) {
  m_totalSteps = 0;

  if (style == "european") {
    m_cadenceSteps[0] = 400;  // Ring 1
    m_cadenceSteps[1] = 200;  // Pause
    m_cadenceSteps[2] = 400;  // Ring 2
    m_cadenceSteps[3] = 2000; // Long pause
    m_totalSteps = 4;
  } else if (style == "double_ring") {
    m_cadenceSteps[0] = 800;
    m_cadenceSteps[1] = 400;
    m_cadenceSteps[2] = 800;
    m_cadenceSteps[3] = 4000;
    m_totalSteps = 4;
  } else if (style == "short_short_long") {
    m_cadenceSteps[0] = 400;
    m_cadenceSteps[1] = 200;
    m_cadenceSteps[2] = 400;
    m_cadenceSteps[3] = 200;
    m_cadenceSteps[4] = 1200;
    m_cadenceSteps[5] = 3600;
    m_totalSteps = 6;
  } else if (style == "pulse") {
    m_cadenceSteps[0] = 200;
    m_cadenceSteps[1] = 200;
    m_cadenceSteps[2] = 200;
    m_cadenceSteps[3] = 200;
    m_cadenceSteps[4] = 200;
    m_cadenceSteps[5] = 2500;
    m_totalSteps = 6;
  } else if (style == "rapid") {
    m_cadenceSteps[0] = 300;
    m_cadenceSteps[1] = 300;
    m_totalSteps = 2;
  } else if (style == "continuous") {
    m_cadenceSteps[0] = 2000;
    m_cadenceSteps[1] = 0;
    m_totalSteps = 2;
  } else if ((style == "custom" || customCadence.indexOf(',') != -1) && customCadence.length() > 0 && style != "traditional") {
    int startIdx = 0;
    int len = (int)customCadence.length();
    while (startIdx < len && m_totalSteps < 10) {
      int commaIdx = customCadence.indexOf(',', startIdx);
      if (commaIdx == -1) commaIdx = len;
      String token = customCadence.substring(startIdx, commaIdx);
      token.trim();
      if (token.length() > 0) {
        bool validDigits = true;
        for (size_t i = 0; i < token.length(); i++) {
          if (token.charAt(i) < '0' || token.charAt(i) > '9') {
            validDigits = false;
            break;
          }
        }
        if (validDigits) {
          long val = token.toInt();
          if (val >= 50 && val <= 15000) {
            m_cadenceSteps[m_totalSteps++] = (uint16_t)val;
          }
        }
      }
      startIdx = commaIdx + 1;
    }

    // Ensure an even number of steps so ON never wraps directly into ON without silence
    if (m_totalSteps > 0 && (m_totalSteps % 2) == 1) {
      m_cadenceSteps[m_totalSteps++] = 2000;
    }
  }

  // Fallback Traditional US (2000ms Ring / 4000ms Silence)
  if (m_totalSteps == 0) {
    m_cadenceSteps[0] = 2000;
    m_cadenceSteps[1] = 4000;
    m_totalSteps = 2;
  }
}

void BellRingerManager::startRing(const String& style, const String& customCadence) {
  parseCadence(style, customCadence);
  m_continuousMode = (style == "continuous");
  m_isRinging = true;
  m_patternIndex = 0;
  m_bellStateOn = true; // Even index = ON, Odd index = OFF
  m_lastPhaseTime = millis();
  m_lastOscillatorTime = micros();
  m_oscillatorState = false;
  Serial.println("[Bell] Started H-bridge physical bell ringing sequence.");
}

void BellRingerManager::startContinuousCalibration(float freqHz) {
  setRingFrequency(freqHz);
  m_continuousMode = true;
  m_isRinging = true;
  m_bellStateOn = true;
  m_lastOscillatorTime = micros();
  m_oscillatorState = false;
}

void BellRingerManager::stopRing() {
  m_isRinging = false;
  m_continuousMode = false;
  m_bellStateOn = false;
  setBridgeIdle();
  Serial.println("[Bell] Stopped bell ringing (H-bridge IN1/IN2 LOW).");
}

void BellRingerManager::setRingFrequency(float freqHz) {
  if (freqHz >= 10.0f && freqHz <= 60.0f) {
    m_frequencyHz = freqHz;
    m_halfPeriodUs = (uint32_t)(1000000.0f / (freqHz * 2.0f));
    Serial.printf("[Bell] Bell AC H-bridge frequency set to %.1f Hz (half-period: %u us)\n", m_frequencyHz, m_halfPeriodUs);
  }
}

void BellRingerManager::update() {
  if (!m_isRinging) return;

  if (!m_continuousMode) {
    uint32_t nowMs = millis();
    uint32_t currentPhaseDuration = m_cadenceSteps[m_patternIndex];

    // Wrap-safe cadence phase check
    if ((uint32_t)(nowMs - m_lastPhaseTime) >= currentPhaseDuration) {
      m_patternIndex = (m_patternIndex + 1) % m_totalSteps;
      m_bellStateOn = ((m_patternIndex % 2) == 0);
      m_lastPhaseTime = nowMs;

      if (!m_bellStateOn) {
        setBridgeIdle();
      } else {
        m_lastOscillatorTime = micros();
      }
    }
  }

  // Generate complementary H-bridge AC polarity reversals during ON phase
  if (m_bellStateOn) {
    uint32_t nowUs = micros();
    uint32_t elapsedUs = (uint32_t)(nowUs - m_lastOscillatorTime);
    if (elapsedUs >= m_halfPeriodUs) {
      m_oscillatorState = !m_oscillatorState;
      if (elapsedUs >= m_halfPeriodUs * 2U) {
        m_lastOscillatorTime = nowUs;
      } else {
        m_lastOscillatorTime += m_halfPeriodUs;
      }

      // Break-before-make pin ordering to prevent bridge shoot-through
      if (m_oscillatorState) {
        digitalWrite(PIN_BELL_RINGER_IN2, LOW);
        digitalWrite(PIN_BELL_RINGER, HIGH);
      } else {
        digitalWrite(PIN_BELL_RINGER, LOW);
        digitalWrite(PIN_BELL_RINGER_IN2, HIGH);
      }
    }
  } else {
    setBridgeIdle();
  }
}
