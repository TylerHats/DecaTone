# Stage 1: Build Frontend & Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native sqlite3
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm run setup

# Copy source files
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY assets/ ./assets/

# Build frontend and backend
RUN npm run build

# Stage 2: Runtime image
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/backend/data
ENV UPLOADS_DIR=/app/backend/uploads

# Install runtime utilities & build tools for sqlite3
RUN apk add --no-cache git tar curl python3 make g++ && npm install -g typescript vite

COPY package*.json tsconfig*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Copy source trees (excluding node_modules via .dockerignore)
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY assets/ ./assets/

# Install dependencies inside container environment
RUN cd backend && npm install --no-audit --no-fund && cd ../frontend && npm install --no-audit --no-fund

# Copy compiled dist files
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Create persistent storage directories
RUN mkdir -p /app/backend/data /app/backend/uploads /app/backend/firmware /app/backend/data/branding

EXPOSE 4000

CMD ["sh", "-c", "cd backend && node dist/server.js"]
