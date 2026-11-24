#!/bin/bash
# DecaTone Docker Installation Script
set -e

echo "===================================================="
echo " ☎️  DecaTone Telephone Switch Installation"
echo "===================================================="

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is required but not installed."
    exit 1
fi

# Auto-generate cryptographically strong 64-hex-char JWT_SECRET if .env does not exist
if [ ! -f .env ]; then
    echo "🔐 Generating random 256-bit JWT_SECRET in .env..."
    if command -v openssl &> /dev/null; then
        GEN_SECRET="$(openssl rand -hex 32)"
    else
        GEN_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    umask 077
    printf "JWT_SECRET=%s\n" "$GEN_SECRET" > .env
    chmod 600 .env
fi

echo "🚀 Pulling latest DecaTone container image..."
docker pull tylerhats/decatone:latest || echo "Notice: Local build will be used if image not on registry."

echo "📦 Starting DecaTone services..."
if docker compose version &> /dev/null; then
    docker compose up -d
else
    docker-compose up -d
fi

echo "===================================================="
echo " ✅ DecaTone is running!"
echo " Access the web portal at: http://localhost:4000"
echo "===================================================="
