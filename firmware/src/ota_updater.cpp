#include "ota_updater.h"
#include "provisioning.h"
#include <mbedtls/sha256.h>

OtaUpdaterManager OtaUpdater;

void OtaUpdaterManager::begin() {
  m_isUpdating = false;
}

bool OtaUpdaterManager::performOtaUpdate(
  const String& fullBinaryUrl,
  const String& deviceToken,
  const String& expectedSha256
) {
  if (m_isUpdating || fullBinaryUrl.length() < 8) return false;

  String cleanExpected = expectedSha256;
  cleanExpected.trim();
  if (cleanExpected.length() != 64) {
    Serial.println("[OTA Error] Aborting OTA: a valid 64-char SHA-256 checksum is required.");
    return false;
  }

  m_isUpdating = true;

  Serial.printf("[OTA] Starting Over-The-Air firmware download from: %s\n", fullBinaryUrl.c_str());

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  String effectiveCaBundle;

  bool isHttps = fullBinaryUrl.startsWith("https://");
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  bool began = false;
  if (isHttps) {
    effectiveCaBundle = Provisioning.buildEffectiveCaBundle();
    secureClient.setCACert(effectiveCaBundle.c_str());
    began = http.begin(secureClient, fullBinaryUrl);
  } else {
    began = http.begin(plainClient, fullBinaryUrl);
  }

  if (!began) {
    Serial.println("[OTA Error] Failed to initialize HTTPClient connection.");
    m_isUpdating = false;
    return false;
  }

  if (deviceToken.length() > 0) {
    http.addHeader("X-Device-Token", deviceToken);
  }

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("[OTA Error] HTTP GET failed, status: %d\n", httpCode);
    http.end();
    m_isUpdating = false;
    return false;
  }

  int contentLength = http.getSize();
  bool knownLength = (contentLength > 0);
  if (contentLength == 0) {
    Serial.println("[OTA Error] Empty firmware payload.");
    http.end();
    m_isUpdating = false;
    return false;
  }

  if (!Update.begin(knownLength ? (size_t)contentLength : UPDATE_SIZE_UNKNOWN)) {
    Serial.println("[OTA Error] Not enough flash space to begin OTA update.");
    http.end();
    m_isUpdating = false;
    return false;
  }

  mbedtls_sha256_context shaCtx;
  mbedtls_sha256_init(&shaCtx);
  (void)mbedtls_sha256_starts(&shaCtx, 0);

  WiFiClient* stream = http.getStreamPtr();
  uint8_t chunkBuf[2048];
  size_t totalWritten = 0;
  uint32_t lastProgressMs = millis();
  bool streamOk = true;

  while (http.connected() && (!knownLength || totalWritten < (size_t)contentLength)) {
    size_t avail = stream->available();
    if (avail > 0) {
      size_t toRead = (avail > sizeof(chunkBuf)) ? sizeof(chunkBuf) : avail;
      int bytesRead = stream->readBytes(chunkBuf, toRead);
      if (bytesRead <= 0) break;

      (void)mbedtls_sha256_update(&shaCtx, chunkBuf, (size_t)bytesRead);

      size_t written = Update.write(chunkBuf, (size_t)bytesRead);
      if (written != (size_t)bytesRead) {
        Serial.println("[OTA Error] Flash write error during OTA stream!");
        streamOk = false;
        break;
      }
      totalWritten += written;
      lastProgressMs = millis();
    } else {
      if ((uint32_t)(millis() - lastProgressMs) > 15000) {
        Serial.println("[OTA Error] Stream timed out waiting for firmware bytes.");
        streamOk = false;
        break;
      }
      delay(2);
    }
  }

  uint8_t shaDigest[32];
  (void)mbedtls_sha256_finish(&shaCtx, shaDigest);
  mbedtls_sha256_free(&shaCtx);

  if (!streamOk || totalWritten == 0 || (knownLength && totalWritten != (size_t)contentLength)) {
    Serial.printf("[OTA Error] Incomplete firmware download (%u/%d bytes).\n", (unsigned)totalWritten, contentLength);
    Update.abort();
    http.end();
    m_isUpdating = false;
    return false;
  }

  // Mandatory SHA-256 hex digest verification before committing flash partition
  char computedHex[65];
  for (int i = 0; i < 32; i++) {
    snprintf(computedHex + (i * 2), 3, "%02x", shaDigest[i]);
  }
  computedHex[64] = '\0';

  if (!cleanExpected.equalsIgnoreCase(computedHex)) {
    Serial.printf("[OTA Error] SHA-256 verification failed!\n  Expected: %s\n  Computed: %s\n",
      cleanExpected.c_str(), computedHex);
    Update.abort();
    http.end();
    m_isUpdating = false;
    return false;
  }
  Serial.printf("[OTA] SHA-256 verified: %s\n", computedHex);

  if (Update.end(true) && Update.isFinished()) {
    Serial.println("[OTA Success] Firmware verified & flashed! Rebooting ESP32-S3...");
    http.end();
    delay(800);
    ESP.restart();
    return true;
  }

  Serial.printf("[OTA Error] Update finalization failed. Error #: %d\n", Update.getError());
  http.end();
  m_isUpdating = false;
  return false;
}
