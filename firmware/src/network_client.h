#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "config.h"

enum CallState {
  STATE_IDLE = 0,
  STATE_DIALING,
  STATE_RINGING,
  STATE_IN_CALL,
  STATE_ON_HOLD
};

class NetworkClientManager {
public:
  void begin();
  void update();

  void sendHookState(bool isOffHook);
  void sendHookFlash();
  void sendDialDigit(char digit, float pps = 0.0f, float breakRatio = 0.0f, uint32_t pulseCount = 0);
  void sendCallAnswer();
  void sendCallHangup();
  void sendAudioPacket(const uint8_t* data, size_t len);

  bool isConnected() const;
  CallState getCallState() const;
  void setCallState(CallState state);

private:
  WebSocketsClient m_webSocket;
  CallState m_callState = STATE_IDLE;
  bool m_isConnected = false;
  uint32_t m_lastHeartbeat = 0;
  String m_serverHost;
  uint16_t m_serverPort = 4000;
  bool m_useSsl = false;
  String m_sessionKey;

  // Non-blocking test ring timer
  uint32_t m_testRingStopTime = 0;
  bool m_testRingActive = false;

  void handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
  void handleJsonCommand(const JsonDocument& doc);
  void parseServerUrl(const String& fullUrl);
};

extern NetworkClientManager NetworkClient;
