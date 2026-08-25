#include "network_client.h"
#include "provisioning.h"
#include "audio_manager.h"
#include "bell_ringer.h"
#include "ota_updater.h"

NetworkClientManager NetworkClient;

void NetworkClientManager::parseServerUrl(const String& fullUrl) {
  String url = fullUrl;
  m_useSsl = url.startsWith("https://");

  if (m_useSsl) url = url.substring(8);
  else if (url.startsWith("http://")) url = url.substring(7);

  // Extract host and port
  int colonIdx = url.indexOf(':');
  int slashIdx = url.indexOf('/');

  if (colonIdx != -1) {
    m_serverHost = url.substring(0, colonIdx);
    int portEnd = (slashIdx != -1) ? slashIdx : url.length();
    m_serverPort = (uint16_t)url.substring(colonIdx + 1, portEnd).toInt();
  } else {
    m_serverHost = (slashIdx != -1) ? url.substring(0, slashIdx) : url;
    m_serverPort = m_useSsl ? 443 : 4000;
  }
}

void NetworkClientManager::begin() {
  DeviceConfig config = Provisioning.getConfig();
  if (!config.isConfigured) return;

  Serial.printf("[Network] Connecting to WiFi: %s...\n", config.wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());

  uint32_t startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[Network] WiFi Connected! IP: %s, RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("\n[Network] WiFi connection timed out. Starting setup AP...");
    Provisioning.resetConfig();
    return;
  }

  parseServerUrl(config.serverBaseUrl);
  Serial.printf("[Network] Connecting WebSocket to %s:%d/ws/phone (SSL: %s)\n",
    m_serverHost.c_str(), m_serverPort, m_useSsl ? "YES" : "NO");

  if (m_useSsl) {
    m_webSocket.beginSSL(m_serverHost.c_str(), m_serverPort, "/ws/phone");
  } else {
    m_webSocket.begin(m_serverHost.c_str(), m_serverPort, "/ws/phone");
  }

  m_webSocket.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
    this->handleWebSocketEvent(type, payload, length);
  });

  m_webSocket.setReconnectInterval(3000);
  m_webSocket.enableHeartbeat(15000, 3000, 2);
}

void NetworkClientManager::handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      m_isConnected = true;
      Serial.println("[WebSocket] Connected to DecaTone telephone switchboard!");

      // Send registration handshake
      DeviceConfig config = Provisioning.getConfig();
      JsonDocument doc;
      doc["type"] = "register";
      doc["deviceId"] = config.deviceId;
      doc["mac"] = WiFi.macAddress();
      doc["firmwareVersion"] = FIRMWARE_VERSION;
      doc["rssi"] = WiFi.RSSI();

      String jsonOut;
      serializeJson(doc, jsonOut);
      m_webSocket.sendTXT(jsonOut);
      break;
    }

    case WStype_DISCONNECTED:
      m_isConnected = false;
      Serial.println("[WebSocket] Disconnected from switchboard.");
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (!err) {
        handleJsonCommand(doc);
      }
      break;
    }

    case WStype_BIN:
      // Inbound audio stream packet from peer phone -> play through MAX98357A I2S DAC
      if (m_callState == STATE_IN_CALL && length > 0) {
        Audio.writeSpeakerSamples((const int16_t*)payload, length / sizeof(int16_t));
      }
      break;

    default:
      break;
  }
}

