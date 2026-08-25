# DecaTone Wiki

Welcome to the official **DecaTone** documentation wiki. DecaTone is an open-source custom telephone switch and VoIP hardware system designed to revive vintage rotary telephones by replacing their internal control systems with an **ESP32-S3** microcontroller and linking them to a self-hosted cloud switchboard.

---

## 📖 Wiki Navigation

1. **[Hardware Wiring and Pinouts](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/Hardware-Wiring-and-Pinouts.md)**
   - Hosyond ESP32-S3 pin mappings, hook switch, rotary pulse decoding, MAX98357A I2S DAC, MAX4466 mic ADC, and IRF640N resonant bell ringer circuit.
2. **[Firmware Flashing and Setup](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/Firmware-Flashing-and-Setup.md)**
   - Initial flashing via PlatformIO / Arduino IDE / esptool, captive portal provisioning (`DecaTone-Setup-XXXX`), and OTA remote updates.
3. **[Backend and Docker Deployment](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/Backend-and-Docker-Deployment.md)**
   - Docker Compose installation, Let's Encrypt SSL configuration, reverse proxy setup (Nginx, Traefik, Caddy, Cloudflare).
4. **[Phone Numbering and Routing](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/Phone-Numbering-and-Routing.md)**
   - Extension length configuration, area code support, single-digit speed dial (1–9), and call privacy filtering.
5. **[Audio and Bell Ringer Tuning](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/Audio-and-Bell-Ringer-Tuning.md)**
   - Tuning earpiece volume, microphone gain, 20Hz bell ringing resonance, and custom cadence patterns.
6. **[User and Admin Guide](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/User-and-Admin-Guide.md)**
   - User onboarding, friend requests, voicemail studio, and admin fleet management.
7. **[Troubleshooting and FAQ](file:///home/tylerhats/Documents/GitHub/DecaTone/wiki/Troubleshooting-and-FAQ.md)**
   - Common gotchas, pulse bounce debouncing, bell ringer power tuning, and network diagnostics.

---

## 🚀 Quick Overview

- **Target Microcontroller**: Hosyond ESP32-S3-WROOM-1 (8MB Octal PSRAM, 16MB Flash).
- **Backend Architecture**: Node.js 20, TypeScript, SQLite3 (WAL mode), WebSocket VoIP engine.
- **Frontend**: React 18, Vite, Lucide Icons, Pure Custom CSS Design System.
- **Container Registry**: [`tylerhats/decatone`](https://hub.docker.com/repository/docker/tylerhats/decatone/general).
