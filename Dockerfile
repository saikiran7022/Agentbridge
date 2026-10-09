# syntax=docker/dockerfile:1.7
# Build targets: `web` (Next.js UI + API + hosted MCP) and `worker` (queue, kagent reconciler, migrations).
#
#   docker build --target web    -t agent-liaison-hub-web:dev .
#   docker build --target worker -t agent-liaison-hub-worker:dev .

FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# pnpm is baked into the image so containers never download it at startup (clusters may have no egress).
ENV COREPACK_HOME=/usr/local/share/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate && chmod -R a+rX $COREPACK_HOME
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/core/package.json packages/core/
COPY packages/agent-templates/package.json packages/agent-templates/
COPY packages/hub-mcp/package.json packages/hub-mcp/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The web build also bundles the hub CLI into apps/web/public/cli/hub.mjs.
RUN pnpm --filter @hub/db generate && pnpm --filter @hub/web build

FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@hub/web", "start"]

FROM base AS worker
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
CMD ["pnpm", "--filter", "@hub/worker", "start"]
