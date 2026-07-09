# Build stage
FROM node:22-slim AS build

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app

# pnpm needs this to run non-interactively (e.g. purging dev deps for --prod install)
ENV CI=true

# Copy workspace files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Install all dependencies for building
RUN pnpm install --frozen-lockfile

# Build core and web
RUN pnpm build

# Prepare production-only node_modules (core + its workspace deps only —
# web runtime deps like react would bloat the image past the 350 MB budget)
RUN pnpm install --prod --frozen-lockfile --filter @yapaja/core...

# Runtime stage
FROM node:22-slim

# Create non-root user
RUN groupadd -r node && useradd -r -g node node || true

WORKDIR /app

# Copy workspace and package files
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy production node_modules
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/core/node_modules ./apps/core/node_modules
COPY --from=build --chown=node:node /app/apps/core/package.json ./apps/core/package.json

# Copy built core and web
COPY --from=build --chown=node:node /app/apps/core/dist ./apps/core/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/core/public

# Create data directories for volumes
RUN mkdir -p /app/data/db /app/data/tiles /app/data/addons

# Set proper ownership
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Environment and health check
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/core/dist/index.js"]