void NetworkClientManager::handleJsonCommand(const JsonDocument& doc) {
  const char* type = doc["type"];
  if (!type) return;

  if (strcmp(type, "register_ack") == 0) {
    Serial.println("[Switchboard] Registration confirmed by switchboard!");
    if (doc["earpieceVolume"].is<int>()) Audio.setSpeakerVolume(doc["earpieceVolume"]);
    if (doc["micSensitivity"].is<int>()) Audio.setMicSensitivity(doc["micSensitivity"]);
  } else if (strcmp(type, "play_tone") == 0) {
    const char* tone = doc["tone"];
    if (strcmp(tone, "dial") == 0) {
      m_callState = STATE_DIALING;
      Audio.playTone(TONE_DIAL);
    } else if (strcmp(tone, "ringback") == 0) {
      m_callState = STATE_RINGING;
      Audio.playTone(TONE_RINGBACK);
    } else if (strcmp(tone, "busy") == 0) {
      Audio.playTone(TONE_BUSY);
    }
  } else if (strcmp(type, "stop_tone") == 0) {
    Audio.stopTone();
  } else if (strcmp(type, "incoming_call") == 0) {
    m_callState = STATE_RINGING;
    const char* ringStyle = doc["ringStyle"] | "traditional";
    const char* ringCadence = doc["ringCadence"] | "2000,4000";
    BellRinger.startRing(ringStyle, ringCadence);
  } else if (strcmp(type, "stop_ring") == 0) {
    BellRinger.stopRing();
  } else if (strcmp(type, "call_connected") == 0) {
    m_callState = STATE_IN_CALL;
    BellRinger.stopRing();
    Audio.stopTone();
    m_sessionKey = doc["sessionKey"].as<String>();
    Serial.println("[Switchboard] Call Connected. Two-way encrypted audio stream active.");
  } else if (strcmp(type, "call_ended") == 0) {
    m_callState = STATE_IDLE;
    BellRinger.stopRing();
    Audio.stopTone();
    Serial.println("[Switchboard] Call Ended.");
  } else if (strcmp(type, "test_ring") == 0) {
    const char* ringStyle = doc["ringStyle"] | "traditional";
    const char* ringCadence = doc["cadence"] | "2000,4000";
    BellRinger.startRing(ringStyle, ringCadence);
    uint32_t durationMs = doc["durationMs"] | 6000;
    delay(durationMs);
    BellRinger.stopRing();
  } else if (strcmp(type, "reboot") == 0) {
    Serial.println("[Switchboard] Remote reboot commanded.");
    delay(500);
    ESP.restart();
  } else if (strcmp(type, "apply_settings") == 0) {
    if (doc["earpieceVolume"].is<int>()) Audio.setSpeakerVolume(doc["earpieceVolume"]);
    if (doc["micSensitivity"].is<int>()) Audio.setMicSensitivity(doc["micSensitivity"]);
  } else if (strcmp(type, "ota_available") == 0) {
    String binUrl = doc["binaryUrl"].as<String>();
    DeviceConfig config = Provisioning.getConfig();
    String fullUrl = config.serverBaseUrl + binUrl;
    OtaUpdater.performOtaUpdate(fullUrl);
  }
}

void NetworkClientManager::sendHookState(bool isOffHook) {
  if (!m_isConnected) return;
  DeviceConfig config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "hook_state";
  doc["deviceId"] = config.deviceId;
  doc["state"] = isOffHook ? "off_hook" : "on_hook";

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendDialDigit(char digit) {
  if (!m_isConnected) return;
  DeviceConfig config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "dial_digit";
  doc["deviceId"] = config.deviceId;
  doc["digit"] = String(digit);

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendCallAnswer() {
  if (!m_isConnected) return;
  DeviceConfig config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "call_answer";
  doc["deviceId"] = config.deviceId;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendCallHangup() {
  if (!m_isConnected) return;
  DeviceConfig config = Provisioning.getConfig();
  JsonDocument doc;
  doc["type"] = "call_hangup";
  doc["deviceId"] = config.deviceId;

  String jsonOut;
  serializeJson(doc, jsonOut);
  m_webSocket.sendTXT(jsonOut);
}

void NetworkClientManager::sendAudioPacket(const uint8_t* data, size_t len) {
  if (m_isConnected && m_callState == STATE_IN_CALL && len > 0) {
    m_webSocket.sendBIN(data, len);
  }
}

bool NetworkClientManager::isConnected() const {
  return m_isConnected;
}

CallState NetworkClientManager::getCallState() const {
  return m_callState;
}

void NetworkClientManager::update() {
  m_webSocket.loop();

  // Send periodic heartbeat every 20 seconds
  uint32_t now = millis();
  if (m_isConnected && (now - m_lastHeartbeat >= 20000)) {
    m_lastHeartbeat = now;
    DeviceConfig config = Provisioning.getConfig();
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

  // If active call is ongoing, stream microphone ADC data to WebSocket
  if (m_isConnected && m_callState == STATE_IN_CALL) {
    int16_t micBuffer[AUDIO_BUFFER_SAMPLES];
    size_t samplesRead = Audio.readMicSamples(micBuffer, AUDIO_BUFFER_SAMPLES);
    if (samplesRead > 0) {
      sendAudioPacket((const uint8_t*)micBuffer, samplesRead * sizeof(int16_t));
    }
  }
}
