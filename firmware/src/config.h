#pragma once
#include <Arduino.h>

// =============================================================================
// DecaTone ESP32-S3 Pin Configuration (Hosyond ESP32-S3-WROOM-1)
// =============================================================================

// Hook Switch (Handset cradle switch, active LOW to GND with internal pullup)
#define PIN_HOOK_SWITCH         4   // GPIO 4 (ADC1_3 / RTC)

// Rotary Dial Pulse Switch (Normally closed/open, pulses to GND as dial returns)
#define PIN_DIAL_PULSE          5   // GPIO 5 (ADC1_4 / RTC)

// Rotary Dial Off-Normal / Shunt Switch (Active LOW while dial is in motion)
#define PIN_DIAL_OFF_NORMAL     6   // GPIO 6 (ADC1_5 / RTC)

// Physical Bell Ringer (Drives IRF640N MOSFET gate via 20Hz-25Hz PWM)
#define PIN_BELL_RINGER         7   // GPIO 7 (PWM capable)

// Handset Microphone Input (MAX4466 Analog Electret Mic Out -> ADC1 Channel 0)
#define PIN_MIC_ADC             1   // GPIO 1 (ADC1_CH0)

// Handset Speaker I2S Output (MAX98357A I2S Mono DAC/Amp)
#define PIN_I2S_BCLK            16  // GPIO 16 (Bit Clock)
#define PIN_I2S_LRCK            17  // GPIO 17 (Word Select / Left-Right Clock)
#define PIN_I2S_DOUT            18  // GPIO 18 (Data Out)

// Built-in WS2812 RGB Status LED
#define PIN_STATUS_LED          48  // GPIO 48 (RGB LED)

// Boot / Configuration Button (Hold 5 seconds on startup for AP setup)
#define PIN_BOOT_BUTTON         0   // GPIO 0

// =============================================================================
// Audio & Telephony Tuning Constants
// =============================================================================
#define AUDIO_SAMPLE_RATE       16000   // 16kHz High-Def Telephony Audio
#define AUDIO_BITS_PER_SAMPLE   16
#define AUDIO_BUFFER_SAMPLES    256     // Low-latency 16ms audio frames
#define DEFAULT_BELL_FREQ_HZ    20.0f   // Default Bell AC Resonance (20 Hz)
#define ROTARY_DEBOUNCE_MS      15      // Pulse contact debouncing
#define INTER_DIGIT_TIMEOUT_MS  3000    // Inter-digit timeout before placing call

// Hook-Flash Call Transfer Detection Window
#define HOOK_FLASH_MIN_MS       80      // Minimum duration for valid flash
#define HOOK_FLASH_MAX_MS       500     // Maximum duration before treated as on-hook hangup

// NVS Storage Namespace
#define NVS_NAMESPACE           "decatone"
#define FIRMWARE_VERSION        "1.1.0"

