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

Web intake logs expose only outcome and request-to-accept latency. The worker periodically emits aggregate available, leased, retrying, dead-letter, reconciliation-required, oldest-age, and outbox-lag metrics without payload or finding content. Terminal worker logs include only safe correlation identifiers such as delivery, installation, repository, run, attempt, job, and outbox IDs. All structured fields pass through recursive credential, OIDC, capability, source, and finding redaction before serialization. Successful webhook processing immediately replaces normalized actions with an empty array. Terminal inbox metadata is retained for 30 days by default and then removed in bounded worker cleanup batches; dead-letter actions remain available only until that retention deadline. Verified deliveries are guarded by a configurable per-installation, per-process rate window (`BOARDREADYOPS_WEBHOOK_RATE_LIMIT_PER_MINUTE`, default 1200); retries with the same GitHub delivery ID are exempt so idempotent acknowledgement remains available.

## Control-plane SLI snapshots

The maintenance loop emits a global `worker.control_plane_sli` event on the same interval as queue metrics. The event is content-free and contains only these aggregate fields:

- `webhookAcceptanceP95Ms`: 24-hour p95 time from webhook receipt to durable acceptance;
- `lifecycleQueueAgeSeconds`: age of the oldest available or leased lifecycle job;
- `outboxLagSeconds`: age of the oldest available, leased, or reconciliation-required side effect;
- `dispatchLatencyP95Seconds`: 24-hour p95 time from dispatch request to confirmed dispatch;
- `completionLatencyP95Seconds`: 24-hour p95 execution completion time;
- `staleAttempts`: non-terminal attempts without recent progress;
- `reconciliationBacklog`: available or leased reconciliation items;
- `reconciliationRepairs24h`: successfully repaired reconciliation items in the last 24 hours;
- `terminalFailures24h` and `terminalRuns24h`: terminal run counts used to calculate failure rate; and
- `terminalFailureRateBasisPoints`: terminal failures per 10,000 terminal runs.

The query never returns repository source, findings, payloads, artifact names, commit messages, credentials, or tokens. A failed SLI query does not affect worker readiness or queue processing; the worker emits `worker.control_plane_sli_failed` with only `errorClass`. Queue metric collection and SLI collection fail independently.

## Initial GitHub Cloud GA SLO policy

The initial alert policy is versioned as `github-cloud-ga-v1`. It evaluates only the aggregate snapshot above and emits transition events without repository, installation, source, finding, payload, artifact, credential, or token fields.

| Signal | Alert trigger | Severity |
| --- | --- | --- |
| Webhook acceptance p95 | `> 1,000 ms` for 5 minutes | warning |
| Lifecycle queue age | `> 60 seconds` for 5 minutes | critical |
| Outbox lag | `> 60 seconds` for 5 minutes | critical |
| Dispatch latency p95 | `> 30 seconds` for 10 minutes | warning |
| Completion latency p95 | `> 1,800 seconds` for 10 minutes | warning |
| Stale attempts | `> 0` for two consecutive snapshots | critical |
| Reconciliation backlog | `> 20` immediately or increasing for three consecutive snapshots | warning |
| Terminal failure rate | `> 500` basis points with at least 20 terminal runs in 24 hours | critical |

The terminal failure-rate gate is 500 basis points and is evaluated only when there are at least 20 terminal runs in the preceding 24 hours.

Every successful snapshot emits `worker.control_plane_slo_evaluation` with the policy version, aggregate health, and active signal names. A signal emits `worker.control_plane_slo_firing` only when it first enters the alerting state and `worker.control_plane_slo_recovered` only when it leaves that state. Repeated breached snapshots do not repeat the firing transition.

Critical transitions page the platform on-call. Warning transitions open or update operational triage and should be correlated with GitHub status, worker restarts, queue lag, outbox lag, and reconciliation activity. `reconciliationRepairs24h` remains diagnostic and does not alert by itself.

