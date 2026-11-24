#include "network_client.h"
#include "provisioning.h"
#include "audio_manager.h"
#include "bell_ringer.h"
#include "ota_updater.h"
#include "e2ee_crypto.h"
#include <stdlib.h>
#include <string.h>

NetworkClientManager NetworkClient;

namespace {
class PsramJsonAllocator : public ArduinoJson::Allocator {
public:
  void* allocate(size_t size) override {
#if defined(BOARD_HAS_PSRAM)
    if (psramFound()) {
      void* p = ps_malloc(size);
      if (p) return p;
    }
#endif
    return malloc(size);
  }

  void deallocate(void* pointer) override {
    free(pointer);
  }

  void* reallocate(void* ptr, size_t new_size) override {
#if defined(BOARD_HAS_PSRAM)
    if (psramFound()) {
      void* p = ps_realloc(ptr, new_size);
      if (p) return p;
    }
#endif
    return realloc(ptr, new_size);
  }
};

PsramJsonAllocator s_psramAllocator;
} // namespace

void NetworkClientManager::parseServerUrl(const String& fullUrl) {
  String url = fullUrl;
  url.trim();
  m_useSsl = url.startsWith("https://") || url.startsWith("wss://");

  if (url.startsWith("https://")) url = url.substring(8);
  else if (url.startsWith("http://")) url = url.substring(7);
  else if (url.startsWith("wss://")) url = url.substring(6);
  else if (url.startsWith("ws://")) url = url.substring(5);

  int colonIdx = url.indexOf(':');
  int slashIdx = url.indexOf('/');

  if (colonIdx != -1 && (slashIdx == -1 || colonIdx < slashIdx)) {
    m_serverHost = url.substring(0, colonIdx);
    int portEnd = (slashIdx != -1) ? slashIdx : (int)url.length();
    long parsedPort = url.substring(colonIdx + 1, portEnd).toInt();
    m_serverPort = (parsedPort > 0 && parsedPort <= 65535) ? (uint16_t)parsedPort : (m_useSsl ? 443 : 80);
  } else {
    m_serverHost = (slashIdx != -1) ? url.substring(0, slashIdx) : url;
    m_serverPort = m_useSsl ? 443 : 80;
  }
}

void NetworkClientManager::initWebSocketClient() {
  if (m_wsInitialized) return;
  const DeviceConfig& config = Provisioning.getConfig();
  if (!config.isConfigured) return;

  parseServerUrl(config.serverBaseUrl);
  Serial.printf("[Network] Configuring WebSocket to %s:%u/ws/phone (SSL: %s)\n",
    m_serverHost.c_str(), m_serverPort, m_useSsl ? "YES" : "NO");

  if (m_useSsl) {
    m_caBundleCache = Provisioning.buildEffectiveCaBundle();
    m_webSocket.beginSslWithCA(m_serverHost.c_str(), m_serverPort, "/ws/phone", m_caBundleCache.c_str(), "");
  } else {
    m_webSocket.begin(m_serverHost.c_str(), m_serverPort, "/ws/phone", "");
  }

  m_webSocket.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
    this->handleWebSocketEvent(type, payload, length);
  });

  m_webSocket.setReconnectInterval(3000);
  m_webSocket.enableHeartbeat(15000, 3000, 2);
  m_wsInitialized = true;
}

void NetworkClientManager::begin() {
  const DeviceConfig& config = Provisioning.getConfig();
  if (!config.isConfigured) return;

  Serial.printf("[Network] Connecting to WiFi: %s...\n", config.wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());

  // Wait up to 10s on startup, but NEVER wipe NVS if router is temporarily offline
  uint32_t startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (uint32_t)(millis() - startAttempt) < 10000) {
    delay(250);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[Network] WiFi Connected! IP: %s, RSSI: %d dBm\n",
      WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("\n[Network] ⚠️ WiFi not ready after 10s; preserving NVS config and retrying in background every 10s.");
    m_lastWifiRetry = millis();
  }

  initWebSocketClient();
}

void NetworkClientManager::clearE2eePeers() {
  for (size_t i = 0; i < MAX_E2EE_PEERS; i++) {
    m_e2eePeers[i].active = false;
    m_e2eePeers[i].deviceId = "";
    m_e2eePeers[i].ephPubB64 = "";
  }
}

void NetworkClientManager::trackE2eePeer(const String& peerDeviceId, const String& ephPubB64) {
  if (peerDeviceId.length() == 0 || ephPubB64.length() == 0) return;
  int freeIdx = -1;
  for (size_t i = 0; i < MAX_E2EE_PEERS; i++) {
    if (m_e2eePeers[i].active && m_e2eePeers[i].deviceId == peerDeviceId) {
      m_e2eePeers[i].ephPubB64 = ephPubB64;
      return;
    }
    if (!m_e2eePeers[i].active && freeIdx == -1) {
      freeIdx = (int)i;
    }
  }
  if (freeIdx != -1) {
    m_e2eePeers[freeIdx].active = true;
    m_e2eePeers[freeIdx].deviceId = peerDeviceId;
    m_e2eePeers[freeIdx].ephPubB64 = ephPubB64;
  }
}

void NetworkClientManager::removeE2eePeer(const String& peerDeviceId) {
  if (peerDeviceId.length() == 0) return;
  for (size_t i = 0; i < MAX_E2EE_PEERS; i++) {
    if (m_e2eePeers[i].active && m_e2eePeers[i].deviceId == peerDeviceId) {
      m_e2eePeers[i].active = false;
      m_e2eePeers[i].deviceId = "";
      m_e2eePeers[i].ephPubB64 = "";
    }
  }
}

