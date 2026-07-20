# VPS-Independent Cloud Foundation Design

**Date:** 2026-07-20  
**Status:** Approved direction; implementation pending  
**Scope:** First migration increment for BoardReadyOps Cloud

## Context

The six temporary VPS instances expire in August 2026. BoardReadyOps Cloud must therefore stop treating a long-lived server, local filesystem, or permanently running process as a production prerequisite.

This increment does not move the application to Cloudflare Workers or Neon yet. It establishes the runtime guarantees required before that migration: explicit production configuration, fail-closed persistence, meaningful health endpoints, and testable dependency checks.

## Goals

1. Prevent accepted GitHub lifecycle webhooks from being silently discarded when `DATABASE_URL` is missing.
2. Separate process liveness from traffic readiness.
3. Make readiness reflect required configuration and database connectivity.
4. Keep local and test workflows explicit rather than relying on an automatic no-op production fallback.
5. Introduce boundaries that can later support Neon and Cloudflare-compatible adapters without changing route behavior.

## Non-goals

- Migrating Next.js to Cloudflare Workers/OpenNext.
- Adding Cloudflare Queues, R2, D1, or Workflows.
- Moving PostgreSQL data to Neon.
- Implementing the webhook inbox, durable job queue, transactional outbox, or reconciliation worker.
- Refactoring the complete lifecycle result route.
- Changing the GitHub Actions execution model.

## Runtime Configuration Policy

Production-capable routes must fail closed when required dependencies are absent.

### Persistence modes

BoardReadyOps Cloud supports two explicit persistence modes:

- `postgres`: required for deployed environments and uses `DATABASE_URL`.
- `memory`: allowed only when `NODE_ENV` is `test`, or when an explicit local-development override is enabled.

There is no automatic fallback from PostgreSQL to an in-memory/no-op store.

For the first implementation increment, the existing no-op lifecycle store may remain available internally for tests, but route code must obtain it only through an explicit test/development configuration path.

### Required deployed configuration

The readiness check considers these values mandatory for the current cloud control plane:

- `DATABASE_URL`
- `GITHUB_WEBHOOK_SECRET`

GitHub App credentials are not included in this first readiness contract because some lifecycle events and local test paths do not require an outbound GitHub API call. They will be added when outbound operations are moved behind a durable worker and configuration is centralized.

## Health Endpoints

### `GET /api/health/live`

Purpose: determine whether the application process can execute requests.

Response:

```json
{
  "ok": true,
  "service": "boardreadyops-cloud",
  "check": "liveness"
}
```

It does not access PostgreSQL or external services. It returns HTTP 200 while the process is alive.

### `GET /api/health/ready`

Purpose: determine whether the application can safely accept production traffic.

Checks:

1. Required environment configuration is present.
2. A PostgreSQL query executor can be created.
3. `SELECT 1` succeeds within a bounded timeout.

Success returns HTTP 200:

```json
{
  "ok": true,
  "service": "boardreadyops-cloud",
  "check": "readiness",
  "checks": {
    "configuration": "pass",
    "database": "pass"
  }
}
```

Failure returns HTTP 503 with stable machine-readable reason codes. Responses must not include connection strings, credentials, raw SQL errors, stack traces, or database hostnames.

Example configuration failure:

```json
{
  "ok": false,
  "service": "boardreadyops-cloud",
  "check": "readiness",
  "reason": "missing-configuration",
  "missing": ["DATABASE_URL"]
}
```

Example connectivity failure:

```json
{
  "ok": false,
  "service": "boardreadyops-cloud",
  "check": "readiness",
  "reason": "database-unavailable"
}
```

The existing `/api/health` endpoint remains temporarily as a compatibility alias for liveness. Deployment health checks will be updated in a later increment to use `/api/health/ready`.

## Lifecycle Store Behavior

`getGitHubAppLifecycleStore()` must no longer silently create a no-op store when `DATABASE_URL` is absent.

The resolver will:

1. Return a cached explicitly configured store when available.
2. Use PostgreSQL when `DATABASE_URL` is configured.
3. Permit an in-memory/no-op implementation only in an explicit test/development mode.
4. Throw a typed configuration error otherwise.

The GitHub webhook route catches this configuration error and returns HTTP 503 with a stable response:

```json
{
  "ok": false,
  "error": "cloud persistence is not configured"
}
```

Webhook signature validation still happens before persistence resolution. Invalid signatures therefore remain HTTP 401 and do not expose configuration state.

Unsupported webhook events remain acknowledged with HTTP 202 without requiring a lifecycle store because no persistent action is executed.

## Component Boundaries

### Cloud runtime configuration module

A small module under `apps/web/lib` owns:

- required environment parsing;
- persistence-mode decisions;
- safe configuration error types;
- numeric pool-size parsing.

Routes must not independently interpret production/test fallback behavior.

### Readiness service

A framework-independent helper owns readiness evaluation. The Next.js route only converts its result into an HTTP response.

The helper accepts injected dependencies so tests do not require a real PostgreSQL server:

```ts
checkCloudReadiness({
  environment,
  queryDatabase,
  timeoutMs,
})
```

### PostgreSQL executor lifecycle

The current `SqlQueryExecutor` interface exposes only `query`. This increment will not redesign connection lifecycle globally. Readiness may use a dedicated short-lived `pg` client or a small probe function that always closes its connection.

The long-lived lifecycle store continues to use the existing pooled executor until the serverless database adapter increment.

## Error Handling

- Configuration errors are deterministic and safe to expose through stable reason codes.
- Database errors are logged only through the existing runtime logging mechanism if one is available; HTTP responses remain generic.
- Readiness checks use a bounded timeout so orchestration platforms do not accumulate hanging probes.
- No secret values are returned or logged by new code.
- The webhook route returns 503 rather than 202 when an accepted lifecycle event cannot be persisted.

## Testing Strategy

### Unit tests

Add tests for:

- liveness response;
- readiness success using an injected successful probe;
- missing `DATABASE_URL`;
- missing `GITHUB_WEBHOOK_SECRET`;
- database probe failure;
- database probe timeout;
- no secret leakage in readiness responses;
- lifecycle store refusing implicit no-op fallback;
- explicit test-mode lifecycle store behavior;
- webhook returning 503 for accepted events without persistence;
- unsupported events still returning 202 without persistence;
- signature validation taking precedence over configuration errors.

### Static verification

Run:

- focused Vitest files;
- `pnpm run cloud:typecheck`;
- Biome checks for changed files;
- the complete relevant web unit-test subset.

No external database is required for this increment's unit tests.

## Rollout

1. Merge the configuration and health foundation while `/api/health` remains a liveness alias.
2. Update local compose and deployment configuration to provide explicit persistence settings.
3. Switch deployment health checks to `/api/health/ready` after the endpoint is deployed.
4. Add webhook inbox and durable jobs.
5. Introduce Neon-compatible database access.
6. Migrate Next.js and webhook ingress to Cloudflare.
7. Remove VPS deployment artifacts only after a full restore and cutover rehearsal.

## Acceptance Criteria

- An accepted lifecycle webhook cannot return success when persistence is unavailable.
- An invalid webhook signature remains HTTP 401 regardless of database configuration.
- `/api/health/live` is dependency-free and returns HTTP 200.
- `/api/health/ready` returns HTTP 503 when required configuration or PostgreSQL is unavailable.
- Readiness responses contain no secrets or raw infrastructure errors.
- Existing supported behavior remains covered by tests.
- The implementation introduces no Cloudflare- or Neon-specific dependency yet.
