# Backend and Docker Deployment Guide

DecaTone is designed for self-hosted operation using **Docker Compose** or a native **Node.js 20+** environment.

---

## 1. Quick Start via Docker Compose (Recommended)

Create a `docker-compose.yml` file in your desired deployment directory:

```yaml
version: '3.8'

services:
  decatone:
    image: tylerhats/decatone:latest
    container_name: decatone-app
    restart: unless-stopped
    ports:
      - "4000:4000"
    environment:
      - PORT=4000
      - NODE_ENV=production
      - JWT_SECRET=your_super_secret_jwt_key_here_change_me
    volumes:
      - decatone-data:/app/backend/data
      - decatone-uploads:/app/backend/uploads

volumes:
  decatone-data:
  decatone-uploads:
```

### Launching the Service
```bash
docker compose up -d
```
Access the web dashboard at `http://<your-server-ip>:4000` to complete the initial Setup Wizard.

---

## 2. Reverse Proxy & SSL Setup

For secure WebSockets (`wss://`) and browser microphone permissions, DecaTone should be placed behind an SSL reverse proxy.

### A. Nginx Configuration
```nginx
server {
    listen 80;
    server_name phone.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name phone.example.com;

    ssl_certificate /etc/letsencrypt/live/phone.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

### B. Caddy Configuration
```caddy
phone.example.com {
    reverse_proxy localhost:4000
}
```

---

## 3. Home Assistant & MQTT Integration

DecaTone includes native MQTT integration with Home Assistant Auto-Discovery.

1. In the DecaTone web dashboard, go to **Admin Center &rarr; Settings & MQTT**.
2. Enable MQTT and configure your broker:
   - **Broker URL**: `mqtt://192.168.1.50:1883`
   - **Username / Password**: Your MQTT user credentials
   - **HA Discovery Prefix**: `homeassistant`
   - **Intercom Security PIN**: `411`
3. DecaTone will automatically register every phone as a device with binary sensors for on-hook/off-hook state, active ringing state, DND switch, and a Text-to-Speech Intercom announcement service!
