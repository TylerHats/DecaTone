#pragma once
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include "config.h"

class OtaUpdaterManager {
public:
  void begin();
  bool performOtaUpdate(
    const String& fullBinaryUrl,
    const String& deviceToken = "",
    const String& expectedSha256 = ""
  );
  bool isUpdating() const { return m_isUpdating; }

private:
  bool m_isUpdating = false;
};

extern OtaUpdaterManager OtaUpdater;
