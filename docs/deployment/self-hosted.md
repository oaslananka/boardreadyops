# Self-hosted BoardReadyOps Cloud deployment

Customer-operated execution workers are deployed separately from the control plane. See [Self-hosted runner mode](self-hosted-runner.md) for enrollment, source-boundary, service, network, and rollback procedures.

This guide describes the self-hosted deployment target for `boardreadyops.oaslananka.dev` on `ops-vps-02`.

## Target topology

```text
Cloudflare DNS
  -> boardreadyops.oaslananka.dev
  -> ops-vps-02 / 46.101.195.208
  -> Caddy on the boardreadyops-cloud Docker network
  -> immutable BoardReadyOps web image on web:3000
  -> PostgreSQL, Redis, and a persistent artifact volume
```

## DNS

Cloudflare DNS contains this record:

```text
Type: A
Name: boardreadyops
Content: 46.101.195.208
Proxy: DNS only
TTL: 60
```

## Runtime layout

Recommended paths:

```text
/opt/repos/boardreadyops-prod       # clean production worktree tracking origin/main
/opt/boardreadyops-cloud            # deployment env, stable Caddyfile, and runtime files
/opt/boardreadyops-cloud/runtime-env # root-only symlink or file mounted read-only into web
```

Keep the live Caddy bind mount under `/opt/boardreadyops-cloud`; do not bind it from an expendable Git worktree.

## Host requirements

Install Docker Engine and the Docker Compose v2 plugin on the VPS. The web image includes a native Docker healthcheck. PostgreSQL and Redis healthchecks are also defined in `deploy/docker-compose.yml`.

## First Compose deployment

```bash
cp deploy/env.example deploy/.env
# Edit deploy/.env before public deployment.
export BOARDREADYOPS_GIT_SHA="$(git rev-parse HEAD)"
export BOARDREADYOPS_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export BOARDREADYOPS_VERSION="$(node -p "require('./package.json').version")"
export BOARDREADYOPS_IMAGE_TAG="$BOARDREADYOPS_GIT_SHA"
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

The build writes the commit SHA, package version, and build timestamp into standard OCI image labels.

## Health check

```bash
curl -fsS https://boardreadyops.oaslananka.dev/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "boardreadyops-cloud"
}
```

Inspect the native Docker health state with:

```bash
docker inspect --format '{{json .State.Health}}' bro-web
```

## Repeatable VPS deploy from main

After a change is merged to `main`, update the clean production worktree without rewriting local history:

```bash
cd /opt/repos/boardreadyops-prod
git fetch origin --prune
git checkout prod-main
git merge --ff-only origin/main
pnpm run cloud:deploy:self-hosted
```

The deploy script performs these steps:

1. Installs dependencies with `pnpm install --frozen-lockfile` unless explicitly skipped.
2. Builds an immutable web image tagged with the current Git commit.
3. Adds OCI revision, version, and build-date labels to the image.
4. Starts a temporary canary container on `127.0.0.1:3004`.
5. Requires both the image-native Docker healthcheck and the canary HTTP health endpoint to pass.
6. Tags the current live image as a timestamped rollback image.
7. Stops the old container and starts the new image as `bro-web` with `restart=unless-stopped`.
8. Verifies the public HTTPS health endpoint.
9. Restores the previous container automatically if the new deployment fails.
10. Removes the previous container after success while retaining its rollback image.

The deploy no longer copies `.next` into a running container. Each release is an immutable Docker image tied to one Git revision.

Supported environment overrides:

```text
BOARDREADYOPS_CLOUD_CONTAINER=bro-web
BOARDREADYOPS_CLOUD_HEALTH_URL=https://boardreadyops.oaslananka.dev/api/health
BOARDREADYOPS_CLOUD_CANARY_HEALTH_URL=http://127.0.0.1:3004/api/health
BOARDREADYOPS_CLOUD_IMAGE_REPOSITORY=boardreadyops-web-runtime
BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE=/opt/boardreadyops-cloud/runtime-env
BOARDREADYOPS_CLOUD_ARTIFACT_VOLUME=boardreadyops_artifacts
BOARDREADYOPS_CLOUD_NETWORK=boardreadyops-cloud
BOARDREADYOPS_CLOUD_LIVE_PUBLISH=127.0.0.1:3003:3000
BOARDREADYOPS_CLOUD_CANARY_PUBLISH=127.0.0.1:3004:3000
BOARDREADYOPS_CLOUD_REVISION=<git-sha>
BOARDREADYOPS_CLOUD_SKIP_INSTALL=1
BOARDREADYOPS_CLOUD_DRY_RUN=1
BOARDREADYOPS_CLOUD_HEALTH_ATTEMPTS=60
BOARDREADYOPS_CLOUD_HEALTH_DELAY_MS=1000
```

For a dry run:

```bash
BOARDREADYOPS_CLOUD_DRY_RUN=1 pnpm run cloud:deploy:self-hosted
```

## Signed artifact downloads

Hosted run dashboards expose artifact metadata without revealing the internal storage path. A download link is rendered only when both `NEXT_PUBLIC_APP_URL` (or `BOARDREADYOPS_PUBLIC_URL`) and a dedicated `ARTIFACT_DOWNLOAD_SIGNING_KEY` are configured.

Generate an independent key with at least 32 random bytes:

```bash
openssl rand -base64 48
```

Store the result in the root-only runtime environment file:

```text
ARTIFACT_DOWNLOAD_SIGNING_KEY=<generated-value>
```

The artifact signer does not fall back to `SESSION_SECRET`. URLs are bound to the run ID, artifact ID, and expiry, and are accepted for at most 15 minutes. Rotating the key immediately invalidates previously issued links. Local-file downloads also verify the resolved filesystem path remains inside `ARTIFACT_STORAGE_ROOT` and that the stored byte count matches the file before streaming it.

## Database bootstrap and migrations

The self-hosted cloud control plane stores GitHub App installations, repositories, release runs, findings, and artifacts in PostgreSQL.

Apply migrations from the production worktree after `DATABASE_URL` is configured:

```bash
cd /opt/repos/boardreadyops-prod
pnpm --filter @boardreadyops/db db:migrate
```

Preview pending migrations without applying them:

```bash
cd /opt/repos/boardreadyops-prod
pnpm --filter @boardreadyops/db db:migrate:dry-run
```

The migration runner records applied versions in `cloud_schema_migrations`; migrations are designed to be idempotent and safe to re-run.