If policy evaluation throws, the worker emits `worker.control_plane_slo_failed` with only `errorClass`. SLI collection or SLO evaluation failure does not affect worker readiness or queue processing. The evaluator keeps debounce state in memory, so a worker restart resets local duration and consecutive-snapshot history. External log or metrics infrastructure must retain durable incident state and must not treat a worker restart as recovery.

## Control-plane worker boundary

The worker is an orchestrator only. It does not check out repository source, invoke KiCad, materialize a source workspace, or execute customer commands. Target-repository GitHub Actions or a separately enrolled customer-hosted runner remain the execution plane.

The cloud build emits `apps/web/.next/worker-meta.json` from esbuild and runs `pnpm run verify:control-plane-worker-boundary`. The build fails if the worker dependency graph contains KiCad execution modules, repository checkout/source-workspace modules, runner executors, or `child_process`. Treat a boundary-verifier failure as an architectural regression rather than bypassing the check.

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

The worker readiness response also reports the database/configuration state, the latest lifecycle, outbox, and workflow-reconciliation polls, the latest successful reconciliation, and scoped-concurrency `active` and `waiting` counts. A worker sets readiness false before graceful shutdown and stops claiming new batches. Existing leased work drains before the database pool closes; after an ungraceful termination, PostgreSQL lease expiry makes unfinished work claimable by another replica.

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

## Independent worker scaling

The lifecycle and outbox batch limits are independent from the web process. Scale worker replicas only after accounting for database connections and GitHub API throughput:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --scale worker=2
```

`BOARDREADYOPS_WORKER_CONCURRENCY` and `BOARDREADYOPS_OUTBOX_CONCURRENCY` cap each replica's claimed batch. The shared in-process gate then caps concurrent work per installation and repository across both loops. These scoped limits are per replica, so the effective upper bound is the configured limit multiplied by the number of replicas. Database leases preserve single ownership of each job/effect; they do not provide a distributed GitHub API rate limiter.

Recommended initial values are four lifecycle jobs, four outbox effects, four operations per installation, and two operations per repository per replica. Increase them only with queue-lag, GitHub rate-limit, database pool, and readiness data.

## Rolling deployment and rollback

Use an application-first rolling deployment:

1. Apply forward-compatible additive migrations once.
2. Deploy and verify the web canary.
3. Replace the web container.
4. Withdraw one worker replica from readiness and terminate it with SIGTERM.
5. Allow active leases to drain, then start the new worker image.
6. Verify `/health/ready`, queue metrics, and outbox lag before replacing additional replicas.

For rollback, stop new worker replicas, deploy the previous compatible immutable image for web and worker, and retain the current database schema. Do not automatically reverse migrations. Any work left by a killed replica becomes available after lease expiry. Reconciliation-required workflow dispatches remain operator-controlled and must not be blindly replayed.

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
BOARDREADYOPS_WORKER_INSTALLATION_CONCURRENCY=4
BOARDREADYOPS_WORKER_REPOSITORY_CONCURRENCY=2
BOARDREADYOPS_WORKER_POLL_MS=1000
BOARDREADYOPS_OUTBOX_CONCURRENCY=4
BOARDREADYOPS_OUTBOX_POLL_MS=500
BOARDREADYOPS_WORKER_METRICS_INTERVAL_MS=30000
BOARDREADYOPS_WORKER_RETENTION_CLEANUP_INTERVAL_MS=3600000
BOARDREADYOPS_RECONCILIATION_CONCURRENCY=2
BOARDREADYOPS_RECONCILIATION_POLL_MS=5000
BOARDREADYOPS_RECONCILIATION_DETECT_INTERVAL_MS=30000
BOARDREADYOPS_RECONCILIATION_OBSERVATION_SECONDS=300
BOARDREADYOPS_RECONCILIATION_DEADLINE_SECONDS=1800
BOARDREADYOPS_RECONCILIATION_NEXT_CHECK_SECONDS=60
```

The same reconciliation cadence covers both missed GitHub Actions callbacks and terminal Check Run publication drift. The worker readiness payload reports `lastCheckRunReconciliationPollAt` and `lastSuccessfulCheckRunReconciliationAt` separately so operators can distinguish publication repair from workflow-state convergence.

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