void NetworkClientManager::sendWrappedMediaKeyToPeer(const String& callId, const String& peerDeviceId, const String& peerPubB64) {
  if (!E2eeCrypto.isKeyLeader() || peerDeviceId.length() == 0 || peerPubB64.length() == 0) return;
  String ivB64, tagB64, wrappedKeyB64;
  uint8_t keyId = 1;
  if (!E2eeCrypto.wrapMediaKeyForPeer(callId, peerPubB64, ivB64, tagB64, wrappedKeyB64, keyId)) return;

  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument keyDoc;
  keyDoc["type"] = "e2ee_media_key";
  keyDoc["deviceId"] = config.deviceId;
  keyDoc["callId"] = callId;
  keyDoc["targetDeviceId"] = peerDeviceId;
  keyDoc["senderDeviceId"] = config.deviceId;
  keyDoc["senderPublicKey"] = E2eeCrypto.getEphemeralPubBase64();
  keyDoc["keyId"] = keyId;
  keyDoc["iv"] = ivB64;
  keyDoc["tag"] = tagB64;
  keyDoc["wrappedKey"] = wrappedKeyB64;

  String jsonOut;
  serializeJson(keyDoc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
  Serial.printf("[E2EE] Wrapped & dispatched media key (keyId=%u) to peer '%s'.\n", keyId, peerDeviceId.c_str());
}

void NetworkClientManager::clearVmChunkStream() {
  if (m_vmStream.cipherBuf) {
    free(m_vmStream.cipherBuf);
    m_vmStream.cipherBuf = nullptr;
  }
  m_vmStream.active = false;
  m_vmStream.vmId = 0;
  m_vmStream.ephPub = "";
  m_vmStream.iv = "";
  m_vmStream.tag = "";
  m_vmStream.totalBytes = 0;
  m_vmStream.receivedBytes = 0;
  m_vmStream.expectedSeq = 0;
}

void NetworkClientManager::sendVoicemailPlaybackDone(uint32_t vmId) {
  if (!m_isConnected || vmId == 0) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doneDoc;
  doneDoc["type"] = "voicemail_playback_done";
  doneDoc["deviceId"] = config.deviceId;
  doneDoc["vmId"] = vmId;

  String jsonOut;
  serializeJson(doneDoc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
  Serial.printf("[E2EE VM] Sent voicemail_playback_done (vmId=%u).\n", (unsigned)vmId);
}

void NetworkClientManager::clearVoicemailPlayback() {
  if (m_vmPcmBuffer) {
    free(m_vmPcmBuffer);
    m_vmPcmBuffer = nullptr;
  }
  m_vmPcmTotalSamples = 0;
  m_vmPcmCursor = 0;
  m_activeVmPlaybackId = 0;
  m_pendingDoneVmId = 0;
}

void NetworkClientManager::pumpVoicemailPlayback() {
  if (m_vmPcmBuffer) {
    if (m_vmPcmCursor < m_vmPcmTotalSamples) {
      size_t freeSpace = Audio.getSpeakerFreeSamples();
      if (freeSpace >= 512) {
        size_t remaining = m_vmPcmTotalSamples - m_vmPcmCursor;
        size_t chunk = (remaining < freeSpace) ? remaining : freeSpace;
        if (chunk > 1024) chunk = 1024;

        Audio.writeSpeakerSamples(m_vmPcmBuffer + m_vmPcmCursor, chunk);
        m_vmPcmCursor += chunk;
      }
    }

    if (m_vmPcmCursor >= m_vmPcmTotalSamples) {
      uint32_t finishedVmId = m_activeVmPlaybackId;
      free(m_vmPcmBuffer);
      m_vmPcmBuffer = nullptr;
      m_vmPcmTotalSamples = 0;
      m_vmPcmCursor = 0;
      m_activeVmPlaybackId = 0;
      if (finishedVmId != 0) {
        m_pendingDoneVmId = finishedVmId;
        m_pendingDoneDeadlineMs = millis() + 350;
      }
    }
  }

  if (m_pendingDoneVmId != 0) {
    if (Audio.getAvailableSpeakerSamples() == 0 || (int32_t)(millis() - m_pendingDoneDeadlineMs) >= 0) {
      uint32_t vmId = m_pendingDoneVmId;
      m_pendingDoneVmId = 0;
      sendVoicemailPlaybackDone(vmId);
    }
  }
}

void NetworkClientManager::handleBinaryFrame(const uint8_t* payload, size_t length) {
  if (!payload || length < 3) return;

  uint8_t frameType = payload[0];

  if (frameType == 0x00) {
    // Server system / TTS audio frame: [0x00][raw int16le PCM...]
    // Copy to stack-aligned int16_t buffer first to prevent Xtensa unaligned LoadProhibited fault!
    size_t pcmBytes = (length - 1) & ~static_cast<size_t>(1U);
    size_t totalSamples = pcmBytes / sizeof(int16_t);
    int16_t alignedBuf[512];
    size_t offsetSamples = 0;

    while (offsetSamples < totalSamples) {
      size_t chunkSamples = (totalSamples - offsetSamples > 512) ? 512 : (totalSamples - offsetSamples);
      memcpy(alignedBuf, payload + 1 + (offsetSamples * sizeof(int16_t)), chunkSamples * sizeof(int16_t));
      Audio.writeSpeakerSamples(alignedBuf, chunkSamples);
      offsetSamples += chunkSamples;
    }
  } else if (frameType == 0x01 || frameType == 0x04) {
    // E2EE encrypted call audio: [0x01][keyId][iv12][tag16][ct] or [0x04][slot][keyId][iv12][tag16][ct]
    size_t hdrBytes = (frameType == 0x04) ? 31 : 30;
    if (!E2eeCrypto.isMediaKeyReady() || length <= hdrBytes) return;

    size_t cipherSamples = (length - hdrBytes) / sizeof(int16_t);
    int16_t stackSamples[1024];
    int16_t* pcmOut = (cipherSamples <= 1024)
      ? stackSamples
      : static_cast<int16_t*>(malloc(cipherSamples * sizeof(int16_t)));
    if (!pcmOut) return;

    size_t decodedCount = 0;
    uint8_t senderSlot = 0;
    if (E2eeCrypto.decryptCallFrameWithSlot(payload, length, pcmOut, cipherSamples, decodedCount, senderSlot) && decodedCount > 0) {
      Audio.pushInboundSlotAudio(senderSlot, pcmOut, decodedCount);
    }

    if (pcmOut != stackSamples) {
      free(pcmOut);
    }
  } else if (frameType == 0x03 && length >= 8) {
    // Chunked Zero-Access Voicemail Binary Frame: [0x03][vmId_u32_be(4B)][seq_u16_be(2B)][flags(1B)][cipherSlice]
    uint32_t vmId = ((uint32_t)payload[1] << 24) |
                    ((uint32_t)payload[2] << 16) |
                    ((uint32_t)payload[3] << 8) |
                    (uint32_t)payload[4];
    uint16_t seq = ((uint16_t)payload[5] << 8) | (uint16_t)payload[6];
    uint8_t flags = payload[7];
    const uint8_t* chunkData = payload + 8;
    size_t chunkLen = length - 8;

    if (!m_vmStream.active || m_vmStream.vmId != vmId || !m_vmStream.cipherBuf) {
      return;
    }
    if (seq != m_vmStream.expectedSeq || m_vmStream.receivedBytes + chunkLen > m_vmStream.totalBytes) {
      Serial.printf("[E2EE VM] ⚠️ Out-of-order or oversized chunk for vmId=%u (seq=%u expected=%u); aborting stream.\n",
        (unsigned)vmId, (unsigned)seq, (unsigned)m_vmStream.expectedSeq);
      clearVmChunkStream();
      return;
    }

    if (chunkLen > 0) {
      memcpy(m_vmStream.cipherBuf + m_vmStream.receivedBytes, chunkData, chunkLen);
      m_vmStream.receivedBytes += chunkLen;
    }
    m_vmStream.expectedSeq++;

    if ((flags & 0x01U) != 0 || m_vmStream.receivedBytes >= m_vmStream.totalBytes) {
      uint8_t* cipherBuf = m_vmStream.cipherBuf;
      size_t cipherLen = m_vmStream.receivedBytes;
      String ephPub = m_vmStream.ephPub;
      String iv = m_vmStream.iv;
      String tag = m_vmStream.tag;
      m_vmStream.cipherBuf = nullptr;
      clearVmChunkStream();

      const DeviceConfig& config = Provisioning.getConfig();
      int16_t* pcmAlloc = nullptr;
      size_t sampleCount = 0;
      if (E2eeCryptoManager::decryptVoicemailWavBinary(
            Provisioning.getDevicePrivateKey(),
            config.wrappedVmKey,
            ephPub,
            iv,
            tag,
            cipherBuf,
            cipherLen,
            pcmAlloc,
            sampleCount)) {
        clearVoicemailPlayback();
        m_vmPcmBuffer = pcmAlloc;
        m_vmPcmTotalSamples = sampleCount;
        m_vmPcmCursor = 0;
        m_activeVmPlaybackId = vmId;
        Serial.printf("[E2EE VM] 🔓 Decrypted streamed voicemail vmId=%u (%u samples, %.1fs).\n",
          (unsigned)vmId, (unsigned)sampleCount, (float)sampleCount / (float)AUDIO_SAMPLE_RATE);
        pumpVoicemailPlayback();
      } else {
        Serial.printf("[E2EE VM] ⚠️ Decryption failed for streamed voicemail vmId=%u.\n", (unsigned)vmId);
      }
    }
  }
}

void NetworkClientManager::handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      m_isConnected = true;
      Serial.println("[WebSocket] Connected to DecaTone telephone switchboard!");

      const DeviceConfig& config = Provisioning.getConfig();
      JsonDocument doc;
      doc["type"] = "register";
      doc["deviceId"] = config.deviceId;
      doc["deviceToken"] = config.deviceToken;
      doc["devicePublicKey"] = Provisioning.getDevicePublicKeyBase64();
      doc["mac"] = WiFi.macAddress();
      doc["firmwareVersion"] = FIRMWARE_VERSION;
      doc["rssi"] = WiFi.RSSI();
      doc["hardwareProfile"] = config.hardwareProfile;
      doc["bellFrequencyHz"] = config.bellFrequencyHz;
      doc["hookFlashEnabled"] = config.hookFlashEnabled;

      String jsonOut;
      serializeJson(doc, jsonOut);
      m_webSocket.sendTXT(jsonOut);
      break;
    }

    case WStype_DISCONNECTED: {
      bool wasConnected = m_isConnected;
      m_isConnected = false;
      m_callState = STATE_IDLE;
      m_isSystemLine = false;
      m_isVoicemail = false;
      m_isLoopback = false;
      m_isMicMuted = false;
      m_testRingActive = false;
      if (m_calibrationActive) {
        m_calibrationActive = false;
        Audio.finishMicRmsWindow();
      }
      clearVmChunkStream();
      clearVoicemailPlayback();
      clearE2eePeers();
      E2eeCrypto.endCallSession();
      Audio.stopTone();
      Audio.setMicStreamActive(false);
      BellRinger.stopRing();
      if (!wasConnected && m_useSsl && !m_caFetchAttempted && Provisioning.getConfig().localCaPem.length() == 0) {
        m_reinitRequested = true;
      }
      Serial.println("[WebSocket] Disconnected from switchboard.");
      break;
    }

    case WStype_ERROR:
      if (m_useSsl && !m_caFetchAttempted && Provisioning.getConfig().localCaPem.length() == 0) {
        m_reinitRequested = true;
      }
      break;

    case WStype_TEXT: {
      if (length > 4096) {
        JsonDocument largeDoc(&s_psramAllocator);
        if (deserializeJson(largeDoc, payload, length) == DeserializationError::Ok) {
          handleJsonCommand(largeDoc);
        }
      } else {
        JsonDocument doc;
        if (deserializeJson(doc, payload, length) == DeserializationError::Ok) {
          handleJsonCommand(doc);
        }
      }
      break;
    }

    case WStype_BIN:
      handleBinaryFrame(payload, length);
      break;

    default:
      break;
  }
}

