#include "audio_manager.h"
#include "rotary_dial.h"
#include "bell_ringer.h"
#include <esp_timer.h>
#include <math.h>
#include <string.h>

AudioManager Audio;

#define I2S_PORT I2S_NUM_0

static constexpr float TWO_PI_F = 6.28318530718f;
static constexpr float INV_SAMPLE_RATE = 1.0f / (float)AUDIO_SAMPLE_RATE;

// Reference RMS target for -18 dBFS (in 16-bit signed scale: 32768 * 10^(-18/20) ≈ 4125)
static constexpr float TARGET_RMS_INBOUND = 4125.0f;
static constexpr float TARGET_RMS_MIC = 4500.0f;
static constexpr float NOISE_GATE_THRESHOLD = 300.0f;

static inline float stepOscillator(float& phase, float freqHz) {
  float val = sinf(phase);
  phase += TWO_PI_F * freqHz * INV_SAMPLE_RATE;
  if (phase >= TWO_PI_F) phase -= TWO_PI_F;
  return val;
}

void AudioManager::begin() {
  for (size_t s = 0; s < MAX_MIX_SLOTS; s++) {
    memset(m_rxSlots[s].buf, 0, sizeof(m_rxSlots[s].buf));
    m_rxSlots[s].writeIdx.store(0, std::memory_order_relaxed);
    m_rxSlots[s].readIdx.store(0, std::memory_order_relaxed);
    m_rxSlots[s].rmsLevel = 4000.0f;
    m_rxSlots[s].normGain = 1.0f;
  }
  memset(m_txRingBuf, 0, sizeof(m_txRingBuf));
  memset(m_adcPcmRing, 0, sizeof(m_adcPcmRing));
  m_adcPcmWriteIdx = 0;
  m_adcPcmReadIdx = 0;
  m_adcHasOddSample = false;
  m_adcOddSample = 0;
  m_lastAdcSample = 0;

  initI2S();
  initADC();
  setSpeakerVolume(80);
  setMicSensitivity(80);
  setSidetoneLevel(10);
  setAudioProfile("vintage_pots");
  m_inboundNormEnabled.store(true, std::memory_order_relaxed);
  m_outboundAgcEnabled.store(true, std::memory_order_relaxed);
  m_micDcBaseline = 2048;
  m_lastUpdateUs = esp_timer_get_time();
  m_halfUsAccum = 0;
  Serial.println("[Audio] 16kHz Real-Time SPSC Multi-Slot Mixer, DMA ADC & Bell Tone Synth Initialized.");
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
  m_adcChannel = (PIN_MIC_ADC >= 1 && PIN_MIC_ADC <= 10) ? static_cast<uint8_t>(PIN_MIC_ADC - 1) : 0;

  adc_digi_init_config_t initCfg = {};
  initCfg.max_store_buf_size = 4096;
  initCfg.conv_num_each_intr = 512;
  initCfg.adc1_chan_mask = (1U << m_adcChannel);
  initCfg.adc2_chan_mask = 0;

  if (adc_digi_initialize(&initCfg) == ESP_OK) {
    adc_digi_pattern_config_t pattern = {};
    pattern.atten = ADC_ATTEN_DB_11;
    pattern.channel = m_adcChannel & 0x7;
    pattern.unit = 0;
    pattern.bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;

    adc_digi_configuration_t digCfg = {};
    digCfg.conv_limit_en = false;
    digCfg.conv_limit_num = 250;
    // ESP32-S3 SOC_ADC_SAMPLE_FREQ_THRES_LOW is 20kHz; sample at 32kHz and 2:1 boxcar decimate to 16kHz.
    digCfg.sample_freq_hz = 32000;
    digCfg.conv_mode = ADC_CONV_SINGLE_UNIT_1;
    digCfg.format = ADC_DIGI_OUTPUT_FORMAT_TYPE2;
    digCfg.pattern_num = 1;
    digCfg.adc_pattern = &pattern;

    if (adc_digi_controller_configure(&digCfg) == ESP_OK && adc_digi_start() == ESP_OK) {
      m_adcDmaReady = true;
      Serial.printf("[Audio ADC] Continuous DMA active at 32kHz -> 16kHz decimated (ADC1_CH%u, GPIO%d).\n",
        m_adcChannel, PIN_MIC_ADC);
      return;
    }
    adc_digi_deinitialize();
  }

  m_adcDmaReady = false;
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(PIN_MIC_ADC, INPUT);
  Serial.println("[Audio ADC] ⚠️ DMA init failed; using polling analogRead fallback.");
}

