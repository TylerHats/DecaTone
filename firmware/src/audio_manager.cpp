#include "audio_manager.h"
#include <math.h>

AudioManager Audio;

#define I2S_PORT I2S_NUM_0

void AudioManager::begin() {
  initI2S();
  initADC();
  setSpeakerVolume(80);
  setMicSensitivity(80);
  Serial.println("[Audio] I2S Speaker & ADC Mic Initialized.");
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
}

void AudioManager::setMicSensitivity(uint8_t gainPercent) {
  m_micSensitivity = constrain(gainPercent, 0, 100);
  m_gainMultiplier = ((float)m_micSensitivity / 50.0f); // 0.0 to 2.0x gain
}

void AudioManager::playTone(ToneType tone) {
  m_activeTone = tone;
  m_tonePhase = 0;
  m_lastToneToggleTime = millis();
  m_toneAudioMuted = false;
  Serial.printf("[Audio] Playing Tone Type: %d\n", tone);
}

void AudioManager::stopTone() {
  m_activeTone = TONE_NONE;
  i2s_zero_dma_buffer(I2S_PORT);
  Serial.println("[Audio] Stopped Tone.");
}

ToneType AudioManager::currentTone() const {
  return m_activeTone;
}

void AudioManager::generateToneChunk(int16_t* buffer, size_t samples, float f1, float f2) {
  const float twoPi = 2.0f * 3.14159265358979323846f;
  float dt = 1.0f / (float)AUDIO_SAMPLE_RATE;
  int16_t amplitude = (int16_t)(16000.0f * m_volumeMultiplier);

  for (size_t i = 0; i < samples; i++) {
    float t = (float)(m_tonePhase + i) * dt;
    float s1 = sinf(twoPi * f1 * t);
    float s2 = sinf(twoPi * f2 * t);
    buffer[i] = (int16_t)((s1 + s2) * 0.5f * amplitude);
  }
  m_tonePhase += samples;
}

void AudioManager::update() {
  if (m_activeTone == TONE_NONE) return;

  uint32_t now = millis();
  int16_t toneBuffer[AUDIO_BUFFER_SAMPLES];

  if (m_activeTone == TONE_DIAL) {
    // US Dial Tone: 350Hz + 440Hz continuous
    generateToneChunk(toneBuffer, AUDIO_BUFFER_SAMPLES, 350.0f, 440.0f);
    writeSpeakerSamples(toneBuffer, AUDIO_BUFFER_SAMPLES);
  } else if (m_activeTone == TONE_RINGBACK) {
    // Ringback Tone: 440Hz + 480Hz (2s On, 4s Off)
    uint32_t elapsed = (now - m_lastToneToggleTime) % 6000;
    if (elapsed < 2000) {
      generateToneChunk(toneBuffer, AUDIO_BUFFER_SAMPLES, 440.0f, 480.0f);
      writeSpeakerSamples(toneBuffer, AUDIO_BUFFER_SAMPLES);
    } else {
      memset(toneBuffer, 0, sizeof(toneBuffer));
      writeSpeakerSamples(toneBuffer, AUDIO_BUFFER_SAMPLES);
    }
  } else if (m_activeTone == TONE_BUSY) {
    // Busy Tone: 480Hz + 620Hz (0.5s On, 0.5s Off)
    uint32_t elapsed = (now - m_lastToneToggleTime) % 1000;
    if (elapsed < 500) {
      generateToneChunk(toneBuffer, AUDIO_BUFFER_SAMPLES, 480.0f, 620.0f);
      writeSpeakerSamples(toneBuffer, AUDIO_BUFFER_SAMPLES);
    } else {
      memset(toneBuffer, 0, sizeof(toneBuffer));
      writeSpeakerSamples(toneBuffer, AUDIO_BUFFER_SAMPLES);
    }
  }
}

size_t AudioManager::readMicSamples(int16_t* buffer, size_t numSamples) {
  // Read analog samples from MAX4466 on ADC1
  // Center bias of MAX4466 is ~VCC/2 (approx 2048 in 12-bit ADC)
  for (size_t i = 0; i < numSamples; i++) {
    int raw = analogRead(PIN_MIC_ADC);
    int centered = (raw - 2048) << 4; // Scale 12-bit to 16-bit
    buffer[i] = (int16_t)constrain((float)centered * m_gainMultiplier, -32768.0f, 32767.0f);
  }
  return numSamples;
}

void AudioManager::writeSpeakerSamples(const int16_t* buffer, size_t numSamples) {
  size_t bytesWritten = 0;
  i2s_write(I2S_PORT, buffer, numSamples * sizeof(int16_t), &bytesWritten, portMAX_DELAY);
}
