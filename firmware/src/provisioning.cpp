#include "provisioning.h"

ProvisioningManager Provisioning;

String ProvisioningManager::generateUniqueDeviceId() {
  uint64_t chipid = ESP.getEfuseMac();
  char devId[20];
  snprintf(devId, sizeof(devId), "DT-%04X%08X", (uint16_t)(chipid >> 32), (uint32_t)chipid);
  return String(devId);
}

String ProvisioningManager::normalizeServerUrl(String rawUrl, String& outError) {
  outError = "";
  rawUrl.trim();

  // Strip trailing slashes
  while (rawUrl.endsWith("/")) {
    rawUrl = rawUrl.substring(0, rawUrl.length() - 1);
  }

  // Remove protocol for validation
  String withoutProto = rawUrl;
  bool isHttps = false;

  if (withoutProto.startsWith("https://")) {
    withoutProto = withoutProto.substring(8);
    isHttps = true;
  } else if (withoutProto.startsWith("http://")) {
    withoutProto = withoutProto.substring(7);
    isHttps = false;
  }

  // Check for invalid subdirectories (e.g. site.com/page/sub)
  int slashIdx = withoutProto.indexOf('/');
  if (slashIdx != -1) {
    outError = "Base URL must not contain subpaths or subdirectories (e.g. use 'phone.example.com' instead of 'site.com/page')";
    return "";
  }

  if (withoutProto.length() < 3) {
    outError = "Invalid server domain or IP address";
    return "";
  }

  // Rebuild normalized URL with proper protocol
  return (isHttps ? "https://" : "http://") + withoutProto;
}

void ProvisioningManager::begin() {
  m_prefs.begin(NVS_NAMESPACE, false);

  m_config.deviceId = m_prefs.getString("dev_id", "");
  if (m_config.deviceId.length() == 0) {
    m_config.deviceId = generateUniqueDeviceId();
    m_prefs.putString("dev_id", m_config.deviceId);
  }

  m_config.wifiSsid = m_prefs.getString("wifi_ssid", "");
  m_config.wifiPassword = m_prefs.getString("wifi_pass", "");
  m_config.serverBaseUrl = m_prefs.getString("server_url", "");
  m_config.hardwareProfile = m_prefs.getString("hw_profile", "western_electric_500");
  m_config.bellFrequencyHz = m_prefs.getFloat("bell_freq", DEFAULT_BELL_FREQ_HZ);
  m_config.hookFlashEnabled = m_prefs.getBool("hook_flash", true);
  m_config.isConfigured = (m_config.wifiSsid.length() > 0 && m_config.serverBaseUrl.length() > 0);

  // Check if forced setup triggered by Boot button or missing configuration
  bool forceAp = (digitalRead(PIN_BOOT_BUTTON) == LOW);

  if (!m_config.isConfigured || forceAp) {
    startCaptivePortal();
  } else {
    Serial.printf("[Provisioning] Loaded config: SSID='%s', Server='%s', DeviceID='%s', HW='%s', BellFreq=%.1fHz\n",
      m_config.wifiSsid.c_str(), m_config.serverBaseUrl.c_str(), m_config.deviceId.c_str(),
      m_config.hardwareProfile.c_str(), m_config.bellFrequencyHz);
  }
}