void AudioManager::pumpAdcDma() {
  if (!m_adcDmaReady) return;

  uint8_t dmaBuf[512];
  uint32_t bytesRead = 0;
  for (int iter = 0; iter < 8; iter++) {
    bytesRead = 0;
    esp_err_t err = adc_digi_read_bytes(dmaBuf, sizeof(dmaBuf), &bytesRead, 0);
    if ((err != ESP_OK && err != ESP_ERR_INVALID_STATE) || bytesRead == 0) {
      break;
    }

    for (uint32_t offset = 0; offset + SOC_ADC_DIGI_RESULT_BYTES <= bytesRead; offset += SOC_ADC_DIGI_RESULT_BYTES) {
      const adc_digi_output_data_t* d = reinterpret_cast<const adc_digi_output_data_t*>(dmaBuf + offset);
      if (d->type2.unit != 0 || d->type2.channel != (m_adcChannel & 0x7)) continue;

      int32_t raw = static_cast<int32_t>(d->type2.data & 0x0FFF);
      if (!m_adcHasOddSample) {
        m_adcOddSample = raw;
        m_adcHasOddSample = true;
      } else {
        int32_t decimated = (m_adcOddSample + raw) >> 1;
        m_adcHasOddSample = false;

        m_micDcBaseline = (m_micDcBaseline * 255 + decimated) / 256;
        int32_t centered = decimated - m_micDcBaseline;
        int16_t pcm16 = static_cast<int16_t>(constrain(centered * 16, -32768, 32767));

        m_adcPcmRing[m_adcPcmWriteIdx & (ADC_PCM_RING_SIZE - 1)] = pcm16;
        m_adcPcmWriteIdx++;
        if ((uint32_t)(m_adcPcmWriteIdx - m_adcPcmReadIdx) > ADC_PCM_RING_SIZE) {
          m_adcPcmReadIdx = m_adcPcmWriteIdx - 512;
        }
      }
    }

    if (bytesRead < sizeof(dmaBuf)) break;
  }
}

void AudioManager::setSpeakerVolume(uint8_t volumePercent) {
  m_speakerVolume = constrain(volumePercent, 0, 100);
  m_volumeMultiplier.store((float)m_speakerVolume / 100.0f, std::memory_order_relaxed);
  Serial.printf("[Audio DSP] Speaker Volume: %u%%\n", m_speakerVolume);
}

void AudioManager::setMicSensitivity(uint8_t gainPercent) {
  m_micSensitivity = constrain(gainPercent, 0, 100);
  m_gainMultiplier.store((float)m_micSensitivity / 50.0f, std::memory_order_relaxed); // 0.0 to 2.0x scaling
  Serial.printf("[Audio DSP] Mic Sensitivity: %u%%\n", m_micSensitivity);
}

void AudioManager::setSidetoneLevel(uint8_t sidetonePercent) {
  m_sidetoneLevel = constrain(sidetonePercent, 0, 30);
  m_sidetoneMultiplier.store((float)m_sidetoneLevel / 100.0f, std::memory_order_relaxed);
  Serial.printf("[Audio DSP] Sidetone Level: %u%%\n", m_sidetoneLevel);
}

void AudioManager::setInboundNormalizationEnabled(bool enabled) {
  m_inboundNormEnabled.store(enabled, std::memory_order_relaxed);
  Serial.printf("[Audio DSP] Inbound Normalization: %s\n", enabled ? "ENABLED" : "DISABLED");
}

