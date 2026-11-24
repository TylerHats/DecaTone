#include "provisioning.h"
#include "e2ee_crypto.h"
#include "tls_ca_bundle.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>

ProvisioningManager Provisioning;

String ProvisioningManager::generateUniqueDeviceId() {
  uint64_t chipid = ESP.getEfuseMac();
  char devId[24];
  snprintf(devId, sizeof(devId), "DT-%04X%08X", (uint16_t)(chipid >> 32), (uint32_t)chipid);
  return String(devId);
}

String ProvisioningManager::htmlEscape(const String& raw) {
  String out;
  out.reserve(raw.length() + 16);
  for (size_t i = 0; i < raw.length(); i++) {
    char c = raw.charAt(i);
    switch (c) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      case '"': out += "&quot;"; break;
      case '\'': out += "&#39;"; break;
      default: out += c; break;
    }
  }
  return out;
}

String ProvisioningManager::normalizeServerUrl(String rawUrl, String& outError) {
  outError = "";
  rawUrl.trim();

  while (rawUrl.endsWith("/")) {
    rawUrl = rawUrl.substring(0, rawUrl.length() - 1);
  }

  String withoutProto = rawUrl;
  bool isHttps = false;

  if (withoutProto.startsWith("https://")) {
    withoutProto = withoutProto.substring(8);
    isHttps = true;
  } else if (withoutProto.startsWith("http://")) {
    withoutProto = withoutProto.substring(7);
    isHttps = false;
  }

  int slashIdx = withoutProto.indexOf('/');
  if (slashIdx != -1) {
    outError = "Base URL must not contain subpaths or subdirectories (e.g. use 'phone.example.com' instead of 'site.com/page')";
    return "";
  }

  if (withoutProto.length() < 3) {
    outError = "Invalid server domain or IP address";
    return "";
  }

  return (isHttps ? "https://" : "http://") + withoutProto;
}

void ProvisioningManager::ensureDeviceKeypair() {
  size_t privLen = m_prefs.getBytesLength("dev_priv");
  size_t pubLen = m_prefs.getBytesLength("dev_pub");

  if (privLen == 32 && pubLen == 65) {
    size_t r1 = m_prefs.getBytes("dev_priv", m_devPrivKey, 32);
    size_t r2 = m_prefs.getBytes("dev_pub", m_devPubKey, 65);
    if (r1 == 32 && r2 == 65 && m_devPubKey[0] == 0x04) {
      return;
    }
  }

  Serial.println("[Provisioning] Generating persistent P-256 hardware identity keypair...");
  if (E2eeCryptoManager::generateP256Keypair(m_devPrivKey, m_devPubKey)) {
    m_prefs.putBytes("dev_priv", m_devPrivKey, 32);
    m_prefs.putBytes("dev_pub", m_devPubKey, 65);
    Serial.println("[Provisioning] Saved persistent P-256 keypair (dev_priv / dev_pub) in NVS.");
  } else {
    Serial.println("[Provisioning] ⚠️ Failed to generate P-256 hardware keypair!");
  }
}

bool ProvisioningManager::detectStartupFiveSecondHold() {
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  delay(20);
  if (digitalRead(PIN_BOOT_BUTTON) != LOW) {
    return false;
  }

  Serial.println("[Provisioning] BOOT button pressed — keep holding for 5 seconds to Factory Reset...");
  uint32_t holdStart = millis();
  uint8_t lastRemaining = 6;

  while (digitalRead(PIN_BOOT_BUTTON) == LOW) {
    uint32_t elapsed = millis() - holdStart;
    if (elapsed >= BOOT_RESET_HOLD_MS) {
      Serial.println("[Provisioning] 🔘 5-second BOOT hold confirmed! Resetting Wi-Fi & pairing credentials...");
      return true;
    }
    uint8_t remaining = (uint8_t)((BOOT_RESET_HOLD_MS - elapsed + 999) / 1000);
    if (remaining != lastRemaining) {
      lastRemaining = remaining;
      Serial.printf("[Provisioning] Hold BOOT button... %u s remaining\n", remaining);
    }
    delay(50);
  }

  Serial.println("[Provisioning] BOOT button released before 5 seconds; continuing normal boot.");
  return false;
}

