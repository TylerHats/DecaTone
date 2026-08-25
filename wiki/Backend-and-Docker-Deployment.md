# Backend and Docker Deployment

This guide explains how to deploy the DecaTone server using Docker Compose, set up native Let's Encrypt SSL certificates, or configure DecaTone behind a reverse proxy (Nginx, Traefik, Caddy, Cloudflare).

---

## 1. Quick Start with Docker Compose

### Prerequisites
- Docker (version >= 20.10)
- Docker Compose (version >= 2.0)

### `docker-compose.yml`
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
      - JWT_SECRET=change_this_to_a_secure_random_key_64_bytes
    volumes:
      - decatone-data:/app/backend/data
      - decatone-uploads:/app/backend/uploads

volumes:
  decatone-data:
  decatone-uploads:
```

### Launch Container
```bash
docker compose up -d
```

Access the initial setup wizard at `http://localhost:4000/setup`.

---

## 2. Reverse Proxy & SSL Configuration

DecaTone is designed to seamlessly detect reverse proxy environments and SSL termination automatically via Express `trust proxy` and `X-Forwarded-Proto` headers.

### Nginx Reverse Proxy Configuration Example
```nginx
server {
    server_name phone.example.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

---

## 3. Native Let's Encrypt SSL Setup (Without Reverse Proxy)

If you are running DecaTone on a bare VPS or server without a reverse proxy, you can generate native HTTPS certificates using `setup-ssl.sh`:

```bash
sudo ./setup-ssl.sh
```

The script will:
1. Obtain certificates from Let's Encrypt using `certbot`.
2. Copy `cert.pem` and `key.pem` into `backend/data/`.
3. DecaTone will automatically detect the certificates and start in native HTTPS mode on port 4000.

---

## 4. Backups & Disaster Recovery

- Backups are stored in `backend/data/backups/`.
- You can create, download, and restore backups anytime from the **Admin Center &rarr; Backups** panel or schedule automated daily/weekly backups with retention policies.
