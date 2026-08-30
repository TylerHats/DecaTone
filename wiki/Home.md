# DecaTone Documentation Wiki

Welcome to the official **DecaTone V1.0** documentation wiki. DecaTone is an open-source private telephone switch and VoIP hardware system designed to revive vintage rotary telephones by replacing their internal electromechanical central-office circuitry with an **ESP32-S3** microcontroller and linking them to a self-hosted cloud switchboard.

---

## 📖 Wiki Navigation

1. **[Hardware Wiring and Pinouts](Hardware-Wiring-and-Pinouts.md)**
   - Hosyond ESP32-S3 pin mappings, hook switch detection, rotary pulse decoding, MAX98357A I2S DAC, MAX4466 mic ADC, and IRF640N resonant AC bell ringer circuit.
2. **[Firmware Flashing and Setup](Firmware-Flashing-and-Setup.md)**
   - Initial flashing via PlatformIO / esptool, captive portal provisioning (`DecaTone-Setup-XXXX`), dynamic power-saving frequency scaling, and OTA remote updates.
3. **[Backend and Docker Deployment](Backend-and-Docker-Deployment.md)**
   - Docker Compose installation, Let's Encrypt SSL configuration, reverse proxy setup (Nginx, Traefik, Caddy, Cloudflare), and Home Assistant MQTT integration.
4. **[Phone Numbering, Routing and Dial Codes](Phone-Numbering-and-Routing.md)**
   - Extension allocation, area codes, single-digit speed dial (1–9), in-call keypad commands (`0`, `1`, `2`, `3+ext`), `0XX` off-hook control codes, and call privacy filtering.
5. **[Audio Normalization and Bell Ringer Tuning](Audio-and-Bell-Ringer-Tuning.md)**
   - Real-time inbound audio normalization, outbound mic AGC, acoustic vintage DSP filters, 20Hz bell ringing resonance sweep, and cadence patterns.
6. **[User and Admin Operations Guide](User-and-Admin-Guide.md)**
   - User onboarding, friend requests, VIP friend designation, voicemail studio, DND quiet hours schedules, and admin fleet management.
7. **[Troubleshooting and FAQ](Troubleshooting-and-FAQ.md)**
   - Common gotchas, rotary governor speed & break ratio tuning, bell ringer MOSFET power tuning, and network diagnostic tools.

---

## 🚀 Quick Technical Summary

- **Target Microcontroller**: Hosyond ESP32-S3-WROOM-1 (Dual-Core 240MHz Xtensa LX7, 8MB Octal PSRAM, 16MB Flash).
- **Backend Architecture**: Node.js 20, TypeScript, SQLite3 (WAL mode) with high-performance indexing, WebSocket VoIP switchboard engine.
- **Frontend Architecture**: React 18, Vite, Lucide Icons, Pure CSS Design System, WebPhone softphone.
- **Official Docker Image**: [`tylerhats/decatone:latest`](https://hub.docker.com/repository/docker/tylerhats/decatone/general) (also tagged `v1.0.0`).
