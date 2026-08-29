#include "audio_manager.h"
#include <math.h>

AudioManager Audio;

#define I2S_PORT I2S_NUM_0

void AudioManager::begin() {
  initI2S();
  initADC();
  setSpeakerVolume(80);
  setMicSensitivity(80);
  setSidetoneLevel(10);
  setAudioProfile("vintage_pots");
  Serial.println("[Audio] I2S Speaker & ADC Mic Initialized with DSP Audio Engine.");
}

void AudioManager::initI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = AUDIO_SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = AUDIO_BUFFER_SAMPLES,
    .use_apll = false,
    .tx_desc_auto_clear = true
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = PIN_I2S_BCLK,
    .ws_io_num = PIN_I2S_LRCK,
    .data_out_num = PIN_I2S_DOUT,
    .data_in_num = I2S_PIN_NO_CHANGE
  };

  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
}

void AudioManager::initADC() {
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(PIN_MIC_ADC, INPUT);
}

void AudioManager::setSpeakerVolume(uint8_t volumePercent) {
  m_speakerVolume = constrain(volumePercent, 0, 100);
  m_volumeMultiplier = (float)m_speakerVolume / 100.0f;
  Serial.printf("[Audio DSP] Speaker Volume: %d%%\n", m_speakerVolume);
}

void AudioManager::setMicSensitivity(uint8_t gainPercent) {
  m_micSensitivity = constrain(gainPercent, 0, 100);
  m_gainMultiplier = ((float)m_micSensitivity / 50.0f); // 0.0 to 2.0x digital gain scaling
  Serial.printf("[Audio DSP] Mic Sensitivity: %d%%\n", m_micSensitivity);
}

void AudioManager::setSidetoneLevel(uint8_t sidetonePercent) {
  m_sidetoneLevel = constrain(sidetonePercent, 0, 30);
  m_sidetoneMultiplier = (float)m_sidetoneLevel / 100.0f;
  Serial.printf("[Audio DSP] Sidetone Level: %d%%\n", m_sidetoneLevel);
}

void AudioManager::setAudioProfile(const String& profileName) {
  if (profileName == "modern_hd") {
    m_activeProfile = PROFILE_MODERN_HD;
    Serial.println("[Audio DSP] Profile: Modern HD (16kHz Wideband Linear)");
  } else if (profileName == "early_1930s" || profileName == "1930s") {
    m_activeProfile = PROFILE_1930S_ANTIQUE;
    Serial.println("[Audio DSP] Profile: 1930s Early Bell (400Hz-2.5kHz Lo-Fi)");
  } else {
    m_activeProfile = PROFILE_VINTAGE_POTS;
    Serial.println("[Audio DSP] Profile: Vintage POTS (300Hz-3.4kHz Carbon Mic)");
  }

  // Reset filter state buffers
  m_hp_x1 = m_hp_x2 = m_hp_y1 = m_hp_y2 = 0;
  m_lp_x1 = m_lp_x2 = m_lp_y1 = m_lp_y2 = 0;
}

int16_t AudioManager::applyVintageWarmth(int16_t sample, float drive) {
  // Normalized soft-saturation polynomial: f(x) = x - (x^3)/3
  float x = (float)sample / 32768.0f * drive;
  if (x > 1.2f) x = 1.2f;
  if (x < -1.2f) x = -1.2f;
  float y = x - (x * x * x) * 0.333f;
  return (int16_t)constrain(y * 32767.0f, -32768.0f, 32767.0f);
}

int16_t AudioManager::processDspSample(int16_t inSample) {
  if (m_activeProfile == PROFILE_MODERN_HD) {
    return inSample; // Unfiltered wideband audio
  }

  float x = (float)inSample;

  if (m_activeProfile == PROFILE_VINTAGE_POTS) {
    // 1. High-pass filter ~300Hz at 16kHz sample rate
    // y[n] = 0.9449*y[n-1] + 0.9724*(x[n] - x[n-1])
    float hp_out = 0.9449f * m_hp_y1 + 0.9724f * (x - m_hp_x1);
    m_hp_x1 = x;
    m_hp_y1 = hp_out;

    // 2. Low-pass filter ~3400Hz at 16kHz sample rate
    // y[n] = 0.435*y[n-1] + 0.565*x[n]
    float lp_out = 0.435f * m_lp_y1 + 0.565f * hp_out;
    m_lp_y1 = lp_out;

    // 3. Mild Carbon Mic Harmonic Saturation
    return applyVintageWarmth((int16_t)constrain(lp_out, -32768.0f, 32767.0f), 1.15f);
  } else if (m_activeProfile == PROFILE_1930S_ANTIQUE) {
    // 1. High-pass filter ~450Hz
    float hp_out = 0.918f * m_hp_y1 + 0.959f * (x - m_hp_x1);
    m_hp_x1 = x;
    m_hp_y1 = hp_out;

    // 2. Low-pass filter ~2500Hz
    float lp_out = 0.55f * m_lp_y1 + 0.45f * hp_out;
    m_lp_y1 = lp_out;

    // 3. Antique Non-linear Carbon Granule Compression
    return applyVintageWarmth((int16_t)constrain(lp_out, -32768.0f, 32767.0f), 1.55f);
  }

  return inSample;
}