void NetworkClientManager::applySettingsFromJson(const JsonDocument& doc) {
  if (doc["deviceToken"].is<const char*>()) {
    String tok = doc["deviceToken"].as<String>();
    if (tok.length() > 0) {
      Provisioning.setDeviceToken(tok);
    }
  }

  if (!doc["wrappedVmKey"].isNull()) {
    String vmWrapStr;
    if (doc["wrappedVmKey"].is<const char*>()) {
      vmWrapStr = doc["wrappedVmKey"].as<String>();
    } else if (doc["wrappedVmKey"].is<JsonObjectConst>()) {
      serializeJson(doc["wrappedVmKey"], vmWrapStr);
    }
    if (vmWrapStr.length() > 2 && vmWrapStr != "null") {
      Provisioning.setWrappedVmKey(vmWrapStr);
    }
  }

  if (doc["earpieceVolume"].is<int>()) Audio.setSpeakerVolume((uint8_t)doc["earpieceVolume"].as<int>());
  else if (doc["speakerVolume"].is<int>()) Audio.setSpeakerVolume((uint8_t)doc["speakerVolume"].as<int>());

  if (doc["micSensitivity"].is<int>()) Audio.setMicSensitivity((uint8_t)doc["micSensitivity"].as<int>());
  if (doc["audioProfile"].is<const char*>()) Audio.setAudioProfile(doc["audioProfile"].as<String>());
  if (doc["sidetoneLevel"].is<int>()) Audio.setSidetoneLevel((uint8_t)doc["sidetoneLevel"].as<int>());

  if (doc["inboundNormEnabled"].is<bool>()) Audio.setInboundNormalizationEnabled(doc["inboundNormEnabled"].as<bool>());
  else if (doc["inboundNormalization"].is<bool>()) Audio.setInboundNormalizationEnabled(doc["inboundNormalization"].as<bool>());

  if (doc["outboundAgcEnabled"].is<bool>()) Audio.setOutboundAgcEnabled(doc["outboundAgcEnabled"].as<bool>());
  else if (doc["outboundAgc"].is<bool>()) Audio.setOutboundAgcEnabled(doc["outboundAgc"].as<bool>());

  if (doc["bellFrequencyHz"].is<float>() || doc["bellFrequencyHz"].is<int>()) {
    float freq = doc["bellFrequencyHz"].as<float>();
    BellRinger.setRingFrequency(freq);
    Provisioning.setBellFrequencyHz(freq);
  }

  if (doc["hookFlashEnabled"].is<bool>()) {
    Provisioning.setHookFlashEnabled(doc["hookFlashEnabled"].as<bool>());
  }

  if (doc["hardwareProfile"].is<const char*>()) {
    Provisioning.setHardwareProfile(doc["hardwareProfile"].as<String>());
  }
}