void ProvisioningManager::startCaptivePortal() {
  m_isApMode = true;
  WiFi.mode(WIFI_AP_STA);

  String apName = "DecaTone-Setup-" + m_config.deviceId.substring(m_config.deviceId.length() - 4);
  WiFi.softAP(apName.c_str());

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  m_dnsServer = new DNSServer();
  m_dnsServer->start(53, "*", apIP);

  m_server = new AsyncWebServer(80);

  // Captive Portal HTML Setup UI (Hardware Builder & WiFi Configuration)
  m_server->on("/", HTTP_GET, [this](AsyncWebServerRequest *request) {
    String devId = m_config.deviceId;
    String html = R"rawliteral(
<!DOCTYPE html>
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
    input, select { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0b0f19; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 0.95rem; margin-bottom: 1rem; }
    input:focus, select:focus { outline: none; border-color: #0ea5e9; }
    .btn { width: 100%; padding: 0.85rem; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
    .btn-copy { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 0.35rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; margin-top: 0.5rem; }
    .hint { font-size: 0.75rem; color: #64748b; margin-top: -0.65rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>☎️ DecaTone Hardware Setup</h2>
    <div class="dev-box">
      <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.25rem;">YOUR UNIQUE DEVICE ID:</div>
      <div class="dev-id" id="devIdText">)rawliteral" + devId + R"rawliteral(</div>
      <button type="button" class="btn-copy" onclick="navigator.clipboard.writeText(')rawliteral" + devId + R"rawliteral('); this.innerText='Copied!';">Copy Device ID</button>
    </div>

    <form method="POST" action="/save">
      <div class="section-title">📡 Network & Server Connection</div>
      <label>WiFi Network Name (SSID)</label>
      <input type="text" name="ssid" required placeholder="Home WiFi" value=")rawliteral" + m_config.wifiSsid + R"rawliteral(">

      <label>WiFi Password</label>
      <input type="password" name="password" placeholder="WiFi Password" value=")rawliteral" + m_config.wifiPassword + R"rawliteral(">

      <label>DecaTone Server Base URL</label>
      <input type="text" name="server" required placeholder="https://decatone.example.com" value=")rawliteral" + m_config.serverBaseUrl + R"rawliteral(">
      <div class="hint">Domain or IP without subpaths (e.g. decatone.example.com or 192.168.1.100:4000)</div>

      <div class="section-title">⚙️ Hardware Builder Specification</div>
      <label>Telephone Model & Chassis Profile</label>
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
        <input type="checkbox" name="hookFlash" id="hfCheck" value="true" checked style="width: auto; margin-bottom: 0;">
        <label for="hfCheck" style="margin-bottom: 0; cursor: pointer; color: #fff;">Enable Hook-Flash Handset Call Transfer (~300ms tap)</label>
      </div>

      <button type="submit" class="btn">Save & Provision Hardware</button>
    </form>
  </div>
</body>
</html>
    request->send(200, "text/html", html);
  });

  // Handle Save Endpoint
  m_server->on("/save", HTTP_POST, [this](AsyncWebServerRequest *request) {
    String ssid = request->arg("ssid");
    String pass = request->arg("password");
    String serverRaw = request->arg("server");
    String profile = request->arg("profile");
    String bellFreqStr = request->arg("bellFreq");
    bool hookFlash = request->hasArg("hookFlash");

    String urlError = "";
    String normalizedServer = normalizeServerUrl(serverRaw, urlError);

    if (urlError.length() > 0) {
      request->send(400, "text/html", "<h3>Configuration Error</h3><p>" + urlError + "</p><a href='/'>Go Back</a>");
      return;
    }

    float bellFreq = bellFreqStr.length() > 0 ? bellFreqStr.toFloat() : 20.0f;
    if (profile.length() == 0) profile = "western_electric_500";

    saveConfig(ssid, pass, normalizedServer, profile, bellFreq, hookFlash);

    String successHtml = R"rawliteral(
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Saved</title>
<style>body{font-family:sans-serif;background:#0b0f17;color:#fff;text-align:center;padding:3rem;} .box{max-width:440px;margin:0 auto;background:#121826;padding:2rem;border-radius:12px;border:1px solid #10b981;} h2{color:#34d399;}</style>
</head>
<body>
  <div class="box">
    <h2>✅ Hardware Provisioned!</h2>
    <p>Connecting to WiFi and DecaTone switchboard...</p>
    <p>You can now return to your DecaTone web portal and pair your rotary phone!</p>
  </div>
  <script>setTimeout(() => { window.location.href = 'about:blank'; }, 5000);</script>
</body>
</html>
)rawliteral";

    request->send(200, "text/html", successHtml);

    // Schedule reboot to apply settings
    delay(1500);
    ESP.restart();
  });

  // Captive Portal Fallback
  m_server->onNotFound([](AsyncWebServerRequest *request) {
    request->redirect("http://192.168.4.1/");
  });

  m_server->begin();
  Serial.printf("[Provisioning] Captive Portal Started. AP: '%s', IP: 192.168.4.1\n", apName.c_str());
}

void ProvisioningManager::saveConfig(const String& ssid, const String& pass, const String& serverUrl, const String& profile, float bellFreq, bool hookFlash) {
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

void ProvisioningManager::resetConfig() {
  m_prefs.clear();
  ESP.restart();
}

DeviceConfig ProvisioningManager::getConfig() {
  return m_config;
}

bool ProvisioningManager::isSetupActive() const {
  return m_isApMode;
}

void ProvisioningManager::update() {
  if (m_isApMode && m_dnsServer) {
    m_dnsServer->processNextRequest();
  }
}
