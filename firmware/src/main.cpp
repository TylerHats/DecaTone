#include <Arduino.h>
#include <esp_wifi.h>
#include <esp_pm.h>
#include "config.h"
#include "provisioning.h"
#include "rotary_dial.h"
#include "bell_ringer.h"
#include "audio_manager.h"
#include "network_client.h"
#include "ota_updater.h"

// FreeRTOS Task Handle for Real-Time Audio Engine
TaskHandle_t AudioTaskHandle = NULL;
static bool s_isHighPowerMode = true;

// Helper to switch CPU frequency dynamically for low power consumption
void setPowerState(bool highPerformance) {
  if (highPerformance == s_isHighPowerMode) return;
  s_isHighPowerMode = highPerformance;

  if (highPerformance) {
    setCpuFrequencyMhz(240);
    esp_wifi_set_ps(WIFI_PS_NONE);
    Serial.println("[Power] ⚡ Scaled CPU to 240MHz & Disabled WiFi Sleep (Active Telephony Mode)");
  } else {
    setCpuFrequencyMhz(80);
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    Serial.println("[Power] 🍃 Scaled CPU to 80MHz & Enabled WiFi Modem Sleep (On-Hook Idle Mode)");
  }
}

// Audio processing task running on Core 1 for zero jitter
void AudioTask(void *pvParameters) {
  for (;;) {
    Audio.update();

    // Adjust yield interval based on active call state
    if (NetworkClient.getCallState() == STATE_IN_CALL) {
      vTaskDelay(pdMS_TO_TICKS(5));
    } else {
      vTaskDelay(pdMS_TO_TICKS(40));
    }
  }
}

// Callback when user dials a digit on the rotary dial
void onDigitDialed(char digit, float pps, float breakRatio, uint32_t pulseCount) {
  Serial.printf("[Main] Rotary Digit Dialed: '%c' (%.1f PPS, %.0f%% Break, %u Pulses)\n", digit, pps, breakRatio, pulseCount);
  NetworkClient.sendDialDigit(digit, pps, breakRatio, pulseCount);
}

// Callback when user lifts or replaces the handset
void onHookStateChanged(bool isOffHook) {
  Serial.printf("[Main] Hook Switch Changed: %s\n", isOffHook ? "OFF HOOK" : "ON HOOK");
  if (isOffHook) {
    setPowerState(true);
  }
  NetworkClient.sendHookState(isOffHook);
}

// Callback when hook-flash is detected
void onHookFlash() {
  Serial.println("[Main] Hook Flash Detected!");
  NetworkClient.sendHookFlash();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=============================================");
  Serial.println("   DecaTone ESP32-S3 Rotary Phone System     ");
  Serial.printf ("   Firmware Version: %s                      \n", FIRMWARE_VERSION);
  Serial.println("=============================================");

  // Initialize Provisioning & NVS Storage
  Provisioning.begin();

  // Initialize Hardware Peripherals
  BellRinger.begin();
  Audio.begin();
  RotaryDial.begin(onDigitDialed, onHookStateChanged, onHookFlash);

  // Initialize Networking & WebSocket
  NetworkClient.begin();

  // Create dedicated FreeRTOS Audio Task on Core 1
  xTaskCreatePinnedToCore(
    AudioTask,
    "DecaToneAudioTask",
    8192,
    NULL,
    2, // Priority 2
    &AudioTaskHandle,
    1  // Run on Core 1
  );

  // Set initial power profile based on hook switch
  if (!RotaryDial.isOffHook()) {
    setPowerState(false);
  }

  Serial.println("[Main] DecaTone ESP32-S3 Setup Complete.");
}

void loop() {
  // Process Captive Portal if in AP mode
  if (Provisioning.isSetupActive()) {
    Provisioning.update();
  } else {
    // Process Network WebSocket & signaling
    NetworkClient.update();

    // Check if ringing requires high performance clock
    if (BellRinger.isRinging() || RotaryDial.isOffHook() || NetworkClient.getCallState() != STATE_IDLE) {
      if (!s_isHighPowerMode) setPowerState(true);
    } else {
      if (s_isHighPowerMode && !OtaUpdater.isUpdating()) setPowerState(false);
    }
  }

  // Process Rotary Dial debounce & pulse decoder
  RotaryDial.update();

  // Process Bell Ringer 20Hz cadence modulation
  BellRinger.update();

  delay(2);
}