void AudioManager::setOutboundAgcEnabled(bool enabled) {
  m_outboundAgcEnabled.store(enabled, std::memory_order_relaxed);
  Serial.printf("[Audio DSP] Outbound Mic AGC: %s\n", enabled ? "ENABLED" : "DISABLED");
}

void AudioManager::setAudioProfile(const String& profileName) {
  if (profileName == "modern_hd") {
    m_activeProfile.store(PROFILE_MODERN_HD, std::memory_order_relaxed);
    Serial.println("[Audio DSP] Profile: Modern HD (16kHz Wideband Linear)");
  } else if (profileName == "early_1930s" || profileName == "1930s") {
    m_activeProfile.store(PROFILE_1930S_ANTIQUE, std::memory_order_relaxed);
    Serial.println("[Audio DSP] Profile: 1930s Early Bell (400Hz-2.5kHz Lo-Fi)");
  } else {
    m_activeProfile.store(PROFILE_VINTAGE_POTS, std::memory_order_relaxed);
    Serial.println("[Audio DSP] Profile: Vintage POTS (300Hz-3.4kHz Carbon Mic)");
  }
  m_resetFilterState.store(true, std::memory_order_relaxed);
}

size_t AudioManager::getAvailableSpeakerSamples() const {
  size_t maxAvail = 0;
  for (size_t s = 0; s < MAX_MIX_SLOTS; s++) {
    uint32_t w = m_rxSlots[s].writeIdx.load(std::memory_order_acquire);
    uint32_t r = m_rxSlots[s].readIdx.load(std::memory_order_acquire);
    size_t used = (size_t)(w - r);
    if (used > maxAvail) maxAvail = used;
  }
  return maxAvail;
}

size_t AudioManager::getSpeakerFreeSamples() const {
  uint32_t w = m_rxSlots[0].writeIdx.load(std::memory_order_acquire);
  uint32_t r = m_rxSlots[0].readIdx.load(std::memory_order_acquire);
  size_t used = (size_t)(w - r);
  return (used < RX_RING_SIZE) ? (RX_RING_SIZE - used) : 0;
}

void AudioManager::clearSpeakerBuffer() {
  for (size_t s = 0; s < MAX_MIX_SLOTS; s++) {
    uint32_t w = m_rxSlots[s].writeIdx.load(std::memory_order_acquire);
    m_rxSlots[s].readIdx.store(w, std::memory_order_release);
  }
}

void AudioManager::pushInboundSlotAudio(uint8_t slot, const int16_t* samples, size_t count) {
  if (!samples || count == 0) return;

  RxMixSlot& mixSlot = m_rxSlots[slot % MAX_MIX_SLOTS];
  uint32_t w = mixSlot.writeIdx.load(std::memory_order_relaxed);
  uint32_t r = mixSlot.readIdx.load(std::memory_order_acquire);
  uint32_t freeSpace = RX_RING_SIZE - (w - r);
  size_t toWrite = (count <= freeSpace) ? count : freeSpace;

  for (size_t i = 0; i < toWrite; i++) {
    mixSlot.buf[(w + i) & (RX_RING_SIZE - 1)] = samples[i];
  }
  mixSlot.writeIdx.store(w + (uint32_t)toWrite, std::memory_order_release);
}

void AudioManager::writeSpeakerSamples(const int16_t* samples, size_t count) {
  pushInboundSlotAudio(0, samples, count);
}

size_t AudioManager::getAvailableMicSamples() const {
  uint32_t w = m_txWriteIdx.load(std::memory_order_acquire);
  uint32_t r = m_txReadIdx.load(std::memory_order_acquire);
  return (size_t)(w - r);
}

void AudioManager::clearMicBuffer() {
  uint32_t w = m_txWriteIdx.load(std::memory_order_acquire);
  m_txReadIdx.store(w, std::memory_order_release);
}

void AudioManager::setMicStreamActive(bool active) {
  if (active) {
    clearMicBuffer();
  }
  m_micStreamActive.store(active, std::memory_order_release);
}

