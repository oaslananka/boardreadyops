# Node 24.22.3 Alpine 3.24 (digest-pinned); both runtime stages use the same immutable image.
FROM node@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN apk add --no-cache ca-certificates openssl bash
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Patched pnpm dependencies are resolved during the install layer.
COPY patches patches
COPY scripts scripts
COPY apps/web/package.json apps/web/package.json
COPY packages/cloud-core/package.json packages/cloud-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN corepack pnpm run deps:install-web

FROM deps AS build
COPY . .
RUN pnpm --filter @boardreadyops/web build

# Build the signed Go module release with the patched x/net dependency.
# The Go module checksum database authenticates the upstream version and modules.
# This stage is discarded; only the statically linked binary enters production.
FROM golang@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS gh-builder
ARG GH_VERSION=2.104.0
RUN set -eux; \
    mkdir -p /src /out; \
    cd /src; \
    go mod init example.com/boardreadyops/gh-builder; \
    go mod edit -require="github.com/cli/cli/v2@v${GH_VERSION}"; \
    go mod edit -require=golang.org/x/net@v0.62.0; \
    GOTOOLCHAIN=local go install -mod=mod github.com/cli/cli/v2/cmd/gh; \
    cp /go/bin/gh /out/gh; \
    go version -m /out/gh > /tmp/gh-build-info; \
    grep -E 'mod[[:space:]]+github.com/cli/cli/v2[[:space:]]+v2.104.0' /tmp/gh-build-info; \
    grep -E 'dep[[:space:]]+golang.org/x/net[[:space:]]+v0.62.0' /tmp/gh-build-info; \
    /out/gh --version | grep -F "gh version ${GH_VERSION}"
FROM node@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runner
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG VERSION=dev
ARG GH_VERSION=2.104.0
# The patched upstream CLI is built in the isolated Go stage above.
COPY --from=gh-builder /out/gh /usr/local/bin/gh
RUN set -eux; \
    gh --version | grep -F "gh version ${GH_VERSION}"; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
LABEL org.opencontainers.image.title="BoardReadyOps Cloud" \
      org.opencontainers.image.description="Self-hosted BoardReadyOps cloud control plane" \
      org.opencontainers.image.source="https://github.com/oaslananka/boardreadyops" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
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
COPY --chown=node:node apps/web/web-supervisor.mjs ./apps/web/web-supervisor.mjs
# A fresh named volume inherits the artifact directory's unprivileged owner.
# Existing data/permissions require separately authorized operator validation.
RUN chmod 0755 /usr/local/bin/boardreadyops-entrypoint \
    && install -d -o node -g node -m 0700 /data/artifacts \
    && install -d -o node -g node -m 0700 /run/boardreadyops

USER node

EXPOSE 3000

HEALTHCHECK --interval=3s --timeout=5s --start-period=30s --retries=2 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready',{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok||b?.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/boardreadyops-entrypoint"]
CMD ["node", "apps/web/web-supervisor.mjs"]
