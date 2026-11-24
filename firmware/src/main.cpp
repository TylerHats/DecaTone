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

// Dynamically scale CPU clock & Wi-Fi power save for cool on-hook standby
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

// Real-time 16kHz paced audio & progress tone synthesis task pinned to Core 1
void AudioTask(void *pvParameters) {
  (void)pvParameters;
  for (;;) {
    Audio.update();

    if (RotaryDial.isOffHook() || Audio.isActive() || NetworkClient.getCallState() != STATE_IDLE) {
      vTaskDelay(pdMS_TO_TICKS(1)); // 1ms tick (~16-32 samples @ 16kHz)
    } else {
      vTaskDelay(pdMS_TO_TICKS(20)); // Low-power idle yield
    }
  }
}

// Callback when user dials a digit on the rotary dial
void onDigitDialed(char digit, float pps, float breakRatio, uint32_t pulseCount) {
  Serial.printf("[Main] Rotary Digit Dialed: '%c' (%.1f PPS, %.0f%% Break, %u Pulses)\n",
    digit, pps, breakRatio, pulseCount);
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
  delay(400);
  Serial.println("\n=============================================");
  Serial.println("   DecaTone ESP32-S3 Rotary Phone System     ");
  Serial.printf ("   Firmware Version: %s                      \n", FIRMWARE_VERSION);
  Serial.println("=============================================");

  // Initialize Provisioning, Persistent P-256 Identity & NVS Storage
  Provisioning.begin();

  // Initialize Hardware Peripherals
  OtaUpdater.begin();
  BellRinger.begin();
  Audio.begin();
  RotaryDial.begin(onDigitDialed, onHookStateChanged, onHookFlash);

  // Initialize Networking & WebSocket (if provisioned)
  NetworkClient.begin();

  // Create dedicated FreeRTOS Audio Task on Core 1
  xTaskCreatePinnedToCore(
    AudioTask,
    "DecaToneAudioTask",
    8192,
    NULL,
    3, // High real-time priority on Core 1
    &AudioTaskHandle,
    1  // Run on Core 1
  );

  // Set initial power profile based on hook switch
  if (!Provisioning.isSetupActive() && !RotaryDial.isOffHook()) {
    setPowerState(false);
  }

  Serial.println("[Main] DecaTone ESP32-S3 Setup Complete.");
}

void loop() {
  // Check runtime 5-second BOOT button hold for Factory Reset
  if (Provisioning.checkRuntimeFactoryResetHold()) {
    setPowerState(true);
    BellRinger.stopRing();
    Audio.stopTone();
    if (!Provisioning.isSetupActive() && NetworkClient.isConnected()) {
      NetworkClient.sendFactoryReset();
    }
    Provisioning.resetConfig();
    return;
  }

  // Process Captive Portal if in AP mode, else Switchboard Network Client
  if (Provisioning.isSetupActive()) {
    Provisioning.update();
  } else {
    NetworkClient.update();

    bool needsHighPower = BellRinger.isRinging() ||
                          RotaryDial.isOffHook() ||
                          Audio.isActive() ||
                          NetworkClient.getCallState() != STATE_IDLE ||
                          OtaUpdater.isUpdating();

    if (needsHighPower) {
      if (!s_isHighPowerMode) setPowerState(true);
    } else {
      if (s_isHighPowerMode) setPowerState(false);
    }
  }

  // Process Rotary Dial 30ms hook debounce & pulse decoder
  RotaryDial.update();

  // Process Complementary H-Bridge AC Bell Ringer cadence
  BellRinger.update();

  delay(2);
}
