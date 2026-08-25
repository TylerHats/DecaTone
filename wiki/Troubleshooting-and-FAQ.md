# Troubleshooting and FAQ

This document addresses common questions and troubleshooting steps for DecaTone hardware and software.

---

## 1. Hardware & Rotary Dial Issues

### Q: When I dial a number, the switchboard registers the wrong digit (e.g. dials '4' instead of '5').
- **Cause**: Contact bounce or dirty rotary switch contacts in the vintage telephone.
- **Solution**:
  1. Clean the rotary dial pulse contact leaves using electrical contact cleaner (DeoxIT) and an index card.
  2. In `firmware/src/config.h`, adjust `ROTARY_DEBOUNCE_MS` from `15` to `20` or `25` to filter out contact bounce.

---

### Q: The physical mechanical bell does not ring or only hums.
- **Cause**: Insufficient boost voltage or incorrect polarity/frequency.
- **Solution**:
  1. Check the boost converter voltage using a multimeter. Ensure it outputs at least **24V DC** (36V–48V DC is optimal for heavy Western Electric 500 gongs).
  2. Verify that the **~470nF film capacitor** is connected in parallel across the ringer coils.
  3. Ensure the **1N4007 flyback diode** is installed correctly (cathode to +24V, anode to MOSFET Drain).
  4. Ensure the common ground between the 5V logic supply and the boost converter is connected.

---

### Q: The phone does not detect when the handset is lifted off the cradle.
- **Cause**: Hook switch contacts miswired or inverted.
- **Solution**:
  1. Test continuity on the hook switch leaf contacts using a multimeter continuity mode.
  2. The switch should connect **GPIO 4 to GND** when the handset is lifted. If your phone's switch is normally closed instead of normally open, invert the logic check in `firmware/src/rotary_dial.cpp`.

---

## 2. Audio & Call Issues

### Q: I hear a loud buzz or humming in the handset earpiece.
- **Cause**: Ground loop or noise from the 5V power adapter.
- **Solution**:
  1. Use a clean, filtered 5V 2A+ power supply (such as an official Raspberry Pi or phone charger).
  2. Ensure the MAX98357A ground is wired directly to the ESP32-S3 GND pin.

---

### Q: Call audio is choppy over WiFi.
- **Cause**: High WiFi latency or weak signal strength (RSSI).
- **Solution**:
  1. Check the device RSSI in the Admin Fleet Inspector. If below -75 dBm, move the phone closer to the WiFi access point.
  2. Ensure your backend server is deployed with low round-trip latency to the phones.

---

## 3. Network & Docker Issues

### Q: How do I access DecaTone behind a reverse proxy?
- DecaTone has `app.set('trust proxy', 1)` enabled by default. Forward headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) and WebSocket upgrade headers (`Upgrade: websocket`, `Connection: Upgrade`) from your proxy.
