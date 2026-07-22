# Crash-Recoverable Control-Plane Worker Design

## Goal

Complete issue #189 by hardening the existing control-plane worker as an independently scalable orchestration service with scoped concurrency, complete operational correlation, defensive log redaction, and an enforceable boundary that prevents it from becoming a KiCad execution plane.

## Current foundation

The repository already provides a separately bundled `apps/web/worker.ts` process, durable webhook jobs, transactional outbox delivery, PostgreSQL leases with expiry, bounded batch concurrency, graceful shutdown, health/readiness/version endpoints, queue metrics, and self-hosted deployment documentation. This work extends that foundation rather than introducing another worker package or queue.

## Architecture

### Runtime support module

Create `apps/web/lib/control-plane-worker-runtime.ts` as a focused, side-effect-free support module. It owns:

- extraction of safe correlation fields from claimed lifecycle jobs and outbox effects;
- recursive redaction of sensitive log fields and credential-like strings;
- derivation of installation and repository scope keys; and
- a reusable in-process scoped concurrency gate shared by lifecycle and outbox loops.

`apps/web/worker.ts` remains the process entry point and wires database stores, GitHub clients, polling loops, health endpoints, configuration, and shutdown together.

### Scoped concurrency

The worker keeps the existing overall lifecycle and outbox concurrency limits. A shared gate additionally limits simultaneous work per GitHub installation and per repository across both loops in the same process.

Configuration:

- `BOARDREADYOPS_WORKER_INSTALLATION_CONCURRENCY`, default `4`, range `1..32`;
- `BOARDREADYOPS_WORKER_REPOSITORY_CONCURRENCY`, default `2`, range `1..32`.

Items without an installation or repository identity use only the global batch limits. The gate is process-local; horizontal scaling remains safe because jobs and outbox effects are database-leased, while API throughput must account for the number of worker replicas.

### Correlated structured logs

Every terminal job/effect log includes all available safe identifiers:

- `deliveryId`;
- `installationId`;
- `repositoryId` and `repository`;
- `releaseRunId`;
- `executionAttemptId`;
- `jobId`;
- `outboxId`;
- `effectType`.

No raw webhook payload, repository source, normalized findings, OIDC token/envelope, signed capability, private key, access token, authorization header, or secret is logged.

### Redaction

All structured log fields pass through a recursive sanitizer before serialization. Keys matching credential, OIDC, capability, source-content, or findings patterns are replaced with `[REDACTED]`. String values also redact credential assignments and bearer tokens and are bounded to prevent oversized logs. Error logging continues to use error class only at the process boundary.

### Execution-plane boundary

The control-plane worker bundle must remain orchestration-only. The build step emits an esbuild metafile and fails when the bundle includes forbidden execution-plane dependencies or source paths, including KiCad execution modules, local command execution, repository checkout helpers, or source-workspace materialization.

The verifier is deterministic and runs as part of `cloud:build` and unit tests. Database drivers, HTTP clients, crypto, and control-plane domain packages remain allowed.

## Failure and shutdown behavior

- Accepted work remains authoritative in PostgreSQL before the webhook route returns success.
- Claimed jobs/effects are completed or failed through their stores.
- On SIGINT/SIGTERM, readiness is withdrawn, new claims stop, active tasks drain, the health server closes, and the database pool closes.
- If a process terminates before draining, lease expiry makes work claimable by another worker.
- Scoped-gate waiters are part of active loop promises and therefore drain under graceful shutdown.

## Testing

Unit tests cover correlation extraction, nested redaction, bearer/credential sanitization, and concurrent installation/repository limits. Boundary tests cover allowed and forbidden esbuild metafiles. Existing PostgreSQL integration tests continue to prove lease expiry, retry, outbox, and lifecycle compatibility. CI must pass on Node.js 22 and 24.

## Deployment and rollback

Self-hosted documentation must describe independent web/worker scaling, new rate-control variables, readiness behavior, rolling deployment order, and rollback. Rollback is application-first: stop new worker replicas, deploy the previous compatible image, retain the database schema, and allow expired leases to be reclaimed. Migrations remain forward-compatible and are not automatically reversed.

## Non-goals

- No shared BoardReadyOps-managed KiCad execution fleet.
- No source checkout or artifact processing in the control-plane worker.
- No distributed rate-limit service or new infrastructure dependency.
- No reconciliation operator UI; that remains issue #190.
