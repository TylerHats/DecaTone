#pragma once
#include <Arduino.h>
#include <HTTPClient.h>
#include <Update.h>
#include "config.h"

class OtaUpdaterManager {
public:
  void begin();
  bool performOtaUpdate(const String& fullBinaryUrl);
  bool isUpdating() const;

private:
  bool m_isUpdating = false;
};

extern OtaUpdaterManager OtaUpdater;
