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
  -> durable PostgreSQL webhook inbox and control-plane jobs
  -> PostgreSQL transactional outbox for GitHub side effects
  -> independent BoardReadyOps worker image on worker:3001
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

Install Docker Engine and the Docker Compose v2 plugin on the VPS. The web and control-plane worker processes have independent healthchecks. PostgreSQL and Redis healthchecks are also defined in `deploy/docker-compose.yml`.

The webhook endpoint never performs GitHub Check Run creation or workflow dispatch inline. It verifies and normalizes the request, atomically stores one `webhook_inbox` row and one `control_plane_jobs` row, and returns HTTP 202. The lifecycle worker claims jobs with PostgreSQL leases and writes release-run state plus required `control_plane_outbox` records transactionally. An independent outbox loop delivers Check Run and workflow effects, so GitHub API latency does not block unrelated webhook planning. Check Run creation is replay-safe through `external_id = runId`; an uncertain workflow dispatch becomes `reconciliation_required` and is not automatically replayed. See [Transactional outbox](../architecture/transactional-outbox.md) for the state model, reconciliation procedure, metrics, and external-broker triggers.

Web intake logs expose only outcome and request-to-accept latency. The worker periodically emits aggregate available, leased, retrying, dead-letter, reconciliation-required, oldest-age, and outbox-lag metrics without repository, installation, delivery, or payload fields. Successful webhook processing immediately replaces normalized actions with an empty array. Terminal inbox metadata is retained for 30 days by default and then removed in bounded worker cleanup batches; dead-letter actions remain available only until that retention deadline. Verified deliveries are guarded by a configurable per-installation, per-process rate window (`BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE`, default 1200); retries with the same GitHub delivery ID are exempt so idempotent acknowledgement remains available.

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

The build writes the commit SHA, package version, and build timestamp into standard OCI image labels. Compose runs the additive SQL migrations once, then starts the web and worker services from the same immutable image. The worker exposes readiness only inside the Compose network on port 3001.

## Health check

```bash
curl -fsS https://boardreadyops.oaslananka.dev/api/health

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec worker \
  node -e "fetch('http://127.0.0.1:3001/health/ready').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"
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
4. Applies pending additive PostgreSQL migrations from the immutable image.
5. Starts a temporary web canary on `127.0.0.1:3004`.
6. Requires both the image-native Docker healthcheck and the canary HTTP health endpoint to pass.
7. Tags the current live image as a timestamped rollback image.
8. Replaces `bro-web`, verifies the public HTTPS endpoint, then replaces `bro-worker`.
9. Requires the worker's database-backed readiness check to pass.
10. Restores both previous containers automatically if either process fails deployment.
11. Removes previous containers after success while retaining the rollback image.

The deploy no longer copies `.next` into a running container. Each release is an immutable Docker image tied to one Git revision.

Supported environment overrides:

```text
BOARDREADYOPS_CLOUD_CONTAINER=bro-web
BOARDREADYOPS_CLOUD_WORKER_CONTAINER=bro-worker
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
BOARDREADYOPS_WORKER_CONCURRENCY=4
BOARDREADYOPS_WORKER_POLL_MS=1000
BOARDREADYOPS_OUTBOX_CONCURRENCY=4
BOARDREADYOPS_OUTBOX_POLL_MS=500
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

The self-hosted cloud control plane stores GitHub App installations, repositories, release runs, findings, artifacts, durable webhook jobs, and transactional outbox effects in PostgreSQL.

Compose and `pnpm run cloud:deploy:self-hosted` apply pending migrations before replacing live processes. For an explicit administrative run after `DATABASE_URL` is configured:

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
