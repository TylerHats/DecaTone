const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = 4001;
const SWITCHBOARD_WS = 'ws://localhost:4000/ws/phone';

// Simulated Hardware State
const hardware = {
  deviceId: 'ESP32S3_SIM_500',
  macAddress: 'E0:5A:1B:A4:7C:99',
  ipAddress: '127.0.0.1',
  firmwareVersion: '1.2.2',
  rssi: -52,
  hookState: 'on_hook', // 'on_hook' or 'off_hook'
  isRinging: false,
  ringCadence: 'traditional',
  bellFrequency: 20.0,
  pairingWord: '---',
  pairingCode: '---',
  connected: false,
  logs: []
};

function addLog(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 8);
  const logLine = `[${ts}] ${msg}`;
  hardware.logs.unshift(logLine);
  if (hardware.logs.length > 100) hardware.logs.pop();
  console.log(`[ESP32 Simulator] ${logLine}`);
}

let wsClient = null;
let reconnectTimer = null;

function connectToSwitchboard() {
  if (wsClient) {
    try { wsClient.terminate(); } catch (e) {}
  }

  addLog(`Connecting to DecaTone switchboard at ${SWITCHBOARD_WS}...`);
  wsClient = new WebSocket(SWITCHBOARD_WS);

  wsClient.on('open', () => {
    hardware.connected = true;
    addLog(`Connected to switchboard! Sending ESP32-S3 registration...`);
    
    wsClient.send(JSON.stringify({
      type: 'register',
      deviceId: hardware.deviceId,
      macAddress: hardware.macAddress,
      firmwareVersion: hardware.firmwareVersion,
      rssi: hardware.rssi,
      ipAddress: hardware.ipAddress
    }));
  });

  wsClient.on('message', (data, isBinary) => {
    if (isBinary) {
      // Binary Audio Stream from switchboard
      return;
    }

    try {
      const msg = JSON.parse(data.toString());
      addLog(`Received command from server: ${JSON.stringify(msg)}`);

      if (msg.type === 'ring') {
        hardware.isRinging = !!msg.active;
        if (msg.cadence) hardware.ringCadence = msg.cadence;
        if (msg.frequency) hardware.bellFrequency = msg.frequency;
        addLog(hardware.isRinging ? `🔔 Physical Bells Ringing (${hardware.bellFrequency}Hz, ${hardware.ringCadence})` : '🔕 Bells Stopped Ringing');
      } else if (msg.type === 'pairing_info') {
        hardware.pairingWord = msg.word;
        hardware.pairingCode = msg.code;
        addLog(`📢 Spoken Pairing Code Assigned: WORD="${msg.word}", CODE="${msg.code}"`);
      } else if (msg.type === 'ota_available') {
        addLog(`⚡ OTA Firmware Update Available: Version ${msg.version} at ${msg.binaryUrl}`);
      } else if (msg.type === 'reboot') {
        addLog(`🔄 Reboot command received. Simulating ESP32 restart...`);
        setTimeout(() => {
          connectToSwitchboard();
        }, 1500);
      }
    } catch (e) {
      addLog(`Failed to parse text message: ${e.message}`);
    }
  });

  wsClient.on('close', () => {
    hardware.connected = false;
    hardware.isRinging = false;
    addLog(`Disconnected from switchboard. Retrying in 3s...`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectToSwitchboard, 3000);
  });

  wsClient.on('error', (err) => {
    addLog(`WebSocket error: ${err.message}`);
  });
}

// Hardware Actions
function setHookState(state) {
  hardware.hookState = state;
  addLog(`Handset transitioned to: ${state.toUpperCase()}`);
  if (state === 'off_hook') {
    hardware.isRinging = false;
  }
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({
      type: 'hook',
      state: state
    }));
  }
}

