# CareLayer API image (apps/api), for Google Cloud Run (Z11). Built from the repo root because the
# API depends on the packages/shared workspace.
#
#   gcloud builds submit --tag <region>-docker.pkg.dev/<project>/carelayer/api:<tag>
#   (apps/api/deploy/cloudrun.sh does this, see apps/api/README.md "Deploy")
#
# The same image runs three ways:
#   service  node dist/index.js              (default CMD, listens on $PORT)
#   migrate  npx prisma migrate deploy       (Cloud Run job, before each deploy)
#   seed     node dist/seed/run.js           (Cloud Run job, once, demo data; see seed guard)

# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Workspace manifests first, so dependency layers are cached between code changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/workers/package.json apps/workers/
COPY apps/mcp/package.json apps/mcp/
# Only the API and the shared package are installed; the frontends and MCP are not in this image.
RUN npm ci --workspace @carelayer/api --workspace @carelayer/shared --include-workspace-root \
      --ignore-scripts --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @carelayer/shared && npm run build -w @carelayer/api
# Scripts were skipped at install: make sure the prisma CLI has what `migrate deploy` needs now,
# while the build has network access (the runtime user cannot write to node_modules).
RUN cd apps/api && npx prisma --version

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# node_modules keeps the prisma CLI (dev dependency) for the migrate job.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
# Read at startup: Hikmah's assistant prompt and the red-flag list (a missing file stops the API).
COPY --from=build /app/apps/api/prompts apps/api/prompts
COPY --from=build /app/apps/api/config apps/api/config

WORKDIR /app/apps/api
USER node
# Cloud Run sets PORT (8080). The API reads PORT (config.ts).
EXPOSE 8080
CMD ["node", "dist/index.js"]
