# ============================================================================
# Orchestra — API Dockerfile (Part 13)
# Multi-stage: dev, build, production
# ============================================================================

# ── Base ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/observability/package.json packages/observability/
COPY apps/api/package.json apps/api/

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages/core/src packages/core/src
COPY packages/shared/src packages/shared/src
COPY packages/crypto/src packages/crypto/src
COPY packages/db/src packages/db/src
COPY packages/engine/src packages/engine/src
COPY packages/observability/src packages/observability/src
COPY apps/api/src apps/api/src
COPY packages/core/tsconfig.json packages/core/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/crypto/tsconfig.json packages/crypto/
COPY packages/db/tsconfig.json packages/db/
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/observability/tsconfig.json packages/observability/
COPY apps/api/tsconfig.json apps/api/
RUN cd apps/api && npx tsc -p tsconfig.json

# ── Production ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/observability/package.json packages/observability/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --prod
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/crypto/dist packages/crypto/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

# ── Dev ──────────────────────────────────────────────────────────────────────
FROM base AS dev
CMD ["pnpm", "--filter", "@orchestra/api", "dev"]
