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
  void sendFactoryReset();
  void sendAudioPacket(const uint8_t* data, size_t len);

  bool isConnected() const { return m_isConnected; }
  CallState getCallState() const { return m_callState; }
  void setCallState(CallState state) { m_callState = state; }

private:
  WebSocketsClient m_webSocket;
  CallState m_callState = STATE_IDLE;
  bool m_isConnected = false;
  bool m_wsInitialized = false;

  uint32_t m_lastHeartbeat = 0;
  uint32_t m_lastWifiRetry = 0;

  String m_serverHost;
  uint16_t m_serverPort = 4000;
  bool m_useSsl = false;
  String m_caBundleCache;
  bool m_caFetchAttempted = false;
  bool m_reinitRequested = false;

  // Call media framing & state flags
  bool m_isSystemLine = false;
  bool m_isVoicemail = false;
  bool m_isLoopback = false;
  bool m_isMicMuted = false;

  // E2EE peer key cache (used when promoted to Key Leader in multi-party calls)
  static constexpr size_t MAX_E2EE_PEERS = 6;
  struct E2eePeerEntry {
    bool active = false;
    String deviceId;
    String ephPubB64;
  };
  E2eePeerEntry m_e2eePeers[MAX_E2EE_PEERS];

  // Non-blocking test ring timer
  uint32_t m_testRingStopTime = 0;
  bool m_testRingActive = false;

  // Non-blocking acoustic bell calibration step state
  bool m_calibrationActive = false;
  float m_calibrationFreqHz = 20.0f;
  uint32_t m_calibrationStopTime = 0;

  // Chunked binary [0x03] zero-access voicemail stream accumulator (PSRAM)
  struct VmChunkStreamState {
    bool active = false;
    uint32_t vmId = 0;
    String ephPub;
    String iv;
    String tag;
    size_t totalBytes = 0;
    size_t receivedBytes = 0;
    uint16_t expectedSeq = 0;
    uint8_t* cipherBuf = nullptr;
  };
  VmChunkStreamState m_vmStream;

  // Non-blocking decrypted voicemail PCM streamer (PSRAM/heap)
  int16_t* m_vmPcmBuffer = nullptr;
  size_t m_vmPcmTotalSamples = 0;
  size_t m_vmPcmCursor = 0;
  uint32_t m_activeVmPlaybackId = 0;
  uint32_t m_pendingDoneVmId = 0;
  uint32_t m_pendingDoneDeadlineMs = 0;

  void initWebSocketClient();
  void handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
  void handleBinaryFrame(const uint8_t* payload, size_t length);
  void handleJsonCommand(const JsonDocument& doc);
  void applySettingsFromJson(const JsonDocument& doc);
  void parseServerUrl(const String& fullUrl);
  void clearE2eePeers();
  void trackE2eePeer(const String& peerDeviceId, const String& ephPubB64);
  void removeE2eePeer(const String& peerDeviceId);
  void sendWrappedMediaKeyToPeer(const String& callId, const String& peerDeviceId, const String& peerPubB64);
  void clearVmChunkStream();
  void sendVoicemailPlaybackDone(uint32_t vmId);
  void clearVoicemailPlayback();
  void pumpVoicemailPlayback();
};

extern NetworkClientManager NetworkClient;
