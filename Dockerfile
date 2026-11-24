# Stage 1: Build Frontend & Backend
FROM node:22-slim AS builder

WORKDIR /app
ENV npm_config_onnxruntime_node_install_cuda=skip

# Install native compilation tools for sqlite3
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package descriptors
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY backend/.npmrc ./backend/.npmrc
COPY frontend/package*.json ./frontend/

# Install all dependencies and build TypeScript / Vite bundles
RUN npm run setup

# Copy source trees
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY assets/ ./assets/

# Build production artifacts
RUN npm run build

# Prune devDependencies to keep only production packages for runtime
RUN cd backend && npm prune --omit=dev --no-audit --no-fund

# Stage 2: Minimal, Hardened Debian Slim Runtime Image (glibc for Piper & Kokoro ONNX)
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/backend/data
ENV UPLOADS_DIR=/app/backend/uploads

# Install runtime dependencies for local offline TTS (Piper/Kokoro/eSpeak-NG), audio transcoding, TLS CAs, and healthcheck,
# and remove bundled npm/npx CLI to minimize attack surface
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends ffmpeg espeak-ng ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm /root/.node-gyp

# Copy package descriptors and static assets
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY assets/ ./assets/

# Copy production node_modules from builder
COPY --from=builder /app/backend/node_modules ./backend/node_modules

# Copy compiled production dist files
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Create persistent storage directories and assign ownership to non-root node user
RUN mkdir -p /app/backend/data \
             /app/backend/data/firmware \
             /app/backend/data/branding \
             /app/backend/data/tls \
             /app/backend/data/tts-kokoro \
             /app/backend/data/piper \
             /app/backend/uploads && \
    chown -R node:node /app/backend/data /app/backend/uploads

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -fsSk http://127.0.0.1:4000/api/health || curl -fsSk https://127.0.0.1:4000/api/health || exit 1

CMD ["node", "backend/dist/server.js"]