size_t AudioManager::readMicSamples(int16_t* buffer, size_t maxSamples) {
  if (!buffer || maxSamples == 0) return 0;

  uint32_t w = m_txWriteIdx.load(std::memory_order_acquire);
  uint32_t r = m_txReadIdx.load(std::memory_order_relaxed);
  uint32_t avail = w - r;
  size_t toRead = (maxSamples <= avail) ? maxSamples : avail;

  for (size_t i = 0; i < toRead; i++) {
    buffer[i] = m_txRingBuf[(r + i) & (TX_RING_SIZE - 1)];
  }
  m_txReadIdx.store(r + (uint32_t)toRead, std::memory_order_release);
  return toRead;
}

void AudioManager::playTone(const String& toneName) {
  LocalToneType nextTone = TONE_NONE;
  if (toneName == "dial") nextTone = TONE_DIAL;
  else if (toneName == "stutter_dial") nextTone = TONE_STUTTER_DIAL;
  else if (toneName == "dnd_dial") nextTone = TONE_DND_DIAL;
  else if (toneName == "stutter_dnd") nextTone = TONE_STUTTER_DND;
  else if (toneName == "ringback") nextTone = TONE_RINGBACK;
  else if (toneName == "busy") nextTone = TONE_BUSY;
  else if (toneName == "reorder") nextTone = TONE_REORDER;
  else if (toneName == "call_waiting") nextTone = TONE_CALL_WAITING;
  else if (toneName == "beep") nextTone = TONE_BEEP;
  else if (toneName == "chirp") nextTone = TONE_CHIRP;
  else if (toneName == "whisper_dial") nextTone = TONE_WHISPER_DIAL;
  else if (toneName == "howler") nextTone = TONE_HOWLER;
  else if (toneName == "none" || toneName.length() == 0) {
    stopTone();
    return;
  } else {
    Serial.printf("[Audio Tone] Unknown tone '%s'; ignoring.\n", toneName.c_str());
    return;
  }

  portENTER_CRITICAL(&m_toneMux);
  m_toneType = nextTone;
  m_toneSamplePos = 0;
  m_phase1 = 0.0f;
  m_phase2 = 0.0f;
  m_phase3 = 0.0f;
  m_phase4 = 0.0f;
  m_modPhase = 0.0f;
  portEXIT_CRITICAL(&m_toneMux);

  Serial.printf("[Audio Tone] Playing local progress tone: '%s'\n", toneName.c_str());
}

void AudioManager::stopTone() {
  portENTER_CRITICAL(&m_toneMux);
  m_toneType = TONE_NONE;
  m_toneSamplePos = 0;
  portEXIT_CRITICAL(&m_toneMux);
}

bool AudioManager::isTonePlaying() const {
  portENTER_CRITICAL(&m_toneMux);
  bool active = (m_toneType != TONE_NONE);
  portEXIT_CRITICAL(&m_toneMux);
  return active;
}

bool AudioManager::isActive() const {
  return m_micStreamActive.load(std::memory_order_relaxed) ||
         m_calActive.load(std::memory_order_relaxed) ||
         isTonePlaying() ||
         (getAvailableSpeakerSamples() > 0);
}

void AudioManager::startMicRmsWindow() {
  portENTER_CRITICAL(&m_calMux);
  m_calSumSq = 0;
  m_calSampleCount = 0;
  portEXIT_CRITICAL(&m_calMux);
  m_calActive.store(true, std::memory_order_release);
}

float AudioManager::finishMicRmsWindow() {
  m_calActive.store(false, std::memory_order_release);
  uint64_t sumSq = 0;
  uint32_t count = 0;
  portENTER_CRITICAL(&m_calMux);
  sumSq = m_calSumSq;
  count = m_calSampleCount;
  portEXIT_CRITICAL(&m_calMux);

  if (count == 0) return 0.0f;
  return sqrtf((float)((double)sumSq / (double)count));
}

float AudioManager::measureMicRms(uint32_t durationMs) {
  if (durationMs < 20) durationMs = 20;
  if (durationMs > 5000) durationMs = 5000;
  startMicRmsWindow();
  uint32_t startMs = millis();
  while ((uint32_t)(millis() - startMs) < durationMs) {
    BellRinger.update();
    vTaskDelay(pdMS_TO_TICKS(1));
  }
  return finishMicRmsWindow();
}

