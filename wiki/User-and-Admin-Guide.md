# User and Admin Operations Guide

This guide covers daily operation of the DecaTone web portal, managing contacts and friends, voicemail operations, Do Not Disturb scheduling, and administrative fleet management.

---

## 1. User Guide

### Dashboard & Web Switchboard
- View your extension, online hardware status, and hook state.
- **Interactive Rotary Dial Simulator**: Click or drag the vintage dial on screen to place calls, test numbers, or dial into service lines.
- **Recent Calls**: Full call history with direction indicators (incoming, outgoing, missed), caller ID, timestamps, and duration.
- **WebPhone Softphone**: Make and receive VoIP voice calls directly in your browser with DTMF keypad support.

### Friends, VIP Status & Distinctive Ringing
- Add friends by username or telephone extension.
- **VIP Status**: Mark close contacts as VIPs so their calls will always break through Do Not Disturb quiet hours.
- **Distinctive Ringing per Friend**: Choose a unique ring cadence per friend so you know who is calling before picking up the handset.

### Voicemail Studio
- **Listen & Screening**: Listen to voicemails in the browser or dial `0` from the physical phone.
- **Live Screening Intercept**: Pick up the handset and press `1` while a caller is leaving a voicemail to immediately intercept the call.
- **Custom Greeting Audio**: Record or upload custom voicemail greetings (WAV/MP3).

### Do Not Disturb (DND) Suite
- **Manual Toggle**: Switch DND on/off from the web portal or by picking up the physical phone and dialing `072` (Enable) or `073` (Disable).
- **Scheduled Quiet Hours**: Configure automated DND schedules by time range (e.g. 10:00 PM to 7:00 AM) and active days of the week.
- **Emergency Repeated Call Breakthrough**: When active, if a non-VIP friend calls twice within 3 minutes, their second call breaks through DND and rings the physical bells.

### Oscilloscope Rotary Dial Diagnostics
- View live **Pulses Per Second (PPS)** governor speed and **Break/Make Ratio %** under **Phone Settings &rarr; Dial Diagnostics**.
- Ensures vintage mechanical governors are running within optimal Bell System tolerances (9.0 – 11.0 PPS, 55% – 65% break ratio).

---

## 2. Admin Center Guide

Accessed via **Admin Center** in the top navigation bar (for accounts with the `admin` role):

1. **System Overview**: High-level metrics for registered users, active calls, voicemails, paired hardware phones, and storage utilization.
2. **User Management**: Edit roles, reset passwords, change assigned phone numbers, disable/enable accounts, and manage privacy flags.
3. **Hardware Fleet Inspector**: Live monitor of all ESP32-S3 devices across your network. Send remote test rings, issue remote reboots, inspect WiFi RSSI signal strength, and unpair devices.
4. **Firmware OTA Manager**: Upload compiled `firmware.bin` files and broadcast 1-click Over-The-Air updates to your entire fleet.
5. **Backups & Restore**: Create compressed `.tar.gz` database and upload archives, download backups, or perform safe restorations.
6. **System Self-Updater**: Check GitHub release channels (`stable`, `beta`, `alpha`) and trigger 1-click in-container updates.
7. **Settings & Whitelabeling**: Customize the platform title, upload a custom logo, set number assignment modes, and configure Home Assistant MQTT integration.
