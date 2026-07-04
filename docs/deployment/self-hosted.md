# Self-hosted BoardReadyOps Cloud deployment

This guide describes the first self-hosted MVP target for `boardreadyops.oaslananka.dev` on `ops-vps-02`.

## Target topology

```text
Cloudflare DNS
  -> boardreadyops.oaslananka.dev
  -> ops-vps-02 / 46.101.195.208
  -> Docker Compose Caddy service
  -> Docker Compose internal web service on web:3000
  -> PostgreSQL, Redis, and local artifact volume
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
/opt/repos/boardreadyops-cloud-skeleton   # source worktree
/opt/boardreadyops-cloud                  # deployment env and runtime files
```

## Host requirements

Install Docker Engine and the Docker Compose v2 plugin on the VPS. Caddy, PostgreSQL, and Redis run inside Docker Compose for the MVP.

## Deploy

```bash
cp deploy/env.example deploy/.env
# Edit deploy/.env before public deployment.
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

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

## Next milestones

1. Add GitHub App installation handling.
2. Persist release runs to PostgreSQL.
3. Add check-run and sticky PR comment lifecycle.
4. Add signed artifact upload and download endpoints.
5. Add GitHub Actions dispatch runner integration.
6. Add a managed worker container.

## Repeatable VPS deploy from main

After a change is merged to `main`, deploy the live VPS app from a clean main worktree:

```bash
cd /opt/repos/boardreadyops-prod
git fetch origin --prune
git checkout prod-main
git reset --hard origin/main
pnpm run cloud:deploy:self-hosted
```

The deploy script performs these steps:

1. Installs dependencies with `pnpm install --frozen-lockfile`.
2. Builds `@boardreadyops/web` with Next.js.
3. Backs up the current `.next` output from the live `bro-web` container.
4. Copies the new `.next` output into the container.
5. Restarts the container.
6. Verifies `https://boardreadyops.oaslananka.dev/api/health`.
7. Restores the previous `.next` output and restarts the container if the health check fails.

Supported environment overrides:

```text
BOARDREADYOPS_CLOUD_CONTAINER=bro-web
BOARDREADYOPS_CLOUD_HEALTH_URL=https://boardreadyops.oaslananka.dev/api/health
BOARDREADYOPS_CLOUD_BACKUP_ROOT=/opt/boardreadyops-cloud/backups
BOARDREADYOPS_CLOUD_SKIP_INSTALL=1
BOARDREADYOPS_CLOUD_DRY_RUN=1
```

For a dry run:

```bash
BOARDREADYOPS_CLOUD_DRY_RUN=1 pnpm run cloud:deploy:self-hosted
```
