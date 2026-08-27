# ============================================================================
# Orchestra — Worker Dockerfile (Part 13)
# Multi-stage: dev, build, production
# ============================================================================

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY apps/worker/package.json apps/worker/

FROM base AS deps
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

FROM deps AS build
COPY packages/core/src packages/core/src
COPY packages/shared/src packages/shared/src
COPY packages/crypto/src packages/crypto/src
COPY packages/db/src packages/db/src
COPY packages/engine/src packages/engine/src
COPY apps/worker/src apps/worker/src
COPY apps/api/src apps/api/src
COPY apps/api/package.json apps/api/
COPY packages/core/tsconfig.json packages/core/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/crypto/tsconfig.json packages/crypto/
COPY packages/db/tsconfig.json packages/db/
COPY packages/engine/tsconfig.json packages/engine/
COPY apps/worker/tsconfig.json apps/worker/
COPY apps/api/tsconfig.json apps/api/
RUN cd apps/worker && npx tsc -p tsconfig.json

FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --prod
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/crypto/dist packages/crypto/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
USER node
CMD ["node", "apps/worker/dist/index.js"]

FROM base AS dev
CMD ["pnpm", "--filter", "@orchestra/worker", "dev"]