float AudioManager::processInboundLeveler(RxMixSlot& slot, float sample) {
  if (!m_inboundNormEnabled.load(std::memory_order_relaxed)) return sample;

  float absVal = fabsf(sample);
  if (absVal > 200.0f) {
    float alpha = (absVal > slot.rmsLevel) ? 0.005f : 0.0005f;
    slot.rmsLevel = (1.0f - alpha) * slot.rmsLevel + alpha * absVal;

    float targetGain = TARGET_RMS_INBOUND / (slot.rmsLevel + 100.0f);
    targetGain = constrain(targetGain, 0.3f, 3.5f);
    slot.normGain = 0.995f * slot.normGain + 0.005f * targetGain;
  }

  float leveled = sample * slot.normGain;

  // Soft-knee peak limiting
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
  float gainMult = m_gainMultiplier.load(std::memory_order_relaxed);
  float sample = (float)rawSample;

  // Always honor user mic sensitivity multiplier even when AGC is disabled
  if (!m_outboundAgcEnabled.load(std::memory_order_relaxed)) {
    float manualScaled = sample * gainMult;
    return (int16_t)constrain(manualScaled, -32768.0f, 32767.0f);
  }

  float absVal = fabsf(sample);
  if (absVal < NOISE_GATE_THRESHOLD) {
    float gated = sample * 0.15f * gainMult;
    return (int16_t)constrain(gated, -32768.0f, 32767.0f);
  }

  float alpha = (absVal > m_micRmsLevel) ? 0.01f : 0.001f;
  m_micRmsLevel = (1.0f - alpha) * m_micRmsLevel + alpha * absVal;

  float targetGain = TARGET_RMS_MIC / (m_micRmsLevel + 200.0f);
  targetGain = constrain(targetGain, 0.5f, 4.0f);
  m_micAgcGain = 0.99f * m_micAgcGain + 0.01f * targetGain;

  float boosted = sample * m_micAgcGain * gainMult;
  return (int16_t)constrain(boosted, -32768.0f, 32767.0f);
}

int16_t AudioManager::applyVintageWarmth(int16_t sample, float drive) {
  float x = ((float)sample / 32768.0f) * drive;
  if (x > 1.2f) x = 1.2f;
  if (x < -1.2f) x = -1.2f;
  float y = x - (x * x * x) * 0.333f;
  return (int16_t)constrain(y * 32767.0f, -32768.0f, 32767.0f);
}

int16_t AudioManager::processDspSample(int16_t inSample) {
  if (m_resetFilterState.exchange(false, std::memory_order_relaxed)) {
    m_hp_x1 = m_hp_y1 = 0.0f;
    m_lp_x1 = m_lp_y1 = 0.0f;
  }

  int profile = m_activeProfile.load(std::memory_order_relaxed);
  if (profile == PROFILE_MODERN_HD) {
    return inSample;
  }

  float x = (float)inSample;
  if (profile == PROFILE_VINTAGE_POTS) {
    // High-pass ~300Hz, Low-pass ~3400Hz @ 16kHz
    float hp_out = 0.9449f * m_hp_y1 + 0.9724f * (x - m_hp_x1);
    m_hp_x1 = x;
    m_hp_y1 = hp_out;

    float lp_out = 0.435f * m_lp_y1 + 0.565f * hp_out;
    m_lp_y1 = lp_out;

    return applyVintageWarmth((int16_t)constrain(lp_out, -32768.0f, 32767.0f), 1.15f);
  } else if (profile == PROFILE_1930S_ANTIQUE) {
    // High-pass ~450Hz, Low-pass ~2500Hz @ 16kHz
    float hp_out = 0.918f * m_hp_y1 + 0.959f * (x - m_hp_x1);
    m_hp_x1 = x;
    m_hp_y1 = hp_out;

    float lp_out = 0.55f * m_lp_y1 + 0.45f * hp_out;
    m_lp_y1 = lp_out;

    return applyVintageWarmth((int16_t)constrain(lp_out, -32768.0f, 32767.0f), 1.55f);
  }

  return inSample;
}

