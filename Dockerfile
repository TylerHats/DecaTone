# Stage 1: Build Frontend & Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Upgrade base packages and install compilation tools for native SQLite
RUN apk upgrade --no-cache && apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./
COPY backend/package*.json ./backend/
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
RUN cd backend && npm prune --production --no-audit --no-fund

# Stage 2: Minimal, Hardened Runtime Image
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/backend/data
ENV UPLOADS_DIR=/app/backend/uploads

# Upgrade base runtime packages to latest security releases (OpenSSL, Busybox, etc.)
RUN apk upgrade --no-cache

# Copy package descriptors and static assets
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY assets/ ./assets/

# Copy production node_modules from builder
COPY --from=builder /app/backend/node_modules ./backend/node_modules

# Copy compiled production dist files
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Create persistent storage directories
RUN mkdir -p /app/backend/data /app/backend/uploads /app/backend/firmware /app/backend/data/branding

EXPOSE 4000

CMD ["node", "backend/dist/server.js"]
