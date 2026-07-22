# Control-Plane Reconciliation and Operations Design

## Goal

Complete issue #190 in staged, reviewable slices. This first slice establishes tenant-scoped dead-letter operations, durable reconciliation work, audited replay primitives, and privacy-safe service indicators. Later slices add GitHub state convergence and synthetic canaries on top of these contracts.

## Existing foundation

BoardReadyOps already persists webhook intake, lifecycle jobs, release runs, execution attempts, transactional outbox effects, and append-only tenant-scoped audit events in PostgreSQL. Jobs and outbox effects have bounded retries, leases, dead-letter states, and queue metrics. Uncertain workflow dispatches become `reconciliation_required` and are deliberately not replayed automatically.

## Architecture

### Operations store

Add `packages/db/src/control-plane-operations-store.ts` as the sole database boundary for operator-facing dead-letter and reconciliation controls. It exposes:

- tenant-scoped listing of dead-letter lifecycle jobs and outbox effects;
- stable reason classification without returning payloads, source, findings, or credentials;
- idempotent replay of replay-safe dead letters;
- durable reconciliation candidate enqueue/claim/complete/fail operations;
- privacy-safe SLI snapshots; and
- append-only audit events for replay and reconciliation decisions.

Every read and mutation requires an internal installation ID. Repository and release-run dimensions are resolved through foreign-key joins and validated in SQL.

### Durable reconciliation queue

Create `control_plane_reconciliation_items` with one active row per subject and reason. Supported subjects in this slice are:

- lifecycle jobs;
- outbox effects;
- release runs; and
- execution attempts.

Each item records the tenant, repository/run dimensions, reason code, deadline, next check, lease, attempts, terminal public failure reason, and repair outcome. Payloads are intentionally absent. A partial unique index prevents duplicate active work for the same subject/reason.

The worker will claim this queue in a later slice. This slice supplies the durable queue and store contracts so operator replay and periodic detection can share one state model.

### Dead-letter replay safety

Lifecycle jobs may be replayed only from `dead_letter`. Outbox effects may be replayed only from `dead_letter`; `reconciliation_required` workflow dispatches remain non-replayable until authoritative GitHub state has been checked. Replays reset attempt/lease/error state, preserve idempotency keys, and append an audit event in the same transaction.

Replay requests include a caller-provided operation ID. A tenant-and-operation advisory transaction lock serializes concurrent retries before the database reads replay state or locks the target item. The operation record uses the same ID as the audit request ID, so concurrent or repeated delivery returns the previously recorded outcome instead of executing twice.

### Reason classification

Public reason codes are stable, bounded identifiers such as:

- `retry_exhausted`;
- `lease_expired`;
- `delivery_uncertain`;
- `callback_missing`;
- `dispatch_stale`;
- `attempt_stale`;
- `reporting_stale`; and
- `operator_replay_required`.

Raw exception messages remain internal. List responses expose only the stable reason code, error class, timestamps, attempt counts, and safe tenant/resource identifiers.

### Service indicators

The operations store computes aggregate, content-free indicators:

- webhook acceptance latency percentiles;
- lifecycle queue age;
- outbox lag;
- dispatch latency;
- completion latency;
- stale non-terminal attempts;
- reconciliation backlog and repair counts; and
- terminal failure rate.

Metrics are grouped only by installation and optional repository. No source paths, findings, artifact names, commit messages, or payload data are returned.

## Migration

Add migration `0019_control_plane_reconciliation_operations.sql` containing:

- durable reconciliation table, constraints, and claim indexes;
- replay operation idempotency table;
- tenant-scoped dead-letter listing functions;
- atomic audited replay functions for jobs and outbox effects;
- reconciliation enqueue/claim/complete/fail functions; and
- SLI query support indexes.

The migration is additive and forward-compatible. Rollback is application-first; the schema remains in place when reverting binaries.

## Testing

- Migration tests assert constraints, tenant joins, replay guards, audit writes, and absence of payload columns.
- Unit tests verify row decoding, bounded inputs, reason classification, and exact SQL calls.
- `tests/integration/control-plane-operations-postgres.test.ts` proves cross-tenant reads and mutations are rejected, concurrent repeated operation IDs are serialized and idempotent, reconciliation-required dispatches cannot be replayed, successful replay is audited once, and final reconciliation leases expire to a stable dead-letter state.

## Security and privacy

- Installation scope is mandatory for every operator operation.
- The store never returns webhook actions or outbox payload JSON.
- Persisted failure text redacts bearer values and credential assignments with bounded per-key matching.
- Audit metadata contains only stable reason/outcome identifiers and safe IDs.
- Reconciliation workers obtain GitHub state through installation credentials in a later slice; no repository token is persisted.
- Operator endpoints will be added only after the database contracts are complete and tested.

## Delivery slices

1. **Foundation:** migration, operations store, tests, SLI snapshot, audited replay.
2. **Convergence worker:** periodic candidate detection and tenant-scoped GitHub check/workflow reconciliation.
3. **Operator API and runbooks:** authenticated listing/replay controls, alerts, SLOs, and incident recovery documentation.
4. **Canaries:** synthetic public/private target-repository canaries independent of a persistent KiCad worker.
