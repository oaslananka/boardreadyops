# Node 24.22.1-slim (digest-pinned); both runtime stages use the same immutable image.
FROM node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
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

FROM node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runner
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG VERSION=dev
# renovate: datasource=github-releases depName=cli/cli
ARG GH_VERSION=2.103.3

# The existing source-export verifier delegates Sigstore cryptographic verification
# to GitHub CLI. Pin the official immutable release archive by architecture digest
# so production verification uses the same reviewed verifier as local acceptance.
# Fetch the same version from the official Releases API if the direct download endpoint returns 504.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl openssl; \
    rm -rf /var/lib/apt/lists/*; \
    case "$(dpkg --print-architecture)" in \
      amd64) gh_arch="amd64"; gh_sha256="4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d" ;; \
      arm64) gh_arch="arm64"; gh_sha256="ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63" ;; \
      *) echo "Unsupported GitHub CLI architecture." >&2; exit 1 ;; \
    esac; \
    archive="gh_""$GH_VERSION""_linux_""$gh_arch"".tar.gz"; \
    release_api="https://api.github.com/repos/cli/cli/releases"; \
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 2 --max-time 90 \
      -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
      -o /tmp/gh-release.json "$release_api/tags/v$GH_VERSION"; \
    asset_id="$(node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync("/tmp/gh-release.json","utf8"));const a=r.assets?.find(x=>x.name===process.argv[1]);if(r.tag_name!==process.argv[2]||!Number.isInteger(a?.id))process.exit(1);process.stdout.write(String(a.id))' "$archive" "v$GH_VERSION")"; \
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 2 --max-time 120 \
      -H 'Accept: application/octet-stream' -H 'X-GitHub-Api-Version: 2022-11-28' \
      -o "/tmp/$archive" "$release_api/assets/$asset_id"; \
    rm -f /tmp/gh-release.json; \
    printf '%s  %s\n' "$gh_sha256" "/tmp/$archive" | sha256sum --check --strict; \
    mkdir -p /tmp/gh-cli; \
    tar -xzf "/tmp/$archive" -C /tmp/gh-cli; \
    install -o root -g root -m 0755 "/tmp/gh-cli/gh_$GH_VERSION""_linux_""$gh_arch"/bin/gh /usr/local/bin/gh; \
    gh --version | grep -F "gh version $GH_VERSION"; \
    rm -rf /tmp/gh-cli "/tmp/$archive"

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
# A fresh named volume inherits the artifact directory's unprivileged owner.
# Existing data/permissions require separately authorized operator validation.
RUN chmod 0755 /usr/local/bin/boardreadyops-entrypoint \
    && install -d -o node -g node -m 0700 /data/artifacts

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok||b?.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/boardreadyops-entrypoint"]
CMD ["node", "apps/web/server.js"]