bool ProvisioningManager::checkRuntimeFactoryResetHold() {
  bool pressed = (digitalRead(PIN_BOOT_BUTTON) == LOW);
  uint32_t now = millis();

  if (!pressed) {
    if (m_bootHoldActive) {
      Serial.println("[Provisioning] BOOT button released; factory reset cancelled.");
    }
    m_bootHoldActive = false;
    m_bootLastPrintedSec = 0;
    return false;
  }

  if (!m_bootHoldActive) {
    m_bootHoldActive = true;
    m_bootHoldStartMs = now;
    m_bootLastPrintedSec = 6;
    Serial.println("[Provisioning] BOOT button held — hold for 5 seconds to Factory Reset...");
    return false;
  }

  uint32_t elapsed = now - m_bootHoldStartMs;
  if (elapsed >= BOOT_RESET_HOLD_MS) {
    m_bootHoldActive = false;
    Serial.println("[Provisioning] 🔘 5-second BOOT button factory reset triggered!");
    return true;
  }

  uint8_t remaining = (uint8_t)((BOOT_RESET_HOLD_MS - elapsed + 999) / 1000);
  if (remaining != m_bootLastPrintedSec) {
    m_bootLastPrintedSec = remaining;
    Serial.printf("[Provisioning] Factory reset in %u s...\n", remaining);
  }
  return false;
}

void ProvisioningManager::begin() {
  m_prefs.begin(NVS_NAMESPACE, false);

  m_config.deviceId = m_prefs.getString("dev_id", "");
  if (m_config.deviceId.length() == 0) {
    m_config.deviceId = generateUniqueDeviceId();
    m_prefs.putString("dev_id", m_config.deviceId);
  }

  ensureDeviceKeypair();

  bool forceReset = detectStartupFiveSecondHold();
  if (forceReset) {
    clearCredentialsPreserveIdentity();
  }

  m_config.wifiSsid = m_prefs.getString("wifi_ssid", "");
  m_config.wifiPassword = m_prefs.getString("wifi_pass", "");
  m_config.serverBaseUrl = m_prefs.getString("server_url", "");
  m_config.localCaPem = m_prefs.getString("local_ca_pem", "");
  m_config.deviceToken = m_prefs.getString("dev_token", "");
  m_config.wrappedVmKey = m_prefs.getString("vm_wrap", "");
  m_config.hardwareProfile = m_prefs.getString("hw_profile", "western_electric_500");
  m_config.bellFrequencyHz = m_prefs.getFloat("bell_freq", DEFAULT_BELL_FREQ_HZ);
  m_config.hookFlashEnabled = m_prefs.getBool("hook_flash", true);
  m_config.isConfigured = (m_config.wifiSsid.length() > 0 && m_config.serverBaseUrl.length() > 0);

  if (!m_config.isConfigured || forceReset) {
    startCaptivePortal();
  } else {
    Serial.printf("[Provisioning] Loaded config: SSID='%s', Server='%s', DeviceID='%s', PairedToken=%s, HW='%s', BellFreq=%.1fHz\n",
      m_config.wifiSsid.c_str(),
      m_config.serverBaseUrl.c_str(),
      m_config.deviceId.c_str(),
      m_config.deviceToken.length() > 0 ? "YES" : "NO",
      m_config.hardwareProfile.c_str(),
      m_config.bellFrequencyHz
    );
  }
}

