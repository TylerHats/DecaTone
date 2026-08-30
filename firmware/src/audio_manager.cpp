#include "audio_manager.h"
#include <math.h>

AudioManager Audio;

#define I2S_PORT I2S_NUM_0

// Reference RMS target for -18 dBFS (in 16-bit signed scale: 32768 * 10^(-18/20) ≈ 4125)
static const float TARGET_RMS_INBOUND = 4125.0f;
static const float TARGET_RMS_MIC = 4500.0f;
static const float NOISE_GATE_THRESHOLD = 300.0f;

void AudioManager::begin() {
  initI2S();
  initADC();
  setSpeakerVolume(80);
  setMicSensitivity(80);
  setSidetoneLevel(10);
  setAudioProfile("vintage_pots");
  m_inboundNormEnabled = true;
  m_outboundAgcEnabled = true;
  m_micDcBaseline = 2048;
  Serial.println("[Audio] I2S DAC & ADC Mic Initialized with Inbound Normalizer & Outbound AGC.");
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

void AudioManager::setInboundNormalizationEnabled(bool enabled) {
  m_inboundNormEnabled = enabled;
  Serial.printf("[Audio DSP] Inbound Normalization: %s\n", enabled ? "ENABLED" : "DISABLED");
}

void AudioManager::setOutboundAgcEnabled(bool enabled) {
  m_outboundAgcEnabled = enabled;
  Serial.printf("[Audio DSP] Outbound Mic AGC: %s\n", enabled ? "ENABLED" : "DISABLED");
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
  m_hp_x1 = m_hp_y1 = 0;
  m_lp_x1 = m_lp_y1 = 0;
}

float AudioManager::processInboundLeveler(float sample) {
  if (!m_inboundNormEnabled) return sample;

  // Track short-term energy using Exponential Moving Average (EMA)
  float absVal = fabsf(sample);
  if (absVal > 200.0f) { // Speech activity region
    // Attack (fast response on louder input) vs Decay (slow recovery on quiet input)
    float alpha = (absVal > m_inboundRmsLevel) ? 0.005f : 0.0005f;
    m_inboundRmsLevel = (1.0f - alpha) * m_inboundRmsLevel + alpha * absVal;

    // Calculate normalization multiplier smoothly bounded between 0.3x and 3.5x
    float targetGain = TARGET_RMS_INBOUND / (m_inboundRmsLevel + 100.0f);
    targetGain = constrain(targetGain, 0.3f, 3.5f);

    // Smooth gain transition
    m_inboundNormGain = 0.995f * m_inboundNormGain + 0.005f * targetGain;
  }

  float leveled = sample * m_inboundNormGain;

  // Soft-knee peak limiting to prevent digital clipping / ear fatigue
  if (leveled > 28000.0f) {
    float over = leveled - 28000.0f;
    leveled = 28000.0f + (over / (1.0f + over / 4000.0f));
  } else if (leveled < -28000.0f) {
    float under = -leveled - 28000.0f;
    leveled = -28000.0f - (under / (1.0f + under / 4000.0f));
  }

  return leveled;
}

int16_t AudioManager::processOutboundAgc(int16_t rawSample) {
  if (!m_outboundAgcEnabled) return rawSample;

  float sample = (float)rawSample;
  float absVal = fabsf(sample);

  // Noise gate: suppress background hiss/hum when silent
  if (absVal < NOISE_GATE_THRESHOLD) {
    return (int16_t)(sample * 0.15f);
  }

  // Track microphone voice energy
  float alpha = (absVal > m_micRmsLevel) ? 0.01f : 0.001f;
  m_micRmsLevel = (1.0f - alpha) * m_micRmsLevel + alpha * absVal;

  float targetGain = TARGET_RMS_MIC / (m_micRmsLevel + 200.0f);
  targetGain = constrain(targetGain, 0.5f, 4.0f);
  m_micAgcGain = 0.99f * m_micAgcGain + 0.01f * targetGain;

  float boosted = sample * m_micAgcGain * m_gainMultiplier;
  return (int16_t)constrain(boosted, -32768.0f, 32767.0f);
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
    return inSample; // Linear wideband
  }

  float x = (float)inSample;

  if (m_activeProfile == PROFILE_VINTAGE_POTS) {
    // 1. High-pass filter ~300Hz at 16kHz
    float hp_out = 0.9449f * m_hp_y1 + 0.9724f * (x - m_hp_x1);
    m_hp_x1 = x;
    m_hp_y1 = hp_out;

    // 2. Low-pass filter ~3400Hz at 16kHz
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

void AudioManager::writeSpeakerSamples(const int16_t* samples, size_t count) {
  if (!samples || count == 0) return;

  int16_t dspBuffer[AUDIO_BUFFER_SAMPLES];
  size_t processed = 0;

  while (processed < count) {
    size_t chunk = (count - processed > AUDIO_BUFFER_SAMPLES) ? AUDIO_BUFFER_SAMPLES : (count - processed);

    for (size_t i = 0; i < chunk; i++) {
      float raw = (float)samples[processed + i];

      // 1. Dynamic Inbound Loudness Normalizer & Limiter
      float normalized = processInboundLeveler(raw);

      // 2. Vintage Acoustic Profile Filter
      int16_t filtered = processDspSample((int16_t)constrain(normalized, -32768.0f, 32767.0f));

      // 3. Apply Master Volume Multiplier
      float finalSample = (float)filtered * m_volumeMultiplier;
      dspBuffer[i] = (int16_t)constrain(finalSample, -32768.0f, 32767.0f);
    }

    size_t bytesWritten = 0;
    i2s_write(I2S_PORT, dspBuffer, chunk * sizeof(int16_t), &bytesWritten, portMAX_DELAY);
    processed += chunk;
  }
}

size_t AudioManager::readMicSamples(int16_t* buffer, size_t maxSamples) {
  if (!buffer || maxSamples == 0) return 0;

  for (size_t i = 0; i < maxSamples; i++) {
    // Read 12-bit ADC (0 to 4095)
    int32_t adcRaw = analogRead(PIN_MIC_ADC);

    // Adaptive DC baseline tracker (slow tracking of average bias)
    m_micDcBaseline = (m_micDcBaseline * 255 + adcRaw) / 256;
    int32_t centered = adcRaw - m_micDcBaseline;

    // Convert 12-bit signed (-2048..2047) to 16-bit (-32768..32767)
    int16_t scaled = (int16_t)constrain(centered * 16, -32768, 32767);

    // Outbound Automatic Gain Control & Noise Gate
    buffer[i] = processOutboundAgc(scaled);
  }

  return maxSamples;
}

void AudioManager::update() {
  // Real-time audio engine update hook called by FreeRTOS task
}
