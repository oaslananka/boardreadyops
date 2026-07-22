# PostgreSQL Transactional Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issue #188 by moving GitHub Check Run and workflow-dispatch side effects behind a lease-based PostgreSQL transactional outbox with bounded retries, deterministic idempotency, safe dead-letter replay, and operational metrics.

**Architecture:** The existing `control_plane_jobs` queue remains responsible for durable webhook lifecycle work. Lifecycle jobs commit authoritative database state and required outbox records before they are marked complete; a separate outbox dispatcher owns external GitHub calls. Check Run creation is replay-safe through the existing `external_id = runId` binding, while workflow dispatch uses GitHub's run-detail response and treats an expired in-flight delivery as reconciliation-required instead of automatically issuing a potentially duplicate dispatch.

**Tech Stack:** PostgreSQL PL/pgSQL, TypeScript 6, Node.js 24, `pg`, Vitest, GitHub App installation tokens, GitHub Actions workflow-dispatch API.

## Global Constraints

- PostgreSQL remains the authoritative queue; do not add NATS, SQS, RabbitMQ, Redis, Temporal, or another broker.
- Every external effect must have a unique deterministic idempotency key and a payload version of `1`.
- Payloads and error fields must be bounded and must not contain installation tokens, private keys, webhook secrets, or unredacted credentials.
- Queue and outbox claims must use `FOR UPDATE SKIP LOCKED` and bounded leases.
- An uncertain non-idempotent workflow dispatch must not be automatically replayed.
- Existing webhook `202 Accepted` behavior, lifecycle contracts, runner OIDC binding, and target-repository execution architecture must remain unchanged.
- All GitHub Actions and security workflows must pass; bot and agent comments/review threads must be checked before merge.

---

### Task 1: Schema v16 transactional outbox

**Files:**
- Create: `packages/db/migrations/0016_control_plane_transactional_outbox.sql`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/unit/db/migrations.test.ts`
- Test: `tests/integration/control-plane-outbox-postgres.test.ts`

**Interfaces:**
- Produces: PostgreSQL table `control_plane_outbox` and functions `boardreadyops_claim_control_plane_outbox`, `boardreadyops_complete_control_plane_outbox`, `boardreadyops_fail_control_plane_outbox`, `boardreadyops_replay_control_plane_outbox`.
- Statuses: `available | leased | completed | dead_letter | reconciliation_required`.
- Effect types: `github.check_run.create | github.check_run.complete | github.workflow.dispatch`.

- [ ] **Step 1: Write migration contract tests**

Add schema-version `16`, model `ControlPlaneOutbox`, migration ordering through `0016_control_plane_transactional_outbox.sql`, bounded JSON payload checks, unique idempotency key, lease constraints, `FOR UPDATE SKIP LOCKED`, reconciliation-required handling, replay guard, and `security invoker` assertions.

- [ ] **Step 2: Run the focused migration test and confirm RED**

Run: `corepack pnpm exec vitest run tests/unit/db/migrations.test.ts`

Expected: failure because schema version is `15` and migration `0016_control_plane_transactional_outbox.sql` does not exist.

- [ ] **Step 3: Add schema v16**

Create a table with these required columns:

```sql
id text primary key,
effect_type text not null,
payload_version integer not null default 1,
idempotency_key text not null unique,
payload jsonb not null,
priority smallint not null default 100,
status text not null default 'available',
available_at timestamptz not null,
attempt_count integer not null default 0,
max_attempts integer not null default 8,
lease_owner text,
lease_expires_at timestamptz,
created_at timestamptz not null,
delivery_started_at timestamptz,
completed_at timestamptz,
external_result jsonb,
last_error_class text,
last_error_message text
```

The claim function must recover expired leases. Idempotent Check Run effects may return to `available`; an expired `github.workflow.dispatch` whose `delivery_started_at` is non-null must become `reconciliation_required` so the worker cannot emit a second dispatch blindly.

- [ ] **Step 4: Add PostgreSQL integration coverage**

Cover concurrent single ownership, expired idempotent lease recovery, uncertain workflow-dispatch quarantine, retry exhaustion, dead-letter replay, stale worker completion, and transaction rollback.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
corepack pnpm exec vitest run tests/unit/db/migrations.test.ts
DATABASE_URL=postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_test corepack pnpm exec vitest run tests/integration/control-plane-outbox-postgres.test.ts
```

Expected: PASS.

Commit: `feat(db): add transactional outbox schema`

### Task 2: Typed outbox store and metrics

