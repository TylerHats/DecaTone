# Firmware Flashing and Setup

This guide details how to flash the initial DecaTone firmware onto your Hosyond ESP32-S3 board and complete captive portal provisioning.

---

## 1. Initial Flashing Methods

### Option A: Using PlatformIO (Recommended)
1. Open the project root in VS Code or your terminal.
2. Navigate into the `firmware/` directory:
   ```bash
   cd firmware
   ```
3. Connect your Hosyond ESP32-S3 board to your computer via the **UART / USB-C** port.
4. Build and upload the firmware:
   ```bash
   pio run --target upload
   ```
5. Open the serial monitor:
   ```bash
   pio device monitor -b 115200
   ```

---

### Option B: Using Arduino IDE
1. Install **ESP32 by Espressif Systems** (version >= 2.0.14 or 3.x) in the Arduino Boards Manager.
2. Select Board: **ESP32S3 Dev Module**.
3. Configure the following Board Settings in the Tools menu:
   - **Flash Size**: `16MB (128Mb)`
   - **Partition Scheme**: `16M Flash (3MB APP/9.9MB FATFS)` or `Default 16MB`
   - **PSRAM**: `OPI PSRAM` (Crucial for 8MB PSRAM on Hosyond board)
   - **USB Mode**: `Hardware CDC and JTAG`
   - **USB CDC On Boot**: `Enabled`
4. Install required libraries from Library Manager:
   - `WebSockets` by Markus Sattler
   - `ArduinoJson` (v7.x) by Benoit Blanchon
   - `ESPAsyncWebServer` & `AsyncTCP`
5. Open `firmware/src/main.cpp`, compile, and flash.

---

### Option C: Using esptool.py (Direct Binary Flashing)
If you have a compiled `firmware.bin`:
```bash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 write_flash -z 0x10000 firmware.bin
```

---

## 2. Captive Portal Provisioning

1. When the board boots up without saved WiFi credentials (or if you hold the **Boot Button / GPIO 0** for 5 seconds), it starts a SoftAP.
2. Connect your smartphone or computer to the WiFi network:
   - **SSID**: `DecaTone-Setup-XXXX` (where `XXXX` is your device's unique suffix)
   - **Password**: None / Open (or `rotary123`)
3. Open your browser and navigate to:
   - **IP Address**: `http://192.168.4.1`
4. On the setup page:
   - Select or enter your **Home WiFi SSID**.
   - Enter your **WiFi Password**.
   - Enter your **DecaTone Server Base URL** (e.g. `decatone.hatsthings.com` or `https://phone.myserver.com`).
   - Copy your **Unique Device ID** (e.g. `DT-A1B2C3D4`).
   - Click **Save & Connect Phone**.
5. The ESP32-S3 will reboot, connect to your WiFi, and register with your DecaTone switchboard.

---

## 3. Over-The-Air (OTA) Remote Updates

Once initial flashing is complete, you never need to plug a USB cable into your phone again:
1. When you compile a new `firmware.bin`, navigate to the **Admin Center &rarr; Firmware OTA** tab in the DecaTone web portal.
2. Enter the new version number (e.g. `1.1.0`) and upload `firmware.bin`.
3. DecaTone will broadcast the OTA update notification to all connected ESP32-S3 phones over WebSockets.
4. Each phone will download the update over HTTP, write it to its secondary flash partition, and reboot automatically.
