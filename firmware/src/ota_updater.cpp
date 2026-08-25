#include "ota_updater.h"

OtaUpdaterManager OtaUpdater;

void OtaUpdaterManager::begin() {
  m_isUpdating = false;
}

bool OtaUpdaterManager::isUpdating() const {
  return m_isUpdating;
}

bool OtaUpdaterManager::performOtaUpdate(const String& fullBinaryUrl) {
  if (m_isUpdating) return false;
  m_isUpdating = true;

  Serial.printf("[OTA] Starting Over-The-Air firmware download from: %s\n", fullBinaryUrl.c_str());

  HTTPClient http;
  http.begin(fullBinaryUrl);

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("[OTA Error] HTTP GET failed, error: %d\n", httpCode);
    http.end();
    m_isUpdating = false;
    return false;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    Serial.println("[OTA Error] Invalid content length.");
    http.end();
    m_isUpdating = false;
    return false;
  }

  bool canBegin = Update.begin(contentLength);
  if (!canBegin) {
    Serial.println("[OTA Error] Not enough flash space to begin OTA update.");
    http.end();
    m_isUpdating = false;
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  size_t written = Update.writeStream(*stream);

  if (written != contentLength) {
    Serial.printf("[OTA Error] Written only %d/%d bytes.\n", written, contentLength);
  }

  if (Update.end()) {
    if (Update.isFinished()) {
      Serial.println("[OTA Success] Update successfully finished! Rebooting ESP32-S3...");
      http.end();
      delay(1000);
      ESP.restart();
      return true;
    } else {
      Serial.println("[OTA Error] Update not finished.");
    }
  } else {
    Serial.printf("[OTA Error] Update failed. Error #: %d\n", Update.getError());
  }

  http.end();
  m_isUpdating = false;
  return false;
}