**Files:**
- Create: `packages/db/src/control-plane-outbox-store.ts`
- Modify: `packages/db/package.json`
- Test: `tests/unit/db/control-plane-outbox-store.test.ts`

**Interfaces:**
- Produces: `ControlPlaneOutboxStore`, `ClaimedControlPlaneOutboxEffect`, `ControlPlaneOutboxMetrics`, `createSqlControlPlaneOutboxStore`, and `createMemoryControlPlaneOutboxStore`.
- Methods: `claimEffects`, `markDeliveryStarted`, `completeEffect`, `failEffect`, `replayEffect`, `collectMetrics`.

- [ ] **Step 1: Write store tests first**

Verify SQL function names and parameters, typed payload decoding, lease bounds, exponential retry capped at 3600 seconds, bounded/redacted errors, replay rejection for `reconciliation_required`, and metrics for available depth, oldest age, leased, retry, dead-letter, reconciliation-required, and outbox lag.

- [ ] **Step 2: Run the unit test and confirm RED**

Run: `corepack pnpm exec vitest run tests/unit/db/control-plane-outbox-store.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the store**

Use discriminated payloads:

```ts
type ControlPlaneOutboxPayload =
  | { version: 1; type: "github.check_run.create"; action: EnqueueReleaseRunInput; runId: string; idempotencyKey: string }
  | { version: 1; type: "github.check_run.complete"; input: CompleteGitHubCheckRunInput }
  | { version: 1; type: "github.workflow.dispatch"; input: DispatchReleaseRunWorkflowInput };
```

Reject rows whose effect type, payload version, or payload discriminator disagree.

- [ ] **Step 4: Export and verify**

Add `./control-plane-outbox-store` to `packages/db/package.json` exports.

Run: `corepack pnpm exec vitest run tests/unit/db/control-plane-outbox-store.test.ts`

Expected: PASS.

Commit: `feat(db): add typed outbox store`

### Task 3: Atomically plan lifecycle side effects

**Files:**
- Modify: `packages/cloud-core/src/lifecycle-executor.ts`
- Modify: `packages/db/src/lifecycle-store.ts`
- Modify: `packages/db/migrations/0016_control_plane_transactional_outbox.sql`
- Modify: `apps/web/lib/control-plane-worker.ts`
- Test: `tests/unit/cloud-core/lifecycle-executor.test.ts`
- Test: `tests/unit/db/lifecycle-store.test.ts`
- Test: `tests/unit/web/control-plane-worker.test.ts`

**Interfaces:**
- Produces: `GitHubAppDurableLifecycleStore.enqueueReleaseRunWithOutbox(action)`.
- The durable worker path must not accept direct `checkRuns` or `workflowDispatch` clients.

- [ ] **Step 1: Write crash-window regression tests**

Assert that processing `release_run.enqueue` writes authoritative run state plus a Check Run outbox record, marks the lifecycle job complete without calling GitHub, and returns the same outbox record on duplicate webhook processing.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/cloud-core/lifecycle-executor.test.ts tests/unit/db/lifecycle-store.test.ts tests/unit/web/control-plane-worker.test.ts
```

Expected: failures because lifecycle execution still calls external clients directly.

- [ ] **Step 3: Add atomic release-run planning**

Add a PL/pgSQL function that performs release-run enqueue/supersession and inserts `github.check_run.create` with idempotency key `github.check_run.create:<runId>` in the same transaction. `ON CONFLICT (idempotency_key)` must return the existing record without resetting terminal state.

- [ ] **Step 4: Switch the durable worker path**

Keep the legacy executor only for isolated pure-client tests if still needed, but make `processControlPlaneJob` use the durable lifecycle store and complete the queue job immediately after database state plus outbox commit.

- [ ] **Step 5: Verify and commit**

Run focused tests above plus `corepack pnpm run typecheck`.

Expected: PASS.

Commit: `refactor(cloud): plan GitHub effects transactionally`

### Task 4: Idempotent Check Run and workflow dispatch delivery

**Files:**
- Modify: `apps/web/lib/github-app-check-run-client.js`
- Modify: `apps/web/lib/github-app-check-run-client.d.ts`
- Modify: `apps/web/lib/runner-client.js`
- Modify: `apps/web/lib/runner-client.d.ts`
- Create: `apps/web/lib/control-plane-outbox-worker.ts`
- Test: `tests/unit/web/github-app-check-run-client.test.ts`
- Test: `tests/unit/web/runner-client.test.ts`
- Test: `tests/unit/web/control-plane-outbox-worker.test.ts`

