# Stage 1: Build Frontend & Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and package descriptors
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

# Install git, typescript, and vite for in-container self-updating
RUN apk add --no-cache git tar curl && npm install -g typescript vite

COPY package*.json tsconfig*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Copy full source trees into container so in-container git pull & tsc / vite build work 100%
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY assets/ ./assets/

# Copy git repository metadata for self-updater if present
COPY .git ./.git

# Install setup dependencies including devDependencies so npm run build can compile TypeScript & Vite assets
RUN NODE_ENV=development npm install --include=dev --no-audit --no-fund && cd backend && NODE_ENV=development npm install --include=dev --no-audit --no-fund && cd ../frontend && NODE_ENV=development npm install --include=dev --no-audit --no-fund

# Copy compiled dist files
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Create persistent storage directories
RUN mkdir -p /app/backend/data /app/backend/uploads /app/backend/firmware

EXPOSE 4000

CMD ["node", "backend/dist/server.js"]
