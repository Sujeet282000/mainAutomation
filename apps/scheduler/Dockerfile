# ============================================================================
# Orchestra — Scheduler Dockerfile (Part 13)
# ============================================================================

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY apps/scheduler/package.json apps/scheduler/

FROM base AS deps
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

FROM deps AS build
COPY packages/core/src packages/core/src
COPY packages/shared/src packages/shared/src
COPY packages/crypto/src packages/crypto/src
COPY packages/db/src packages/db/src
COPY apps/scheduler/src apps/scheduler/src
COPY packages/core/tsconfig.json packages/core/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/crypto/tsconfig.json packages/crypto/
COPY packages/db/tsconfig.json packages/db/
COPY apps/scheduler/tsconfig.json apps/scheduler/
RUN cd apps/scheduler && npx tsc -p tsconfig.json

FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY apps/scheduler/package.json apps/scheduler/
RUN pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --prod
COPY --from=build /app/apps/scheduler/dist apps/scheduler/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/crypto/dist packages/crypto/dist
COPY --from=build /app/packages/db/dist packages/db/dist
USER node
CMD ["node", "apps/scheduler/dist/index.js"]

FROM base AS dev
CMD ["pnpm", "--filter", "@orchestra/scheduler", "dev"]