**Interfaces:**
- Produces: `ensurePullRequestCheckRun(input)` and `dispatchReleaseRunWorkflow(input)` returning `{ workflowDispatchId, workflowRunUrl? }`.
- Produces: `processControlPlaneOutboxEffect(effect, dependencies)`.

- [ ] **Step 1: Write delivery tests first**

Check Run replay must list check runs for the target SHA and reuse a record whose `external_id` equals `runId`; it may POST only when no match exists. Workflow dispatch must send `return_run_details: true`, parse `workflow_run_id`, and persist that ID through outbox completion.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/web/github-app-check-run-client.test.ts tests/unit/web/runner-client.test.ts tests/unit/web/control-plane-outbox-worker.test.ts
```

Expected: failures because ensure semantics and outbox dispatcher do not exist.

- [ ] **Step 3: Implement Check Run ensure semantics**

Use `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` and match both Check Run name and `external_id`. Return the existing numeric ID or create one with `external_id: runId`.

- [ ] **Step 4: Return workflow run details**

Send `return_run_details: true`, require a numeric `workflow_run_id`, and return it as a string. Do not infer success from a `204` response in the durable path.

- [ ] **Step 5: Implement effect dispatch and commit**

Before the network call, persist `delivery_started_at`. On success, call `completeEffect` with a bounded `external_result`. On a definite pre-delivery failure, call `failEffect`; uncertain workflow delivery must be classified for reconciliation rather than automatic retry.

Run focused tests and `corepack pnpm run typecheck`.

Expected: PASS.

Commit: `feat(cloud): dispatch transactional outbox effects`

### Task 5: Run both queues, expose operations, and document broker triggers

**Files:**
- Modify: `apps/web/worker.ts`
- Modify: `docs/deployment/self-hosted.md`
- Create: `docs/architecture/transactional-outbox.md`
- Modify: `tests/unit/web/control-plane-worker-entrypoint.test.ts`
- Modify: `tests/integration/control-plane-outbox-postgres.test.ts`

**Interfaces:**
- Worker polls lifecycle jobs and outbox effects independently with bounded concurrency.
- Metrics event includes `outboxAvailable`, `outboxLeased`, `outboxDeadLetter`, `outboxReconciliationRequired`, `oldestOutboxAgeSeconds`, and `outboxLagSeconds`.

- [ ] **Step 1: Write worker orchestration tests first**

Verify that slow or poisoned outbox work does not block unrelated lifecycle jobs, shutdown waits for both active pools, metrics contain no tenant identifiers, and operator replay cannot bypass reconciliation-required safeguards.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `corepack pnpm exec vitest run tests/unit/web/control-plane-worker-entrypoint.test.ts tests/integration/control-plane-outbox-postgres.test.ts`

Expected: failures because the worker has only one queue.

- [ ] **Step 3: Wire independent polling and health state**

Add environment controls `BOARDREADYOPS_OUTBOX_CONCURRENCY` and `BOARDREADYOPS_OUTBOX_POLL_MS`, both validated with the existing integer parser. Readiness requires database access and valid client configuration but does not require the queue to be empty.

- [ ] **Step 4: Document operations and transition triggers**

Document replay procedure, reconciliation-required procedure, alert thresholds, and these broker migration triggers: sustained claim latency above 250 ms, oldest available age above 30 seconds while workers are healthy, or sustained throughput above 500 effects/second for 15 minutes after database/index tuning.

- [ ] **Step 5: Full verification and commit**

Run:

```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test:unit
corepack pnpm run test:int
corepack pnpm run build
corepack pnpm run verify:dist
corepack pnpm run security
```

Expected: PASS.

Commit: `feat(cloud): operate durable outbox delivery`

### Task 6: PR evidence and issue closure

**Files:**
- Modify: PR description for issue #188
- Update: issue #188 task checklist after verified merge

- [ ] **Step 1: Open the PR as draft during the first RED commit**

The body must identify #188, the crash windows being closed, the non-idempotent dispatch uncertainty policy, migrations, metrics, and exact verification commands.

- [ ] **Step 2: Inspect all automation feedback**

Review CodeRabbit/agent reviews, inline review threads, Codecov, SonarQube, CodeQL, Semgrep, OSV, Dependency Review, actionlint, and zizmor. Apply only technically correct recommendations and explain any rejected suggestion in the PR thread.

- [ ] **Step 3: Mark ready and merge only after green evidence**

Require full CI, security, OSV, integration PostgreSQL tests, no unresolved actionable bot/agent thread, and a mergeable head SHA.

- [ ] **Step 4: Update issue #188**

Check completed tasks, link the merged PR and migration, record broker transition triggers, and close the issue only when every acceptance criterion has direct test or operational evidence.