int16_t AudioManager::sampleMicRawCentered() {
  if (m_adcDmaReady) {
    if (m_adcPcmReadIdx != m_adcPcmWriteIdx) {
      m_lastAdcSample = m_adcPcmRing[m_adcPcmReadIdx & (ADC_PCM_RING_SIZE - 1)];
      m_adcPcmReadIdx++;
    }
    return m_lastAdcSample;
  }

  int32_t adcRaw = analogRead(PIN_MIC_ADC);
  m_micDcBaseline = (m_micDcBaseline * 255 + adcRaw) / 256;
  int32_t centered = adcRaw - m_micDcBaseline;
  return (int16_t)constrain(centered * 16, -32768, 32767);
}

int16_t AudioManager::synthesizeNextToneSample() {
  portENTER_CRITICAL(&m_toneMux);
  LocalToneType type = m_toneType;
  if (type == TONE_NONE) {
    portEXIT_CRITICAL(&m_toneMux);
    return 0;
  }

  uint32_t pos = m_toneSamplePos++;
  float out = 0.0f;
  constexpr uint32_t SAMPLES_PER_MS = AUDIO_SAMPLE_RATE / 1000; // 16 samples/ms

  switch (type) {
    case TONE_DIAL: {
      // Standard North American Dial Tone: 350 Hz + 440 Hz continuous
      out = 3500.0f * (stepOscillator(m_phase1, 350.0f) + stepOscillator(m_phase2, 440.0f));
      break;
    }

    case TONE_WHISPER_DIAL: {
      // Quiet Dial Tone: 350 Hz + 440 Hz attenuated
      out = 900.0f * (stepOscillator(m_phase1, 350.0f) + stepOscillator(m_phase2, 440.0f));
      break;
    }

    case TONE_STUTTER_DIAL: {
      // 5 bursts of 100ms ON / 100ms OFF (1000ms), then continuous 350+440 Hz
      uint32_t ms = pos / SAMPLES_PER_MS;
      bool on = (ms >= 1000) || ((ms % 200) < 100);
      float s = stepOscillator(m_phase1, 350.0f) + stepOscillator(m_phase2, 440.0f);
      if (on) out = 3500.0f * s;
      break;
    }

    case TONE_DND_DIAL: {
      // 440 Hz + 480 Hz with 8 Hz warble modulation
      float warble = 0.65f + 0.35f * stepOscillator(m_modPhase, 8.0f);
      out = 3500.0f * warble * (stepOscillator(m_phase1, 440.0f) + stepOscillator(m_phase2, 480.0f));
      break;
    }

    case TONE_STUTTER_DND: {
      // 5 bursts of 100ms ON / 100ms OFF, then DND warble dial tone (440+480Hz @ 8Hz warble)
      uint32_t ms = pos / SAMPLES_PER_MS;
      bool on = (ms >= 1000) || ((ms % 200) < 100);
      float warble = 0.65f + 0.35f * stepOscillator(m_modPhase, 8.0f);
      float s = stepOscillator(m_phase1, 440.0f) + stepOscillator(m_phase2, 480.0f);
      if (on) out = 3500.0f * warble * s;
      break;
    }

    case TONE_RINGBACK: {
      // Audible Ringback: 440 Hz + 480 Hz, 2000ms ON / 4000ms OFF
      uint32_t cycleMs = (pos / SAMPLES_PER_MS) % 6000;
      float s = stepOscillator(m_phase1, 440.0f) + stepOscillator(m_phase2, 480.0f);
      if (cycleMs < 2000) out = 3500.0f * s;
      break;
    }

    case TONE_BUSY: {
      // Line Busy: 480 Hz + 620 Hz, 500ms ON / 500ms OFF
      uint32_t cycleMs = (pos / SAMPLES_PER_MS) % 1000;
      float s = stepOscillator(m_phase1, 480.0f) + stepOscillator(m_phase2, 620.0f);
      if (cycleMs < 500) out = 3800.0f * s;
      break;
    }

    case TONE_REORDER: {
      // Fast Busy / Reorder: 480 Hz + 620 Hz, 250ms ON / 250ms OFF
      uint32_t cycleMs = (pos / SAMPLES_PER_MS) % 500;
      float s = stepOscillator(m_phase1, 480.0f) + stepOscillator(m_phase2, 620.0f);
      if (cycleMs < 250) out = 4000.0f * s;
      break;
    }

    case TONE_CALL_WAITING: {
      // Call Waiting Pip: 440 Hz single-shot 300ms
      constexpr uint32_t totalSamples = 300 * SAMPLES_PER_MS;
      if (pos >= totalSamples) {
        m_toneType = TONE_NONE;
      } else {
        out = 4500.0f * stepOscillator(m_phase1, 440.0f);
      }
      break;
    }

    case TONE_BEEP: {
      // Voicemail / Confirmation Beep: 800 Hz single-shot 250ms
      constexpr uint32_t totalSamples = 250 * SAMPLES_PER_MS;
      if (pos >= totalSamples) {
        m_toneType = TONE_NONE;
      } else {
        out = 5500.0f * stepOscillator(m_phase1, 800.0f);
      }
      break;
    }

    case TONE_CHIRP: {
      // Mute/Unmute Chirp: Linear sweep 1200 Hz -> 1800 Hz over 80ms
      constexpr uint32_t totalSamples = 80 * SAMPLES_PER_MS;
      if (pos >= totalSamples) {
        m_toneType = TONE_NONE;
      } else {
        float frac = (float)pos / (float)totalSamples;
        float freq = 1200.0f + 600.0f * frac;
        // Smooth 5ms fade-in/out envelope to prevent speaker click
        float env = 1.0f;
        if (pos < 80) env = (float)pos / 80.0f;
        else if (totalSamples - pos < 80) env = (float)(totalSamples - pos) / 80.0f;
        out = 4800.0f * env * stepOscillator(m_phase1, freq);
      }
      break;
    }

    case TONE_HOWLER: {
      // Bell System Receiver-Off-Hook Howler Siren: 1400 + 2060 + 2450 + 2600 Hz @ 5 Hz (100ms ON / 100ms OFF)
      uint32_t cycleMs = (pos / SAMPLES_PER_MS) % 200;
      float s = stepOscillator(m_phase1, 1400.0f) +
                stepOscillator(m_phase2, 2060.0f) +
                stepOscillator(m_phase3, 2450.0f) +
                stepOscillator(m_phase4, 2600.0f);
      if (cycleMs < 100) {
        out = 7200.0f * s; // High-alert quad-tone output
      }
      break;
    }

    default:
      break;
  }

  portEXIT_CRITICAL(&m_toneMux);
  return (int16_t)constrain(out, -32768.0f, 32767.0f);
}