function dialDigit(digit) {
  if (hardware.hookState !== 'off_hook') {
    addLog(`Cannot dial digit ${digit}: Handset is ON-HOOK (Must lift handset first!)`);
    return false;
  }

  const pps = 10.0 + (Math.random() * 0.4 - 0.2); // ~10.0 PPS
  const breakRatio = 60.0 + (Math.random() * 2 - 1); // ~60%
  addLog(`Rotary Pulse: Dialed Digit [${digit}] (Governor: ${pps.toFixed(1)} PPS, Break: ${breakRatio.toFixed(1)}%)`);

  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({
      type: 'dial_digit',
      digit: parseInt(digit, 10),
      pps: parseFloat(pps.toFixed(1)),
      breakRatio: parseFloat(breakRatio.toFixed(1))
    }));
  }
  return true;
}

function hookFlash() {
  if (hardware.hookState !== 'off_hook') return;
  addLog(`Hook Flash: Cradle tapped (150ms break pulse)`);
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({ type: 'hook_flash' }));
  }
}

// HTTP Server & Interactive Web Simulator UI
const server = http.createServer((req, res) => {
  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hardware));
    return;
  }

  if (req.url === '/api/action/hook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      setHookState(data.state || (hardware.hookState === 'on_hook' ? 'off_hook' : 'on_hook'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, hookState: hardware.hookState }));
    });
    return;
  }

  if (req.url === '/api/action/dial' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      const success = dialDigit(data.digit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success, digit: data.digit }));
    });
    return;
  }

  if (req.url === '/api/action/flash' && req.method === 'POST') {
    hookFlash();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Serve Single-Page Interactive Simulator Web UI
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DecaTone ESP32-S3 Hardware Phone Simulator</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #090d16;
      --card: #121826;
      --border: #1e293b;
      --cyan: #06b6d4;
      --amber: #f59e0b;
      --green: #10b981;
      --red: #ef4444;
      --text: #f8fafc;
      --text-dim: #94a3b8;
      --font-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, sans-serif;
      padding: 1.5rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      max-width: 900px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .title {
      font-size: 1.5rem;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .connected { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .disconnected { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .card-title {
      font-size: 1.1rem;
      color: var(--cyan);
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .device-info {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
      background: rgba(0,0,0,0.3);
      padding: 1rem;
      border-radius: 8px;
    }
    .info-label { color: var(--text-dim); }
    .info-val { font-family: var(--font-mono); color: #fff; font-weight: 600; }
    
    .hook-btn {
      width: 100%;
      padding: 1.25rem;
      border: none;
      border-radius: 8px;
      font-size: 1.15rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      transition: all 0.2s;
    }
    .on-hook { background: #334155; color: #fff; }
    .on-hook:hover { background: #475569; }
    .off-hook { background: var(--amber); color: #000; box-shadow: 0 0 20px rgba(245, 158, 11, 0.4); }
    
    .dial-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      margin-top: 1rem;
    }
    .dial-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: #fff;
      font-size: 1.35rem;
      font-family: var(--font-mono);
      font-weight: 700;
      padding: 1rem 0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .dial-btn:hover:not(:disabled) {
      background: var(--cyan);
      color: #000;
      border-color: var(--cyan);
      transform: scale(1.05);
    }
    .dial-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    .bell-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
      font-weight: 700;
      font-size: 1.1rem;
      transition: all 0.2s;
    }
    .bell-silent { background: rgba(255,255,255,0.02); color: var(--text-dim); border: 1px dashed var(--border); }
    .bell-ringing {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border: 1px solid var(--red);
      animation: bellPulse 0.4s infinite alternate;
    }
    @keyframes bellPulse {
      from { box-shadow: 0 0 10px rgba(239,68,68,0.3); transform: scale(1); }
      to { box-shadow: 0 0 25px rgba(239,68,68,0.8); transform: scale(1.02); }
    }
    
    .console {
      background: #050811;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      height: 250px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: #38bdf8;
      display: flex;
      flex-direction: column-reverse;
      line-height: 1.5;
    }
    .log-line { border-bottom: 1px solid rgba(255,255,255,0.03); padding: 0.2rem 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">
        <span>📟 DecaTone ESP32-S3 Hardware Phone Simulator</span>
      </div>
      <div id="connBadge" class="status-badge disconnected">Connecting...</div>
    </div>

    <div class="grid">
      <!-- 1. Physical Hardware Console -->
      <div class="card">
        <div class="card-title">
          <span>Western Electric 500 Test Bench</span>
          <span style="font-size: 0.8rem; color: var(--text-dim);">GPIO 4/5/7</span>
        </div>

        <div class="device-info">
          <div><span class="info-label">Device ID:</span> <span id="devId" class="info-val">---</span></div>
          <div><span class="info-label">MAC:</span> <span id="macAddr" class="info-val">---</span></div>
          <div><span class="info-label">Firmware:</span> <span id="fwVer" class="info-val">v1.2.2</span></div>
          <div><span class="info-label">WiFi RSSI:</span> <span id="rssi" class="info-val">-52 dBm</span></div>
          <div><span class="info-label">Pairing Word:</span> <span id="pairWord" class="info-val" style="color: var(--amber)">---</span></div>
          <div><span class="info-label">Pairing Code:</span> <span id="pairCode" class="info-val" style="color: var(--amber)">---</span></div>
        </div>

        <!-- Handset Cradle Control -->
        <button id="hookBtn" class="hook-btn on-hook" onclick="toggleHook()">
          <span>📞 Handset On-Hook (Idle) &bull; Click to Lift</span>
        </button>

        <!-- Bell Ringer Visualizer -->
        <div id="bellBox" class="bell-indicator bell-silent">
          <span>🔕 Mechanical Bells Idle</span>
        </div>

        <!-- Hook Flash Button -->
        <button onclick="sendFlash()" id="flashBtn" disabled class="btn" style="width: 100%; margin-top: 0.75rem; padding: 0.6rem; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.85rem;">
          ⚡ Tap Cradle (Hook Flash 150ms)
        </button>
      </div>

      <!-- 2. Rotary Pulse Dial Simulator -->
      <div class="card">
        <div class="card-title">
          <span>Rotary Pulse Governor (10.0 PPS)</span>
          <span id="dialStateHint" style="font-size: 0.8rem; color: var(--amber);">Lift Handset to Dial</span>
        </div>

        <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 0.75rem;">
          Click numbers to pulse dial. Standard speed lines: <strong>111</strong> (Ringback), <strong>119</strong> (Echo), <strong>411</strong> (Clock), <strong>0</strong> (Voicemail).
        </p>

        <div class="dial-grid">
          <button class="dial-btn" onclick="dial(1)" disabled>1</button>
          <button class="dial-btn" onclick="dial(2)" disabled>2</button>
          <button class="dial-btn" onclick="dial(3)" disabled>3</button>
          <button class="dial-btn" onclick="dial(4)" disabled>4</button>
          <button class="dial-btn" onclick="dial(5)" disabled>5</button>
          <button class="dial-btn" onclick="dial(6)" disabled>6</button>
          <button class="dial-btn" onclick="dial(7)" disabled>7</button>
          <button class="dial-btn" onclick="dial(8)" disabled>8</button>
          <button class="dial-btn" onclick="dial(9)" disabled>9</button>
          <button class="dial-btn" style="grid-column: 2;" onclick="dial(0)" disabled>0</button>
        </div>
      </div>
    </div>

    <!-- 3. ESP32 UART Serial Console -->
    <div class="card">
      <div class="card-title">
        <span>ESP32-S3 UART Serial Monitor (115,200 baud)</span>
        <span style="font-size: 0.8rem; color: var(--text-dim);">Live WebSocket Telemetry</span>
      </div>
      <div id="consoleLog" class="console">
        <!-- Log entries injected here -->
      </div>
    </div>
  </div>

  <!-- Web Audio Synthesizer for Bell Ringer Sound -->
  <script>
    let audioCtx = null;
    let ringOsc = null;
    let ringInterval = null;

    function initAudio() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    function playBellChime() {
      if (!audioCtx) initAudio();
      try {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc1.frequency.setValueAtTime(850, audioCtx.currentTime);
        osc2.frequency.setValueAtTime(1020, audioCtx.currentTime);

        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(audioCtx.currentTime + 0.35);
        osc2.stop(audioCtx.currentTime + 0.35);
      } catch (e) {}
    }

    let isRingingState = false;
    function handleRingingSound(active) {
      if (active && !isRingingState) {
        isRingingState = true;
        playBellChime();
        ringInterval = setInterval(playBellChime, 600);
      } else if (!active && isRingingState) {
        isRingingState = false;
        clearInterval(ringInterval);
      }
    }

    async function fetchState() {
      try {
        const res = await fetch('/api/state');
        const data = await res.json();

        // Connection
        const badge = document.getElementById('connBadge');
        if (data.connected) {
          badge.className = 'status-badge connected';
          badge.textContent = '● Switchboard Connected';
        } else {
          badge.className = 'status-badge disconnected';
          badge.textContent = '○ Disconnected';
        }

        // Info
        document.getElementById('devId').textContent = data.deviceId;
        document.getElementById('macAddr').textContent = data.macAddress;
        document.getElementById('fwVer').textContent = 'v' + data.firmwareVersion;
        document.getElementById('rssi').textContent = data.rssi + ' dBm';
        document.getElementById('pairWord').textContent = data.pairingWord || '---';
        document.getElementById('pairCode').textContent = data.pairingCode || '---';

        // Hook State
        const hookBtn = document.getElementById('hookBtn');
        const dialBtns = document.querySelectorAll('.dial-btn');
        const flashBtn = document.getElementById('flashBtn');
        const dialHint = document.getElementById('dialStateHint');

        if (data.hookState === 'off_hook') {
          hookBtn.className = 'hook-btn off-hook';
          hookBtn.innerHTML = '<span>🔊 Handset Lifted (Off-Hook) &bull; Click to Hang Up</span>';
          dialBtns.forEach(b => b.disabled = false);
          flashBtn.disabled = false;
          dialHint.textContent = 'Dial Tone Active (Ready to Dial)';
          dialHint.style.color = 'var(--green)';
        } else {
          hookBtn.className = 'hook-btn on-hook';
          hookBtn.innerHTML = '<span>📞 Handset On-Hook (Idle) &bull; Click to Lift</span>';
          dialBtns.forEach(b => b.disabled = true);
          flashBtn.disabled = true;
          dialHint.textContent = 'Lift Handset to Dial';
          dialHint.style.color = 'var(--amber)';
        }

        // Bells
        const bellBox = document.getElementById('bellBox');
        if (data.isRinging) {
          bellBox.className = 'bell-indicator bell-ringing';
          bellBox.innerHTML = '<span>🔔 INCOMING CALL &bull; BELLS RINGING (' + data.bellFrequency + 'Hz)</span>';
          handleRingingSound(true);
        } else {
          bellBox.className = 'bell-indicator bell-silent';
          bellBox.innerHTML = '<span>🔕 Mechanical Bells Idle</span>';
          handleRingingSound(false);
        }

        // Logs
        const consoleEl = document.getElementById('consoleLog');
        consoleEl.innerHTML = data.logs.map(l => '<div class="log-line">' + l + '</div>').join('');

      } catch (e) {}
    }

    async function toggleHook() {
      initAudio();
      await fetch('/api/action/hook', { method: 'POST' });
      fetchState();
    }

    async function dial(digit) {
      initAudio();
      await fetch('/api/action/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digit })
      });
      fetchState();
    }

    async function sendFlash() {
      await fetch('/api/action/flash', { method: 'POST' });
      fetchState();
    }

    setInterval(fetchState, 1000);
    fetchState();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => {
  addLog(`ESP32-S3 Hardware Phone Simulator running at http://localhost:${PORT}`);
  connectToSwitchboard();
});
