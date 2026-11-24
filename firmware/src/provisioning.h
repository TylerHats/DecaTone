#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include "config.h"

struct DeviceConfig {
  String wifiSsid;
  String wifiPassword;
  String serverBaseUrl;
  String localCaPem;
  String deviceId;
  String deviceToken;
  String wrappedVmKey;
  String hardwareProfile;
  float bellFrequencyHz = DEFAULT_BELL_FREQ_HZ;
  bool hookFlashEnabled = true;
  bool isConfigured = false;
};

class ProvisioningManager {
public:
  void begin();
  void update();

  // Returns true once user has held PIN_BOOT_BUTTON continuously for 5000ms at runtime
  bool checkRuntimeFactoryResetHold();

  const DeviceConfig& getConfig() const { return m_config; }
  void saveConfig(
    const String& ssid,
    const String& pass,
    const String& serverUrl,
    const String& profile = "western_electric_500",
    float bellFreq = DEFAULT_BELL_FREQ_HZ,
    bool hookFlash = true
  );

  void setDeviceToken(const String& token);
  void setWrappedVmKey(const String& wrappedVmKey);
  void setLocalCaPem(const String& pem);
  void setBellFrequencyHz(float freqHz);
  void setHookFlashEnabled(bool enabled);
  void setHardwareProfile(const String& profile);

  String buildEffectiveCaBundle() const;
  bool fetchAndPinLocalCa(const String& serverBaseUrl);

  const uint8_t* getDevicePrivateKey() const { return m_devPrivKey; }
  const uint8_t* getDevicePublicKey() const { return m_devPubKey; }
  String getDevicePublicKeyBase64() const;

  // Clears wifi_ssid, wifi_pass, server_url, dev_token, vm_wrap while preserving dev_id, dev_priv, dev_pub
  void clearCredentialsPreserveIdentity();
  void resetConfig();
  bool isSetupActive() const { return m_isApMode; }

  static String htmlEscape(const String& raw);
  static String normalizeServerUrl(String rawUrl, String& outError);
  static String generateUniqueDeviceId();

private:
  Preferences m_prefs;
  DeviceConfig m_config;
  uint8_t m_devPrivKey[32] = {0};
  uint8_t m_devPubKey[65] = {0};

  AsyncWebServer* m_server = nullptr;
  DNSServer* m_dnsServer = nullptr;
  bool m_isApMode = false;

  bool m_restartScheduled = false;
  uint32_t m_pendingRestartAt = 0;

  bool m_bootHoldActive = false;
  uint32_t m_bootHoldStartMs = 0;
  uint8_t m_bootLastPrintedSec = 0;

  void ensureDeviceKeypair();
  bool detectStartupFiveSecondHold();
  void startCaptivePortal();
};

extern ProvisioningManager Provisioning;
