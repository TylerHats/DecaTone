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
  String deviceId;
  bool isConfigured;
};

class ProvisioningManager {
public:
  void begin();
  void update();

  DeviceConfig getConfig();
  void saveConfig(const String& ssid, const String& pass, const String& serverUrl);
  void resetConfig();
  bool isSetupActive() const;

  static String normalizeServerUrl(String rawUrl, String& outError);
  static String generateUniqueDeviceId();

private:
  Preferences m_prefs;
  DeviceConfig m_config;
  AsyncWebServer* m_server = nullptr;
  DNSServer* m_dnsServer = nullptr;
  bool m_isApMode = false;

  void startCaptivePortal();
};

extern ProvisioningManager Provisioning;