void NetworkClientManager::handleJsonCommand(const JsonDocument& doc) {
  const char* type = doc["type"];
  if (!type) return;

  if (strcmp(type, "register_ack") == 0) {
    Serial.println("[Switchboard] Registration confirmed by switchboard!");
    applySettingsFromJson(doc);
  } else if (strcmp(type, "pairing_complete") == 0) {
    applySettingsFromJson(doc);
    const char* owner = doc["ownerUsername"] | "user";
    const char* ext = doc["phoneNumber"] | "";
    Serial.printf("[Switchboard] ✅ Hardware paired to @%s (Ext %s)! Saved deviceToken & wrappedVmKey.\n", owner, ext);
  } else if (strcmp(type, "auth_error") == 0) {
    const char* reason = doc["message"] | (doc["reason"] | "invalid or revoked deviceToken");
    Serial.printf("[Switchboard] ⚠️ Auth error (%s). Preserving NVS token; hold BOOT 5s to factory reset if re-pairing.\n", reason);
  } else if (strcmp(type, "update_settings") == 0 || strcmp(type, "apply_settings") == 0) {
    applySettingsFromJson(doc);
  } else if (strcmp(type, "test_ring") == 0) {
    const char* ringStyle = doc["ringStyle"] | "traditional";
    const char* ringCadence = doc["ringCadence"] | (doc["cadence"] | "2000,4000");
    if (doc["bellFrequencyHz"].is<float>() || doc["bellFrequencyHz"].is<int>()) {
      BellRinger.setRingFrequency(doc["bellFrequencyHz"].as<float>());
    } else if (doc["frequency"].is<float>() || doc["frequency"].is<int>()) {
      BellRinger.setRingFrequency(doc["frequency"].as<float>());
    }
    BellRinger.startRing(ringStyle, ringCadence);
    uint32_t durationMs = doc["durationMs"] | 6000;
    m_testRingStopTime = millis() + durationMs;
    m_testRingActive = true;
  } else if (strcmp(type, "call_incoming") == 0 || strcmp(type, "incoming_call") == 0) {
    m_testRingActive = false; // Prevent an earlier test_ring timer from cutting off a real incoming call!
    const char* ringStyle = doc["ringStyle"] | "traditional";
    const char* ringCadence = doc["ringCadence"] | (doc["cadence"] | "2000,4000");
    if (doc["bellFrequencyHz"].is<float>() || doc["bellFrequencyHz"].is<int>()) {
      BellRinger.setRingFrequency(doc["bellFrequencyHz"].as<float>());
    }
    BellRinger.startRing(ringStyle, ringCadence);
    m_callState = STATE_RINGING;
    Serial.println("[Switchboard] 🔔 Incoming call! Starting physical bell ringing.");
  } else if (strcmp(type, "call_start") == 0 || strcmp(type, "call_answered") == 0 || strcmp(type, "call_connected") == 0) {
    m_testRingActive = false;
    BellRinger.stopRing();
    Audio.stopTone();
    clearVmChunkStream();
    clearVoicemailPlayback();
    clearE2eePeers();

    m_isMicMuted = false;
    m_isSystemLine = doc["isSystemLine"] | false;
    m_isVoicemail = doc["isVoicemail"] | false;
    String calleeNumber = doc["calleeNumber"] | "";
    m_isLoopback = (doc["isLoopback"] | false) || (calleeNumber == "119" || calleeNumber == "099");

    m_callState = STATE_IN_CALL;
    Audio.setMicStreamActive(true);

    if (!m_isSystemLine && !m_isVoicemail && !m_isLoopback) {
      String callId = doc["callId"] | "";
      bool isKeyLeader = doc["isKeyLeader"] | false;
      if (E2eeCrypto.beginCallSession(callId, isKeyLeader)) {
        const DeviceConfig& config = Provisioning.getConfig();
        String ephPubB64 = E2eeCrypto.getEphemeralPubBase64();
        JsonDocument pubDoc;
        pubDoc["type"] = "e2ee_pub";
        pubDoc["deviceId"] = config.deviceId;
        pubDoc["callId"] = callId;
        pubDoc["publicKey"] = ephPubB64;
        pubDoc["identityPublicKey"] = Provisioning.getDevicePublicKeyBase64();

        String sigB64;
        if (E2eeCryptoManager::signEphemeralKey(callId, ephPubB64, Provisioning.getDevicePrivateKey(), sigB64)) {
          pubDoc["signature"] = sigB64;
        }

        String jsonOut;
        serializeJson(pubDoc, jsonOut);
        m_webSocket.sendTXT(jsonOut);
      }
      Serial.printf("[Switchboard] 📞 Peer call '%s' connected (E2EE KeyLeader=%s).\n",
        callId.c_str(), isKeyLeader ? "YES" : "NO");
    } else {
      E2eeCrypto.endCallSession();
      Serial.printf("[Switchboard] 📞 System/Voicemail session connected (sys=%d, vm=%d, loop=%d).\n",
        m_isSystemLine ? 1 : 0, m_isVoicemail ? 1 : 0, m_isLoopback ? 1 : 0);
    }
  } else if (strcmp(type, "e2ee_peer_pub") == 0) {
    String callId = doc["callId"] | "";
    String peerDeviceId = doc["peerDeviceId"] | (doc["deviceId"] | "");
    String peerPubKey = doc["publicKey"] | "";
    String identityPub = doc["identityPublicKey"] | "";
    String expectedIdentityPub = doc["expectedIdentityPublicKey"] | "";
    String signature = doc["signature"] | "";
    bool legacyUnsigned = doc["legacyUnsigned"] | true;

    if (peerDeviceId.length() == 0 || peerPubKey.length() == 0) return;

    if (expectedIdentityPub.length() > 0 && identityPub.length() > 0 && identityPub != expectedIdentityPub) {
      Serial.printf("[E2EE] ⛔ Peer '%s' identity key mismatch vs switchboard registry! Rejecting key.\n", peerDeviceId.c_str());
      return;
    }

    String verifyKey = expectedIdentityPub.length() > 0 ? expectedIdentityPub : identityPub;
    if (!legacyUnsigned || signature.length() > 0) {
      if (!E2eeCryptoManager::verifyPeerEphemeralKey(callId, peerPubKey, verifyKey, signature)) {
        Serial.printf("[E2EE] ⛔ Peer '%s' ECDSA ephemeral key signature verification FAILED!\n", peerDeviceId.c_str());
        return;
      }
    } else {
      Serial.printf("[E2EE] ⚠️ Peer '%s' using unsigned legacy ephemeral key.\n", peerDeviceId.c_str());
    }

    trackE2eePeer(peerDeviceId, peerPubKey);
    if (E2eeCrypto.isKeyLeader()) {
      sendWrappedMediaKeyToPeer(callId, peerDeviceId, peerPubKey);
    }
  } else if (strcmp(type, "participant_left") == 0) {
    String leftDev = doc["deviceId"] | "";
    removeE2eePeer(leftDev);
  } else if (strcmp(type, "e2ee_leader_changed") == 0) {
    String callId = doc["callId"] | E2eeCrypto.getCallId().c_str();
    if (doc["isKeyLeader"] | false) {
      if (E2eeCrypto.promoteToKeyLeader(callId)) {
        for (size_t i = 0; i < MAX_E2EE_PEERS; i++) {
          if (m_e2eePeers[i].active) {
            sendWrappedMediaKeyToPeer(callId, m_e2eePeers[i].deviceId, m_e2eePeers[i].ephPubB64);
          }
        }
      }
    }
  } else if (strcmp(type, "e2ee_media_key") == 0) {
    const DeviceConfig& config = Provisioning.getConfig();
    String targetId = doc["targetDeviceId"] | "";
    if (targetId.length() == 0 || targetId == config.deviceId) {
      if (!E2eeCrypto.isKeyLeader()) {
        String callId = doc["callId"] | "";
        String senderPub = doc["senderPublicKey"] | "";
        String iv = doc["iv"] | "";
        String tag = doc["tag"] | "";
        String wrappedKey = doc["wrappedKey"] | "";
        E2eeCrypto.unwrapMediaKeyFromPeer(callId, senderPub, iv, tag, wrappedKey);
      }
    }
  } else if (strcmp(type, "voicemail_start") == 0) {
    m_testRingActive = false;
    BellRinger.stopRing();
    Audio.stopTone();
    clearVmChunkStream();
    clearVoicemailPlayback();
    clearE2eePeers();
    E2eeCrypto.endCallSession();

    m_isSystemLine = false;
    m_isLoopback = false;
    m_isVoicemail = true;
    m_callState = STATE_IN_CALL;
    Audio.setMicStreamActive(true);
    Serial.println("[Switchboard] 📼 Voicemail recording started ([0x02] PCM capture active).");
  } else if (strcmp(type, "voicemail_stream_start") == 0) {
    clearVmChunkStream();
    clearVoicemailPlayback();

    uint32_t vmId = doc["vmId"] | 0;
    size_t totalBytes = doc["totalBytes"] | 0;
    String ephPub = doc["ephemeralPublicKey"] | "";
    String iv = doc["iv"] | "";
    String tag = doc["tag"] | "";

    if (vmId == 0 || totalBytes <= 44 || totalBytes > E2eeCryptoManager::MAX_VM_CIPHER_BYTES) {
      Serial.printf("[E2EE VM] ⚠️ Invalid voicemail_stream_start bounds (vmId=%u bytes=%u).\n",
        (unsigned)vmId, (unsigned)totalBytes);
      return;
    }

    uint8_t* buf = static_cast<uint8_t*>(E2eeCryptoManager::allocPreferPsram(totalBytes));
    if (!buf) {
      Serial.println("[E2EE VM] Out of PSRAM allocating chunked voicemail stream!");
      return;
    }

    m_vmStream.active = true;
    m_vmStream.vmId = vmId;
    m_vmStream.ephPub = ephPub;
    m_vmStream.iv = iv;
    m_vmStream.tag = tag;
    m_vmStream.totalBytes = totalBytes;
    m_vmStream.receivedBytes = 0;
    m_vmStream.expectedSeq = 0;
    m_vmStream.cipherBuf = buf;
    Serial.printf("[E2EE VM] Receiving chunked [0x03] stream for vmId=%u (%u bytes).\n",
      (unsigned)vmId, (unsigned)totalBytes);
  } else if (strcmp(type, "voicemail_playback_abort") == 0) {
    clearVmChunkStream();
    clearVoicemailPlayback();
    Audio.clearSpeakerBuffer();
    Serial.println("[E2EE VM] Playback aborted by menu navigation.");
  } else if (strcmp(type, "voicemail_cipher_payload") == 0) {
    clearVmChunkStream();
    clearVoicemailPlayback();

    const DeviceConfig& config = Provisioning.getConfig();
    String ephPub = doc["ephemeralPublicKey"] | "";
    String iv = doc["iv"] | "";
    String tag = doc["tag"] | "";
    const char* cipherB64 = doc["ciphertextBase64"] | (doc["ciphertext"] | "");
    size_t cipherB64Len = cipherB64 ? strlen(cipherB64) : 0;

    int16_t* pcmAlloc = nullptr;
    size_t sampleCount = 0;
    if (E2eeCryptoManager::decryptVoicemailWav(
          Provisioning.getDevicePrivateKey(),
          config.wrappedVmKey,
          ephPub,
          iv,
          tag,
          cipherB64,
          cipherB64Len,
          pcmAlloc,
          sampleCount)) {
      m_vmPcmBuffer = pcmAlloc;
      m_vmPcmTotalSamples = sampleCount;
      m_vmPcmCursor = 0;
      m_activeVmPlaybackId = doc["vmId"] | 0;
      Serial.printf("[E2EE VM] 🔓 Decrypted zero-access voicemail WAV (%u samples, %.1fs). Streaming to handset!\n",
        (unsigned)sampleCount, (float)sampleCount / (float)AUDIO_SAMPLE_RATE);
      pumpVoicemailPlayback();
    } else {
      Serial.println("[E2EE VM] ⚠️ Could not decrypt voicemail_cipher_payload.");
    }
  } else if (strcmp(type, "play_tone") == 0) {
    String tone = doc["tone"] | (doc["toneName"] | "");
    Audio.playTone(tone);
  } else if (strcmp(type, "stop_tone") == 0) {
    Audio.stopTone();
  } else if (strcmp(type, "mic_mute_state") == 0) {
    if (doc["isMuted"].is<bool>() || doc["muted"].is<bool>()) {
      m_isMicMuted = doc["isMuted"].is<bool>() ? doc["isMuted"].as<bool>() : doc["muted"].as<bool>();
      Serial.printf("[Switchboard] 🎙️ Microphone %s.\n", m_isMicMuted ? "MUTED" : "UNMUTED");
    }
    Audio.playTone("chirp");
  } else if (strcmp(type, "start_screening") == 0) {
    m_testRingActive = false;
    if (BellRinger.isRinging()) {
      BellRinger.stopRing();
    }
    if (doc["isCaller"] | false) {
      m_isVoicemail = true;
      m_callState = STATE_IN_CALL;
      Audio.setMicStreamActive(true);
    }
    Serial.println("[Switchboard] 📻 Live call screening active.");
  } else if (strcmp(type, "calibration_step") == 0) {
    if (doc["active"].is<bool>() && !doc["active"].as<bool>()) {
      m_calibrationActive = false;
      Audio.finishMicRmsWindow();
      BellRinger.stopRing();
      Serial.println("[Calibration] Acoustic calibration step deactivated.");
      return;
    }

    float freq = doc["frequency"] | 20.0f;
    uint32_t durationMs = doc["durationMs"] | 800;
    if (durationMs < 100) durationMs = 100;
    if (durationMs > 5000) durationMs = 5000;

    m_testRingActive = false;
    BellRinger.startContinuousCalibration(freq);
    Audio.startMicRmsWindow();
    m_calibrationFreqHz = freq;
    m_calibrationStopTime = millis() + durationMs;
    m_calibrationActive = true;
    Serial.printf("[Calibration] Measuring acoustic bell resonance at %.1f Hz for %u ms...\n", freq, durationMs);
  } else if (strcmp(type, "calibration_stop") == 0) {
    m_calibrationActive = false;
    Audio.finishMicRmsWindow();
    BellRinger.stopRing();
    Serial.println("[Calibration] Calibration stopped by switchboard.");
  } else if (strcmp(type, "stop_ring") == 0) {
    m_testRingActive = false;
    BellRinger.stopRing();
    if (m_callState == STATE_RINGING) m_callState = STATE_IDLE;
    Serial.println("[Switchboard] 🔕 Ringing stopped.");
  } else if (strcmp(type, "call_ended") == 0) {
    m_testRingActive = false;
    BellRinger.stopRing();
    Audio.stopTone();
    Audio.setMicStreamActive(false);
    clearVmChunkStream();
    clearVoicemailPlayback();
    clearE2eePeers();
    E2eeCrypto.endCallSession();

    m_callState = STATE_IDLE;
    m_isSystemLine = false;
    m_isVoicemail = false;
    m_isLoopback = false;
    m_isMicMuted = false;
    Serial.println("[Switchboard] 📴 Call ended. Idle state restored.");
  } else if (strcmp(type, "reboot") == 0) {
    Serial.println("[Switchboard] Remote reboot commanded.");
    delay(400);
    ESP.restart();
  } else if (strcmp(type, "ota_available") == 0) {
    String binUrl = doc["binaryUrl"] | (doc["downloadUrl"] | "");
    binUrl.trim();
    if (binUrl.length() == 0) return;

    const DeviceConfig& config = Provisioning.getConfig();
    String fullUrl;
    if (binUrl.startsWith("http://") || binUrl.startsWith("https://")) {
      fullUrl = binUrl;
    } else if (binUrl.startsWith("/")) {
      fullUrl = config.serverBaseUrl + binUrl;
    } else {
      fullUrl = config.serverBaseUrl + "/" + binUrl;
    }

    String expectedSha256 = doc["expectedSha256"] | (doc["sha256"] | (doc["checksum"] | ""));
    OtaUpdater.performOtaUpdate(fullUrl, config.deviceToken, expectedSha256);
  }
}