void ProvisioningManager::startCaptivePortal() {
  m_isApMode = true;
  WiFi.mode(WIFI_AP_STA);

  String suffix = m_config.deviceId.length() >= 4
    ? m_config.deviceId.substring(m_config.deviceId.length() - 4)
    : m_config.deviceId;
  String apName = "DecaTone-Setup-" + suffix;
  WiFi.softAP(apName.c_str(), AP_SETUP_PASSWORD);

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  m_dnsServer = new DNSServer();
  m_dnsServer->start(53, "*", apIP);

  m_server = new AsyncWebServer(80);

  // Captive Portal HTML Setup UI (Hardware Builder & WiFi Configuration)
  m_server->on("/", HTTP_GET, [this](AsyncWebServerRequest *request) {
    String safeDevId = htmlEscape(m_config.deviceId);
    String safeSsid = htmlEscape(m_config.wifiSsid);
    String safeServer = htmlEscape(m_config.serverBaseUrl);
    String safeLocalCa = htmlEscape(m_config.localCaPem);
    String passPlaceholder = m_config.wifiPassword.length() > 0
      ? "Leave blank to keep saved password"
      : "WiFi Password";
    String hfChecked = m_config.hookFlashEnabled ? "checked" : "";

    String html = R"rawliteral(<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DecaTone Phone Provisioning</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f17; color: #f3f4f6; margin: 0; padding: 1.5rem; }
    .card { max-width: 480px; margin: 0 auto; background: #121826; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 2rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #38bdf8; font-size: 1.5rem; text-align: center; }
    .section-title { font-size: 0.95rem; font-weight: 700; color: #fbbf24; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.35rem; margin-top: 1.25rem; margin-bottom: 0.85rem; }
    .dev-box { background: rgba(0,0,0,0.4); border: 1px dashed #d97706; padding: 1rem; border-radius: 8px; text-align: center; margin-bottom: 1.5rem; }
    .dev-id { font-family: monospace; font-size: 1.3rem; font-weight: 700; color: #fbbf24; }
    label { display: block; font-size: 0.85rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.35rem; }
    input, select, textarea { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0b0f19; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 0.95rem; margin-bottom: 1rem; }
    textarea { font-family: monospace; font-size: 0.75rem; resize: vertical; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #0ea5e9; }
    .btn { width: 100%; padding: 0.85rem; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
    .btn-copy { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 0.35rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; margin-top: 0.5rem; }
    .hint { font-size: 0.75rem; color: #64748b; margin-top: -0.65rem; margin-bottom: 1rem; }
  </style>
  <script>
    function copyDevId(btn) {
      var txt = document.getElementById('devIdText').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function() { btn.innerText = 'Copied!'; }).catch(function() { fallbackCopy(txt, btn); });
      } else {
        fallbackCopy(txt, btn);
      }
    }
    function fallbackCopy(txt, btn) {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); btn.innerText = 'Copied!'; } catch(e) {}
      document.body.removeChild(ta);
    }
  </script>
</head>
<body>
  <div class="card">
    <h2>DecaTone Hardware Setup</h2>
    <div class="dev-box">
      <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.25rem;">YOUR UNIQUE DEVICE ID:</div>
      <div class="dev-id" id="devIdText">)rawliteral" + safeDevId + R"rawliteral(</div>
      <button type="button" class="btn-copy" onclick="copyDevId(this)">Copy Device ID</button>
    </div>

    <form method="POST" action="/save">
      <div class="section-title">Network &amp; Server Connection</div>
      <label>WiFi Network Name (SSID)</label>
      <input type="text" name="ssid" required placeholder="Home WiFi" value=")rawliteral" + safeSsid + R"rawliteral(">

      <label>WiFi Password</label>
      <input type="password" name="password" placeholder=")rawliteral" + passPlaceholder + R"rawliteral(">

      <label>DecaTone Server Base URL</label>
      <input type="text" name="server" required placeholder="https://decatone.example.com" value=")rawliteral" + safeServer + R"rawliteral(">
      <div class="hint">Domain or IP without subpaths (e.g. https://phone.example.com or http://192.168.1.50:4000)</div>

      <label>Local Root CA Certificate PEM (Optional — for private LAN HTTPS)</label>
      <textarea name="local_ca_pem" rows="4" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----">)rawliteral" + safeLocalCa + R"rawliteral(</textarea>
      <div class="hint">Leave blank for Let's Encrypt/public HTTPS or automatic Local CA fetch during provisioning.</div>

      <div class="section-title">Hardware Builder Specification</div>
      <label>Telephone Model &amp; Chassis Profile</label>
      <select name="profile">
        <option value="western_electric_500">Western Electric 500 / 2500 (US Standard)</option>
        <option value="western_electric_302">Western Electric 302 / Metal Case (Antique US)</option>
        <option value="gpo_746">British GPO 706 / 746 (UK European)</option>
        <option value="kellogg_harmonic">Kellogg / Stromberg-Carlson (Harmonic Bells)</option>
        <option value="ericofon">Ericofon 'Cobra' (Buzzer/Electronic Ring)</option>
        <option value="custom">Custom / Other Retro Phone</option>
      </select>

      <label>Physical Bell AC Resonance Frequency</label>
      <select name="bellFreq">
        <option value="20.0">20.0 Hz (North American Standard - WE C4A)</option>
        <option value="16.6">16.6 Hz (North American Rural / Party Line)</option>
        <option value="25.0">25.0 Hz (European / British GPO Standard)</option>
        <option value="30.0">30.0 Hz (Kellogg Harmonic High-Pitch)</option>
        <option value="33.3">33.3 Hz (Kellogg Harmonic Mid-Pitch)</option>
        <option value="50.0">50.0 Hz (European Buzzer / Direct AC)</option>
      </select>

      <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
        <input type="checkbox" name="hookFlash" id="hfCheck" value="true" )rawliteral" + hfChecked + R"rawliteral( style="width: auto; margin-bottom: 0;">
        <label for="hfCheck" style="margin-bottom: 0; cursor: pointer; color: #fff;">Enable Hook-Flash Handset Call Transfer (~300ms tap)</label>
      </div>

      <button type="submit" class="btn">Save &amp; Provision Hardware</button>
    </form>
  </div>
</body>
</html>)rawliteral";

    request->send(200, "text/html", html);
  });

  // Handle Save Endpoint
  m_server->on("/save", HTTP_POST, [this](AsyncWebServerRequest *request) {
    String ssid = request->arg("ssid");
    ssid.trim();
    String pass = request->arg("password");
    String serverRaw = request->arg("server");
    String localCa = request->arg("local_ca_pem");
    localCa.trim();
    String profile = request->arg("profile");
    String bellFreqStr = request->arg("bellFreq");
    bool hookFlash = request->hasArg("hookFlash");

    if (ssid.length() == 0) {
      request->send(400, "text/html", "<h3>Configuration Error</h3><p>WiFi SSID is required.</p><a href='/'>Go Back</a>");
      return;
    }

    String urlError = "";
    String normalizedServer = normalizeServerUrl(serverRaw, urlError);
    if (urlError.length() > 0) {
      request->send(400, "text/html", "<h3>Configuration Error</h3><p>" + htmlEscape(urlError) + "</p><a href='/'>Go Back</a>");
      return;
    }

    // Preserve saved WiFi password if field left blank
    String effectivePass = (pass.length() == 0 && m_config.wifiPassword.length() > 0) ? m_config.wifiPassword : pass;
    float bellFreq = bellFreqStr.length() > 0 ? bellFreqStr.toFloat() : DEFAULT_BELL_FREQ_HZ;
    if (bellFreq < 10.0f || bellFreq > 60.0f) bellFreq = DEFAULT_BELL_FREQ_HZ;
    if (profile.length() == 0) profile = "western_electric_500";

    if (localCa.length() > 0 && localCa.indexOf("-----BEGIN CERTIFICATE-----") != -1) {
      setLocalCaPem(localCa);
    } else if (request->hasArg("local_ca_pem") && localCa.length() == 0) {
      setLocalCaPem("");
    }
    saveConfig(ssid, effectivePass, normalizedServer, profile, bellFreq, hookFlash);

    String successHtml = R"rawliteral(<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Saved</title>
<style>body{font-family:sans-serif;background:#0b0f17;color:#fff;text-align:center;padding:3rem;} .box{max-width:440px;margin:0 auto;background:#121826;padding:2rem;border-radius:12px;border:1px solid #10b981;} h2{color:#34d399;}</style>
</head>
<body>
  <div class="box">
    <h2>✅ Hardware Provisioned!</h2>
    <p>Connecting to WiFi and DecaTone switchboard...</p>
    <p>Lift your rotary phone handset once connected to hear your spoken pairing code!</p>
  </div>
  <script>setTimeout(() => { window.location.href = 'about:blank'; }, 5000);</script>
</body>
</html>)rawliteral";

    request->send(200, "text/html", successHtml);

    // Schedule non-blocking reboot so AsyncTCP flushes HTTP response cleanly
    m_pendingRestartAt = millis() + 1200;
    m_restartScheduled = true;
  });

  // Captive Portal Fallback
  m_server->onNotFound([](AsyncWebServerRequest *request) {
    request->redirect("http://192.168.4.1/");
  });

  m_server->begin();
  Serial.printf("[Provisioning] Captive Portal Started. SSID: '%s' (WPA2 Password: '%s'), IP: 192.168.4.1\n",
    apName.c_str(), AP_SETUP_PASSWORD);
}

void ProvisioningManager::saveConfig(
  const String& ssid,
  const String& pass,
  const String& serverUrl,
  const String& profile,
  float bellFreq,
  bool hookFlash
) {
  m_prefs.putString("wifi_ssid", ssid);
  m_prefs.putString("wifi_pass", pass);
  m_prefs.putString("server_url", serverUrl);
  m_prefs.putString("hw_profile", profile);
  m_prefs.putFloat("bell_freq", bellFreq);
  m_prefs.putBool("hook_flash", hookFlash);

  m_config.wifiSsid = ssid;
  m_config.wifiPassword = pass;
  m_config.serverBaseUrl = serverUrl;
  m_config.hardwareProfile = profile;
  m_config.bellFrequencyHz = bellFreq;
  m_config.hookFlashEnabled = hookFlash;
  m_config.isConfigured = true;
}

void ProvisioningManager::setDeviceToken(const String& token) {
  m_config.deviceToken = token;
  if (token.length() > 0) {
    m_prefs.putString("dev_token", token);
  } else {
    m_prefs.remove("dev_token");
  }
}

void ProvisioningManager::setWrappedVmKey(const String& wrappedVmKey) {
  m_config.wrappedVmKey = wrappedVmKey;
  if (wrappedVmKey.length() > 0) {
    m_prefs.putString("vm_wrap", wrappedVmKey);
  } else {
    m_prefs.remove("vm_wrap");
  }
}

void ProvisioningManager::setLocalCaPem(const String& pem) {
  m_config.localCaPem = pem;
  if (pem.length() > 0) {
    m_prefs.putString("local_ca_pem", pem);
  } else {
    m_prefs.remove("local_ca_pem");
  }
}

String ProvisioningManager::buildEffectiveCaBundle() const {
  if (m_config.localCaPem.length() > 0) {
    return m_config.localCaPem + "\n" + String(FPSTR(DECATONE_PUBLIC_CA_BUNDLE));
  }
  return String(FPSTR(DECATONE_PUBLIC_CA_BUNDLE));
}

bool ProvisioningManager::fetchAndPinLocalCa(const String& serverBaseUrl) {
  if (serverBaseUrl.length() < 8 || WiFi.status() != WL_CONNECTED) return false;
  String caUrl = serverBaseUrl;
  while (caUrl.endsWith("/")) caUrl = caUrl.substring(0, caUrl.length() - 1);
  caUrl += "/api/tls/ca.crt";

  Serial.printf("[Provisioning] Fetching Local Root CA from: %s\n", caUrl.c_str());

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure bootstrapClient;
  bool began = false;

  if (caUrl.startsWith("https://")) {
    // Explicit one-time TOFU fetch ONLY when NVS local_ca_pem is empty
    bootstrapClient.setInsecure();
    began = http.begin(bootstrapClient, caUrl);
  } else {
    began = http.begin(plainClient, caUrl);
  }

  if (!began) return false;
  http.setTimeout(5000);
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    return false;
  }

  String pem = http.getString();
  http.end();
  pem.trim();

  if (pem.length() < 120 || pem.length() > 4096 ||
      pem.indexOf("-----BEGIN CERTIFICATE-----") == -1 ||
      pem.indexOf("-----END CERTIFICATE-----") == -1) {
    Serial.println("[Provisioning] Rejecting invalid CA PEM payload from /api/tls/ca.crt");
    return false;
  }

  uint8_t digest[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  (void)mbedtls_sha256_starts(&ctx, 0);
  (void)mbedtls_sha256_update(&ctx, reinterpret_cast<const uint8_t*>(pem.c_str()), pem.length());
  (void)mbedtls_sha256_finish(&ctx, digest);
  mbedtls_sha256_free(&ctx);

  char hexFp[65];
  for (int i = 0; i < 32; i++) snprintf(hexFp + i * 2, 3, "%02x", digest[i]);
  hexFp[64] = '\0';

  setLocalCaPem(pem);
  Serial.printf("[Provisioning] Pinned Local Root CA in NVS (PEM SHA-256: %s)\n", hexFp);
  return true;
}

void ProvisioningManager::setBellFrequencyHz(float freqHz) {
  if (freqHz >= 10.0f && freqHz <= 60.0f) {
    m_config.bellFrequencyHz = freqHz;
    m_prefs.putFloat("bell_freq", freqHz);
  }
}

void ProvisioningManager::setHookFlashEnabled(bool enabled) {
  m_config.hookFlashEnabled = enabled;
  m_prefs.putBool("hook_flash", enabled);
}

void ProvisioningManager::setHardwareProfile(const String& profile) {
  if (profile.length() > 0) {
    m_config.hardwareProfile = profile;
    m_prefs.putString("hw_profile", profile);
  }
}

String ProvisioningManager::getDevicePublicKeyBase64() const {
  return E2eeCryptoManager::base64Encode(m_devPubKey, sizeof(m_devPubKey));
}

void ProvisioningManager::clearCredentialsPreserveIdentity() {
  // Explicitly preserve dev_id, dev_priv, and dev_pub across Wi-Fi / factory resets
  m_prefs.remove("wifi_ssid");
  m_prefs.remove("wifi_pass");
  m_prefs.remove("server_url");
  m_prefs.remove("local_ca_pem");
  m_prefs.remove("dev_token");
  m_prefs.remove("vm_wrap");

  m_config.wifiSsid = "";
  m_config.wifiPassword = "";
  m_config.serverBaseUrl = "";
  m_config.localCaPem = "";
  m_config.deviceToken = "";
  m_config.wrappedVmKey = "";
  m_config.isConfigured = false;
}

void ProvisioningManager::resetConfig() {
  clearCredentialsPreserveIdentity();
  delay(100);
  ESP.restart();
}

void ProvisioningManager::update() {
  if (m_isApMode && m_dnsServer) {
    m_dnsServer->processNextRequest();
  }

  if (m_restartScheduled && (int32_t)(millis() - m_pendingRestartAt) >= 0) {
    m_restartScheduled = false;
    Serial.println("[Provisioning] Rebooting to apply provisioned settings...");
    ESP.restart();
  }
}
