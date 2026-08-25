#!/bin/bash
# DecaTone Let's Encrypt SSL Setup Script for Bare Host Installations
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

read -p "Enter your domain name (e.g. phone.example.com): " DOMAIN_NAME
read -p "Enter your email for Let's Encrypt notifications: " EMAIL_ADDR

if [ -z "$DOMAIN_NAME" ] || [ -z "$EMAIL_ADDR" ]; then
    echo "❌ Domain name and email are required."
    exit 1
fi

echo "🔐 Obtaining SSL certificate for $DOMAIN_NAME..."
certbot certonly --standalone -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "$EMAIL_ADDR"

CERT_PATH="/etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem"

if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
    echo "✨ Copying SSL certificates into DecaTone persistent data directory..."
    mkdir -p backend/data
    cp "$CERT_PATH" backend/data/cert.pem
    cp "$KEY_PATH" backend/data/key.pem
    chmod 600 backend/data/key.pem
    
    echo "===================================================="
    echo " ✅ SSL Certificates configured successfully!"
    echo " DecaTone will now start in native HTTPS mode on port 4000."
    echo "===================================================="
else
    echo "❌ Failed to locate generated Let's Encrypt certificates."
    exit 1
fi
