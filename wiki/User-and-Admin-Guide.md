# User and Admin Guide

This guide covers daily operation of the DecaTone web portal, placing calls, sending friend requests, and administrative tasks.

---

## 1. User Guide

### Dashboard & Switchboard
- View your assigned extension and the live online/hook state of your paired ESP32-S3 rotary phone.
- **Interactive Rotary Dial Simulator**: Rotate or click numbers directly on the on-screen vintage dial to place calls or test pulses.
- **Recent Calls**: View incoming, outgoing, and missed calls with timestamps and duration.

### Making and Receiving Calls
1. **Calling from the Physical Phone**:
   - Lift the handset off the cradle. You will hear an authentic 350Hz+440Hz dial tone.
   - Turn the rotary dial to input the desired extension (or speed dial digit 1–9).
   - Once dialed, the dial tone stops and you will hear a ringback tone until the recipient answers.
2. **Receiving a Call**:
   - When a call comes in, your physical mechanical bells will chime according to your configured ring style.
   - Lift the handset to answer. Two-way encrypted audio starts immediately.
   - Replace the handset on the cradle to hang up.

### Friends & Speed Dial
- Search for other users by username or extension to send friend requests.
- Assign favorite contacts to rotary digits **1 through 9** for single-digit speed dialing.

### Voicemail Studio
- Listen to voicemails directly in your browser or by lifting your handset and dialing `0`.
- Record or upload custom greeting audio (MP3/WAV) to welcome callers when you are away.

---

## 2. Admin Center Guide

Accessed via **Admin Center** in the top navigation bar (for users with the `admin` role):

1. **System Metrics**: Real-time summary of registered users, connected hardware phones, call logs, voicemails, and storage usage.
2. **User Management**: Edit roles, reset passwords, change user extensions, disable/enable accounts, or delete accounts.
3. **Hardware Fleet Inspector**: Live monitor of all ESP32-S3 devices across your network. Send remote test rings, issue remote reboots, or unpair devices.
4. **Firmware OTA Manager**: Upload new compiled `firmware.bin` files and broadcast OTA updates to all phones in your fleet.
5. **Backups & Restore**: Create full compressed `.tar.gz` archives, download backups, or perform schema-safe database restorations.
6. **System Self-Updater**: Check GitHub release channels (`stable`, `beta`, `alpha`) and trigger 1-click in-container updates.
7. **Settings & Whitelabeling**: Customize the platform name, upload a custom logo, configure extension lengths and area codes, and review SSL / reverse proxy diagnostics.
