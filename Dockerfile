# ==========================================
# STAGE 1: Dependency builder
# ==========================================
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only (ignores devDependencies)
RUN npm ci --only=production

# ==========================================
# STAGE 2: Lightweight Runtime Environment
# ==========================================
FROM node:18-alpine AS runner

WORKDIR /usr/src/app

# Set environment to production
ENV NODE_ENV=production

# Copy built node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application source files
COPY src/ ./src
COPY package.json ./

# Use a non-root system user for security hardening
USER node

# Expose default application port
EXPOSE 8080

# Environment defaults (can be overridden at runtime)
ENV PORT=8080

# Container Healthcheck using native Node.js fetch (Node 18+)
# Prevents needing curl/wget installed inside Alpine, minimizing attack surface
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the Node application
CMD ["npm", "start"]
