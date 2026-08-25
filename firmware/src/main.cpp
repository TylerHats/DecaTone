#include <Arduino.h>
#include "config.h"
#include "provisioning.h"
#include "rotary_dial.h"
#include "bell_ringer.h"
#include "audio_manager.h"
#include "network_client.h"
#include "ota_updater.h"

// FreeRTOS Task Handle for Real-Time Audio Engine
TaskHandle_t AudioTaskHandle = NULL;

// Audio processing task running on Core 1 for zero jitter
void AudioTask(void *pvParameters) {
  for (;;) {
    Audio.update();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// Callback when user dials a digit on the rotary dial
void onDigitDialed(char digit) {
  Serial.printf("[Main] Rotary Digit Dialed: '%c'\n", digit);
  NetworkClient.sendDialDigit(digit);
}

// Callback when user lifts or replaces the handset
void onHookStateChanged(bool isOffHook) {
  Serial.printf("[Main] Hook Switch Changed: %s\n", isOffHook ? "OFF HOOK" : "ON HOOK");
  NetworkClient.sendHookState(isOffHook);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n==================================================");
  Serial.println(" ☎️  DecaTone ESP32-S3 Firmware Booting");
  Serial.printf(" Version: %s | Free PSRAM: %d KB\n", FIRMWARE_VERSION, ESP.getFreePsram() / 1024);
  Serial.println("==================================================");

  // Initialize Subsystems
  Provisioning.begin();
  Audio.begin();
  BellRinger.begin();
  OtaUpdater.begin();

  // Initialize Rotary Dial & Hook Switch with callbacks
  RotaryDial.begin(onDigitDialed, onHookStateChanged);

  // If already provisioned, connect to WiFi & Switchboard WebSocket
  if (!Provisioning.isSetupActive()) {
    NetworkClient.begin();
  }

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

  Serial.println("[Main] DecaTone ESP32-S3 Setup Complete.");
}

void loop() {
  // Process Captive Portal if in AP mode
  if (Provisioning.isSetupActive()) {
    Provisioning.update();
  } else {
    // Process Network WebSocket & signaling
    NetworkClient.update();
  }

  // Process Rotary Dial debounce & pulse decoder
  RotaryDial.update();

  // Process Bell Ringer 20Hz cadence modulation
  BellRinger.update();

  delay(2);
}
