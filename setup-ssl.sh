#!/bin/bash
# DecaTone Let's Encrypt SSL Setup Script for Bare Host Installations
# NOTE: DecaTone also includes a built-in Automatic ACME (Let's Encrypt) TLS Manager in the Web UI.
set -e

echo "===================================================="
echo " 🔒 DecaTone Let's Encrypt SSL Cert Generator"
echo "===================================================="

if [ "$EUID" -ne 0 ]; then
  echo "⚠️  Please run this script with sudo/root privileges."
  exit 1
fi

# Check certbot
if ! command -v certbot &> /dev/null; then
    echo "📦 Installing certbot..."
    apt-get update && apt-get install -y certbot || snap install --classic certbot
fi

read -r -p "Enter your domain name (e.g. phone.example.com): " DOMAIN_NAME
read -r -p "Enter your email for Let's Encrypt notifications: " EMAIL_ADDR

if [ -z "$DOMAIN_NAME" ] || [ -z "$EMAIL_ADDR" ]; then
    echo "❌ Domain name and email are required."
    exit 1
fi

if [[ ! "$DOMAIN_NAME" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "❌ Invalid domain name format."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_TARGET="${SCRIPT_DIR}/backend/data"

echo "🔐 Obtaining SSL certificate for $DOMAIN_NAME..."
certbot certonly --standalone -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "$EMAIL_ADDR"

CERT_PATH="/etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem"

# Determine unprivileged service owner (SUDO_USER on bare-metal or uid 1000 node user for Docker)
SERVICE_UID="${SUDO_UID:-1000}"
SERVICE_GID="${SUDO_GID:-1000}"
if [ -n "$SUDO_USER" ] && id "$SUDO_USER" &> /dev/null; then
    SERVICE_UID="$(id -u "$SUDO_USER")"
    SERVICE_GID="$(id -g "$SUDO_USER")"
fi

if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
    echo "✨ Copying SSL certificates into DecaTone persistent data directory ($DATA_TARGET)..."
    mkdir -p "$DATA_TARGET"
    cp "$CERT_PATH" "$DATA_TARGET/cert.pem"
    cp "$KEY_PATH" "$DATA_TARGET/key.pem"
    chown "${SERVICE_UID}:${SERVICE_GID}" "$DATA_TARGET/cert.pem" "$DATA_TARGET/key.pem"
    chmod 640 "$DATA_TARGET/cert.pem"
    chmod 600 "$DATA_TARGET/key.pem"

    # Install Certbot auto-renewal deploy hook for live SIGHUP reload
    HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
    HOOK_FILE="${HOOK_DIR}/decatone-reload.sh"
    if [ -d "/etc/letsencrypt" ]; then
        mkdir -p "$HOOK_DIR"
        cat > "$HOOK_FILE" <<EOF
#!/bin/bash
if [ -f "${CERT_PATH}" ] && [ -f "${KEY_PATH}" ]; then
  cp "${CERT_PATH}" "${DATA_TARGET}/cert.pem"
  cp "${KEY_PATH}" "${DATA_TARGET}/key.pem"
  chown "${SERVICE_UID}:${SERVICE_GID}" "${DATA_TARGET}/cert.pem" "${DATA_TARGET}/key.pem"
  chmod 640 "${DATA_TARGET}/cert.pem"
  chmod 600 "${DATA_TARGET}/key.pem"
  pkill -HUP -f "backend/dist/server.js" || true
fi
EOF
        chmod 755 "$HOOK_FILE"
        echo "🔁 Installed automatic Certbot renewal deploy hook: $HOOK_FILE"
    fi

    echo "===================================================="
    echo " ✅ SSL Certificates configured successfully!"
    echo " Certificates stored at $DATA_TARGET/cert.pem & $DATA_TARGET/key.pem"
    echo " DecaTone will now start in native HTTPS mode on port 4000."
    echo "===================================================="
else
    echo "❌ Failed to locate generated Let's Encrypt certificates."
    exit 1
fi
