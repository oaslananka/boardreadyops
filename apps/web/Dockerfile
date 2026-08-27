FROM node:24.19.0-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts scripts
COPY apps/web/package.json apps/web/package.json
COPY packages/cloud-core/package.json packages/cloud-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN corepack pnpm run deps:install-web

FROM deps AS build
COPY . .
RUN pnpm --filter @boardreadyops/web build

FROM node:24.19.0-slim AS runner
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG VERSION=dev

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="BoardReadyOps Cloud" \
      org.opencontainers.image.description="Self-hosted BoardReadyOps cloud control plane" \
      org.opencontainers.image.source="https://github.com/oaslananka/boardreadyops" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# worker.mjs and migrate.mjs (scripts/build-control-plane-worker.mjs) are esbuild bundles
# built outside Next's own route tracing, with `pg` deliberately left external (it uses
# dynamic requires for optional native bindings that bundlers mishandle). Next's standalone
# output only includes what its tracer finds reachable from a traced page/route, so pg and
# its own transitive dependencies (pg-types, pg-protocol, pg-connection-string, pgpass, ...)
# are not guaranteed to be there -- copying the build stage's full, already-pnpm-resolved
# node_modules (with real symlinks, unlike glob-based tracing) is what makes that resolution
# correct regardless of which deps pg happens to need release to release.
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=build /app/apps/web/.next/worker.mjs ./worker.mjs
COPY --chown=node:node --from=build /app/apps/web/.next/migrate.mjs ./migrate.mjs
COPY --chown=node:node --from=build /app/apps/web/public ./apps/web/public
COPY apps/web/docker-entrypoint.sh /usr/local/bin/boardreadyops-entrypoint
RUN chmod 0755 /usr/local/bin/boardreadyops-entrypoint

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok||b?.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/boardreadyops-entrypoint"]
CMD ["node", "apps/web/server.js"]
