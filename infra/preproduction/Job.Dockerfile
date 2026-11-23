FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
RUN node -e "if(process.version !== 'v24.21.0') process.exit(1)" \
    && test "$(npm --version)" = '11.19.0'
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
COPY infra/runner ./infra/runner
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm run build --workspace @alunza/contracts \
    && npm run build --workspace @alunza/runner \
    && npm run build --workspace @alunza/ai

FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS job
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --chown=node:node scripts/preprod-manifest.mjs scripts/preprod-job.mjs scripts/preprod-report.mjs scripts/runner-probe.mjs scripts/ai-probe.mjs ./scripts/
COPY --chown=node:node infra/runner ./infra/runner
COPY --chown=node:node tests/runner/fixtures.mjs ./tests/runner/fixtures.mjs
COPY --chown=node:node fixtures/ai ./fixtures/ai
RUN mkdir -p /app/.local/reports/imp-00-06-08 && chown -R node:node /app/.local
USER node
CMD ["node", "scripts/preprod-job.mjs", "probe:ai"]
