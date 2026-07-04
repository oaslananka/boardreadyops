# Self-hosted BoardReadyOps Cloud deployment

This guide describes the first self-hosted MVP target for `boardreadyops.oaslananka.dev` on `ops-vps-02`.

## Target topology

```text
Cloudflare DNS
  -> boardreadyops.oaslananka.dev
  -> ops-vps-02 / 46.101.195.208
  -> Caddy on the host
  -> Docker Compose web service on 127.0.0.1:3000
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

Install Docker Engine, Docker Compose plugin, and Caddy on the VPS. PostgreSQL and Redis run inside Docker Compose for the MVP.

## Deploy

```bash
cp deploy/env.example deploy/.env
# Edit deploy/.env before public deployment.
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

Copy the Caddyfile after Caddy is installed:

```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
systemctl reload caddy
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
