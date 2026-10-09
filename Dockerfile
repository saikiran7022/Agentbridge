# syntax=docker/dockerfile:1.7
# Build targets: `web` (Next.js UI + API) and `worker` (queue, webhooks, kagent reconciler, migrations).

FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
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
RUN pnpm --filter @hub/db generate && pnpm --filter @hub/web build

FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@hub/web", "start"]

FROM base AS worker
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["pnpm", "--filter", "@hub/worker", "start"]
