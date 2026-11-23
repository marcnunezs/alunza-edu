FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN node -e "if(process.version !== 'v24.21.0') process.exit(1)" \
    && test "$(npm --version)" = "11.19.0"

FROM base AS manifests
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/runner/package.json ./packages/runner/package.json
COPY packages/ai/package.json ./packages/ai/package.json

FROM manifests AS dependencies
RUN npm ci --workspaces --include-workspace-root=false --no-audit --no-fund

FROM dependencies AS api-build
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/runner ./packages/runner
COPY packages/ai ./packages/ai
COPY infra/materials ./infra/materials
COPY infra/runner ./infra/runner
COPY apps/api ./apps/api
RUN npm run build --workspace @alunza/contracts \
    && npm run build --workspace @alunza/runner \
    && npm run build --workspace @alunza/ai \
    && npm run build --workspace @alunza/api

FROM manifests AS api-production-dependencies
RUN npm ci --omit=dev --workspace @alunza/api --workspace @alunza/contracts --workspace @alunza/runner --workspace @alunza/ai \
    --include-workspace-root=false --ignore-scripts --no-audit --no-fund

FROM base AS api
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0
COPY --from=api-production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=api-production-dependencies --chown=node:node /app/apps/api ./apps/api
COPY --from=api-production-dependencies --chown=node:node /app/packages/ai ./packages/ai
COPY --from=api-build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=api-build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=api-build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=api-build --chown=node:node /app/packages/runner/package.json ./packages/runner/package.json
COPY --from=api-build --chown=node:node /app/packages/runner/dist ./packages/runner/dist
COPY --from=api-build --chown=node:node /app/infra/runner ./infra/runner
COPY --from=api-build --chown=node:node /app/packages/ai/package.json ./packages/ai/package.json
COPY --from=api-build --chown=node:node /app/packages/ai/dist ./packages/ai/dist
COPY --from=api-build --chown=node:node /app/infra/materials ./infra/materials
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM dependencies AS web-build
# These are browser-visible settings. No private runtime or bootstrap variables are build arguments.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN npm run build --workspace @alunza/contracts \
    && npm run build --workspace @alunza/web \
    && mkdir -p apps/web/public

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=web-build --chown=node:node /app/apps/web/config ./apps/web/config
COPY --from=web-build --chown=node:node /app/apps/web/scripts ./apps/web/scripts
USER node
EXPOSE 3000
CMD ["node", "apps/web/scripts/start-standalone.mjs"]