void AudioManager::update() {
  // Always drain hardware ADC DMA first so its internal ring buffer stays fresh
  pumpAdcDma();

  int64_t nowUs = esp_timer_get_time();
  int64_t deltaUs = nowUs - m_lastUpdateUs;
  m_lastUpdateUs = nowUs;

  if (deltaUs <= 0) return;

  bool offHook = RotaryDial.isOffHook();
  bool micActive = m_micStreamActive.load(std::memory_order_acquire);
  bool calActive = m_calActive.load(std::memory_order_acquire);
  bool toneActive = isTonePlaying();
  size_t rxAvail = getAvailableSpeakerSamples();

  if (!offHook && !micActive && !calActive && !toneActive && rxAvail == 0) {
    m_adcPcmReadIdx = m_adcPcmWriteIdx;
    m_halfUsAccum = 0;
    return;
  }

  if (m_adcDmaReady && (uint32_t)(m_adcPcmWriteIdx - m_adcPcmReadIdx) > 512U) {
    m_adcPcmReadIdx = m_adcPcmWriteIdx - 256U;
  }

  // Cap catch-up window to 4ms (max 64 samples @ 16kHz) so task wakeup never stalls
  if (deltaUs > 4000) deltaUs = 4000;

  // 16,000 Hz = 62.5 us/sample -> 125 half-microseconds per sample (exact integer pacing!)
  m_halfUsAccum += (uint32_t)(deltaUs * 2);
  uint32_t dueSamples = m_halfUsAccum / 125U;
  if (dueSamples == 0) return;
  if (dueSamples > 64) dueSamples = 64;
  m_halfUsAccum -= dueSamples * 125U;

  int16_t spkOutBuf[64];
  bool shouldDriveSpeaker = offHook || toneActive || (rxAvail > 0);
  float volMult = m_volumeMultiplier.load(std::memory_order_relaxed);
  float sideMult = m_sidetoneMultiplier.load(std::memory_order_relaxed);

  uint32_t txW = m_txWriteIdx.load(std::memory_order_relaxed);
  uint32_t txR = m_txReadIdx.load(std::memory_order_acquire);

  uint32_t slotW[MAX_MIX_SLOTS];
  uint32_t slotR[MAX_MIX_SLOTS];
  for (size_t s = 0; s < MAX_MIX_SLOTS; s++) {
    slotW[s] = m_rxSlots[s].writeIdx.load(std::memory_order_acquire);
    slotR[s] = m_rxSlots[s].readIdx.load(std::memory_order_relaxed);
  }

  uint64_t localCalSumSq = 0;
  uint32_t localCalCount = 0;

  for (uint32_t i = 0; i < dueSamples; i++) {
    // 1. Paced 16kHz Microphone ADC Sample
    int16_t rawMic = 0;
    int16_t agcMic = 0;
    if (offHook || micActive || calActive) {
      rawMic = sampleMicRawCentered();
      if (calActive) {
        int64_t s = rawMic;
        localCalSumSq += (uint64_t)(s * s);
        localCalCount++;
      }
      agcMic = processOutboundAgc(rawMic);

      if (micActive && (txW - txR) < TX_RING_SIZE) {
        m_txRingBuf[txW & (TX_RING_SIZE - 1)] = agcMic;
        txW++;
      }
    }

    // 2. Speaker Output Synthesis (4-Slot Conference Mixer + Local Progress Tone + Real-Time Sidetone)
    if (shouldDriveSpeaker) {
      float mix = 0.0f;
      int32_t slotSum = 0;
      bool anySlotSample = false;

      for (size_t s = 0; s < MAX_MIX_SLOTS; s++) {
        if (slotR[s] != slotW[s]) {
          int16_t inRaw = m_rxSlots[s].buf[slotR[s] & (RX_RING_SIZE - 1)];
          slotR[s]++;
          float leveled = processInboundLeveler(m_rxSlots[s], (float)inRaw);
          slotSum += (int32_t)constrain(leveled, -32768.0f, 32767.0f);
          anySlotSample = true;
        }
      }

      if (anySlotSample) {
        int16_t clampedSum = (int16_t)constrain(slotSum, -32768, 32767);
        int16_t filtered = processDspSample(clampedSum);
        mix += (float)filtered * volMult;
      }

      if (toneActive) {
        int16_t toneSample = synthesizeNextToneSample();
        mix += (float)toneSample * volMult;
      }

      if (offHook && sideMult > 0.001f) {
        mix += (float)agcMic * sideMult;
      }

      spkOutBuf[i] = (int16_t)constrain(mix, -32768.0f, 32767.0f);
    }
  }

  if (micActive) {
    m_txWriteIdx.store(txW, std::memory_order_release);
  }
  for (size_t s = 0; s < MAX_MIX_SLOTS; s++) {
    m_rxSlots[s].readIdx.store(slotR[s], std::memory_order_release);
  }

  if (calActive && localCalCount > 0) {
    portENTER_CRITICAL(&m_calMux);
    m_calSumSq += localCalSumSq;
    m_calSampleCount += localCalCount;
    portEXIT_CRITICAL(&m_calMux);
  }

  if (shouldDriveSpeaker) {
    size_t bytesWritten = 0;
    i2s_write(I2S_PORT, spkOutBuf, dueSamples * sizeof(int16_t), &bytesWritten, pdMS_TO_TICKS(4));
  }
}