void NetworkClientManager::sendHookState(bool isOffHook) {
  if (!isOffHook) {
    Audio.stopTone();
    Audio.setMicStreamActive(false);
    clearVmChunkStream();
    clearVoicemailPlayback();
    clearE2eePeers();
    E2eeCrypto.endCallSession();
    m_isVoicemail = false;
    m_isLoopback = false;
    m_isSystemLine = false;
    m_isMicMuted = false;
  }

  if (!m_isConnected) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "hook_state";
  doc["deviceId"] = config.deviceId;
  doc["state"] = isOffHook ? "off_hook" : "on_hook";

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendHookFlash() {
  if (!m_isConnected) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "hook_flash";
  doc["deviceId"] = config.deviceId;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
  Serial.println("[WebSocket] ⚡ Sent Hook Flash (Call Hold / Transfer Request) to switchboard.");
}

void NetworkClientManager::sendDialDigit(char digit, float pps, float breakRatio, uint32_t pulseCount) {
  // Stop any local continuous dial tone / voicemail playback when user dials a digit
  clearVmChunkStream();
  clearVoicemailPlayback();
  if (m_callState != STATE_IN_CALL) {
    Audio.stopTone();
  }

  if (!m_isConnected) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "dial_digit";
  doc["deviceId"] = config.deviceId;
  doc["digit"] = String(digit);
  doc["pps"] = pps;
  doc["breakRatio"] = breakRatio;
  doc["pulseCount"] = pulseCount;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
  Serial.printf("[WebSocket] 🔢 Sent Dialed Digit '%c' to switchboard.\n", digit);
}

void NetworkClientManager::sendCallAnswer() {
  if (!m_isConnected) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "call_answer";
  doc["deviceId"] = config.deviceId;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendCallHangup() {
  if (!m_isConnected) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "call_hangup";
  doc["deviceId"] = config.deviceId;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendFactoryReset() {
  if (!m_isConnected) return;
  const DeviceConfig& config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "factory_reset";
  doc["deviceId"] = config.deviceId;
  doc["deviceToken"] = config.deviceToken;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
  m_webSocket.loop();
  delay(120);
  Serial.println("[WebSocket] Sent factory_reset unpair notice to switchboard.");
}

void NetworkClientManager::sendAudioPacket(const uint8_t* data, size_t len) {
  if (m_isConnected && m_callState == STATE_IN_CALL && len > 0) {
    m_webSocket.sendBIN(data, len);
  }
}

void NetworkClientManager::update() {
  const DeviceConfig& config = Provisioning.getConfig();
  if (!config.isConfigured) return;

  uint32_t now = millis();

  // Non-blocking Wi-Fi reconnect every 10s so router power outages never require re-provisioning
  if (WiFi.status() != WL_CONNECTED) {
    m_isConnected = false;
    if ((uint32_t)(now - m_lastWifiRetry) >= 10000) {
      m_lastWifiRetry = now;
      Serial.println("[Network] WiFi disconnected; attempting non-blocking reconnect...");
      WiFi.reconnect();
    }
    return;
  }

  if (m_reinitRequested) {
    m_reinitRequested = false;
    m_caFetchAttempted = true;
    Serial.println("[Network TLS] HTTPS handshake failed without local CA; probing /api/tls/ca.crt once...");
    if (Provisioning.fetchAndPinLocalCa(config.serverBaseUrl)) {
      m_webSocket.disconnect();
      m_wsInitialized = false;
    }
  }

  initWebSocketClient();
  m_webSocket.loop();

  // Wrap-safe non-blocking test ring expiration
  if (m_testRingActive && (int32_t)(millis() - m_testRingStopTime) >= 0) {
    m_testRingActive = false;
    BellRinger.stopRing();
  }

  // Wrap-safe non-blocking acoustic bell calibration step completion
  if (m_calibrationActive && (int32_t)(millis() - m_calibrationStopTime) >= 0) {
    m_calibrationActive = false;
    float rmsAmplitude = Audio.finishMicRmsWindow();
    BellRinger.stopRing();

    if (m_isConnected) {
      JsonDocument calDoc;
      calDoc["type"] = "calibration_sample";
      calDoc["deviceId"] = config.deviceId;
      calDoc["frequency"] = m_calibrationFreqHz;
      calDoc["rmsAmplitude"] = rmsAmplitude;

      String jsonOut;
      serializeJson(calDoc, jsonOut);
      m_webSocket.sendTXT(jsonOut);
    }
    Serial.printf("[Calibration] %.1f Hz -> Mic RMS = %.1f\n", m_calibrationFreqHz, rmsAmplitude);
  }

  // Pump decrypted voicemail PCM frames into speaker ring buffer
  pumpVoicemailPlayback();

  // Periodic 20s telemetry heartbeat
  now = millis();
  if (m_isConnected && (uint32_t)(now - m_lastHeartbeat) >= 20000) {
    m_lastHeartbeat = now;
    JsonDocument doc;
    doc["type"] = "heartbeat";
    doc["deviceId"] = config.deviceId;
    doc["rssi"] = WiFi.RSSI();
    doc["freeHeap"] = ESP.getFreeHeap();
    doc["freePsram"] = ESP.getFreePsram();

    String jsonOut;
    serializeJson(doc, jsonOut);
    m_webSocket.sendTXT(jsonOut);
  }

  // Stream 16kHz paced microphone frames using binary framing contract
  if (m_isConnected && m_callState == STATE_IN_CALL) {
    int16_t micSamples[AUDIO_BUFFER_SAMPLES];
    uint8_t txFrame[30 + AUDIO_BUFFER_SAMPLES * sizeof(int16_t)];
    int framesSent = 0;

    while (Audio.getAvailableMicSamples() >= AUDIO_BUFFER_SAMPLES && framesSent < 4) {
      size_t samplesRead = Audio.readMicSamples(micSamples, AUDIO_BUFFER_SAMPLES);
      if (samplesRead < AUDIO_BUFFER_SAMPLES) break;

      if (m_isMicMuted) {
        memset(micSamples, 0, sizeof(micSamples));
      }

      if (m_isVoicemail) {
        // [0x02][raw int16le PCM...]
        txFrame[0] = 0x02;
        memcpy(txFrame + 1, micSamples, AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
        m_webSocket.sendBIN(txFrame, 1 + AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
      } else if (m_isLoopback) {
        // [0x00][raw int16le PCM...]
        txFrame[0] = 0x00;
        memcpy(txFrame + 1, micSamples, AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
        m_webSocket.sendBIN(txFrame, 1 + AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
      } else if (!m_isSystemLine) {
        // Peer Call E2EE: [0x01][keyId(1B)][iv(12B)][tag(16B)][ciphertext]
        // Strictly suppress outbound call audio until m_mediaKeyReady!
        if (E2eeCrypto.isMediaKeyReady()) {
          size_t packetLen = 0;
          if (E2eeCrypto.encryptCallFrame(micSamples, AUDIO_BUFFER_SAMPLES, txFrame, sizeof(txFrame), packetLen)) {
            m_webSocket.sendBIN(txFrame, packetLen);
          }
        }
      }
      framesSent++;
    }
  }
}
