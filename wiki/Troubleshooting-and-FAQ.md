# Troubleshooting and FAQ

Common diagnostic questions, calibration tips, and solutions for the DecaTone system.

---

## 1. Hardware & Rotary Dial Issues

### Q: Dialed digits are occasionally miscounted (e.g. dialing 7 registers as 6 or 8).
- **Cause**: Dirty mechanical pulse contacts or governor spinning too fast/slow.
- **Fix**:
  1. Check **Phone Settings &rarr; Dial Diagnostics** to inspect the live **PPS (Pulses Per Second)**. Optimal speed is 9.0 to 11.0 PPS.
  2. If PPS is above 12.0 PPS (governor running fast), lubricate the dial gear train or adjust the centrifugal governor spring.
  3. Clean the gold/silver leaf contacts with contact cleaner or a slip of heavy paper soaked in isopropyl alcohol.
  4. Ensure `ROTARY_DEBOUNCE_MS` in `config.h` is set to 15ms.

### Q: The physical bell doesn't chime when a call comes in.
- **Cause**: Insufficient ringer supply voltage, incorrect resonant frequency, or mechanical clapper binding.
- **Fix**:
  1. Check your DC ringer power rail. Vintage ringers typically require 24V to 48V DC through the MOSFET circuit.
  2. Verify the 470nF 250V AC series capacitor is installed in line with the coils.
  3. Use **Phone Settings &rarr; Resonance Sweep** to sweep the ringing frequency from 15Hz to 30Hz in 0.5Hz steps. Find the frequency where the clapper strikes the gongs with maximum mechanical force.
  4. Adjust the gong eccentric mounting screws to bring the bells slightly closer to the clapper.

### Q: The earpiece volume is too quiet or noisy.
- **Cause**: Earpiece volume or microphone sensitivity needs adjustment, or vintage carbon granules have compacted.
- **Fix**:
  1. In the web portal, navigate to **Phone Settings &rarr; Audio DSP**.
  2. Adjust **Handset Earpiece Volume** (try 80%–90%) and **Microphone Sensitivity** (try 75%).
  3. DecaTone's real-time **Inbound Audio Normalization** will automatically level incoming caller volume to -18 dBFS.
  4. For the microphone, ensure the potentiometer on the back of the MAX4466 module is set to approximately 60% gain.

---

## 2. Networking & WebSocket Diagnostics

### Q: The ESP32-S3 cannot connect to the WebSocket switchboard.
- **Cause**: Incorrect server base URL, firewall blocking port 4000, or missing SSL reverse proxy.
- **Fix**:
  1. If using `https://`, ensure your domain has a valid SSL certificate (Let's Encrypt / Cloudflare). The ESP32 will connect securely using TLS over port 443.
  2. If using local IP (e.g. `http://192.168.1.100:4000`), ensure port 4000 is open in your server firewall.
  3. Verify the server is running by visiting `http://<server-ip>:4000/api/health`.

### Q: The phone disconnects when running test rings.
- **Cause**: Voltage sag on the ESP32 5V/3.3V rail when the high-voltage ringer circuit triggers.
- **Fix**:
  1. Ensure the high-voltage ringer supply (24V–48V) has a separate dedicated power supply and only shares a common ground with the ESP32.
  2. Add a 1000$\mu$F electrolytic capacitor across the high-voltage ringer rail to absorb current surges during bell strikes.

---

## 3. Telephony Operations FAQ

### Q: What is the Receiver Off-Hook Howler Siren?
- If a handset is accidentally left off its cradle for more than 15 seconds without dialing, DecaTone will first play a Fast Busy (Reorder) tone, followed at 30 seconds by a multi-frequency piercing siren (`1400Hz + 2060Hz + 2450Hz + 2600Hz` pulsed at 5Hz) alerting you that the line is off-hook. Replacing the handset or dialing any digit immediately stops the siren.

### Q: How does Do Not Disturb repeated call breakthrough work?
- If Do Not Disturb (DND) or quiet hours is active, any friend who calls twice within **3 minutes (180,000ms)** will break through quiet hours on their second attempt and ring the physical telephone bells. VIP friends always ring regardless of DND.
