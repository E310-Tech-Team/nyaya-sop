# syntax=docker/dockerfile:1.7
# School of Purpose: website + API in one small Node image.
# Build:  docker build --build-arg SITE_URL=https://apply.example.org -t school-of-purpose .
# (docker-compose.yml does this for you.)

ARG NODE_VERSION=22

# ── Base: Node + pnpm (version pinned by "packageManager" in package.json) ──
FROM node:${NODE_VERSION}-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ── Build: install everything, build the website (dist/) and server (server-dist/) ──
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store
COPY . .
# Baked into the website at build time. BUILD_ID names the release (a timestamp if empty);
# SW_KILL_SWITCH=1 is only for an emergency service-worker rollback (docs/DEPLOYMENT.md).
ARG SITE_URL=""
ARG VITE_CONTACT_EMAIL=""
ARG BUILD_ID=""
ARG SW_KILL_SWITCH=""
ENV SITE_URL=${SITE_URL} VITE_CONTACT_EMAIL=${VITE_CONTACT_EMAIL} BUILD_ID=${BUILD_ID} SW_KILL_SWITCH=${SW_KILL_SWITCH}
RUN pnpm run build

# ── Production dependencies only (Fastify, pg, …) ──
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --prod --frozen-lockfile --store-dir=/pnpm-store

# ── Runtime ──
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server-dist ./server-dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server-dist/index.js"]
