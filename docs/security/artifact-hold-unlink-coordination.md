# Legal-hold admission versus irreversible artifact unlink: safety contract

Status: **source-level barrier implemented; production rollout and operational acceptance pending**.
Migration `0104_durable_artifact_unlink_fences.sql` and the corresponding local
artifact-deletion worker code implement a persistent, fail-closed unlink fence.
This is neither permission to deploy, unlink customer artifacts or change legal
holds, nor evidence that every production worker uses the guarded path.
See the [operator rollout and recovery contract](durable-artifact-unlink-operations.md).

## Hazard and required ordering

The original pre-fence worker authorized a leased deletion in one PostgreSQL
statement, returned the connection to the pool, and then unlinked a local file.
A concurrent transaction could acknowledge a tenant legal hold before the
physical unlink completed. The earlier disposable two-client reproduction
characterized that defect; it is **historical baseline evidence**, not the
current source behavior. Older or independently deployed workers can still
present this risk unless explicitly quiesced during a controlled rollout.

**Required invariant:** A successfully acknowledged applicable legal hold cannot
coexist with an in-flight, unaccounted irreversible unlink of the protected object.
An unlink already in progress must finish before hold acknowledgement *or* force
a truthful, actionable hold-admission rejection. Connection failure or retry must
never implicitly clear a destructive reservation.

## Source implementation: persisted, fail-closed deletion intent

The [0104 schema barrier](https://github.com/oaslananka/boardreadyops/blob/main/packages/db/migrations/0104_durable_artifact_unlink_fences.sql),
[deletion store](https://github.com/oaslananka/boardreadyops/blob/main/packages/db/src/artifact-deletion-store.ts) and
[local deletion worker](https://github.com/oaslananka/boardreadyops/blob/main/apps/web/lib/artifact-deletion-worker.ts) implement
the fenced path. This source implementation is exercised by the
[PostgreSQL integration tests](https://github.com/oaslananka/boardreadyops/blob/main/tests/integration/artifact-deletion-store-postgres.test.ts),
including independent hold writers, lease expiry, unlink and crash scenarios.
Tests are not a substitute for deployment/worker-topology verification.

A short transaction-scoped lock by itself does not cover an external filesystem
call: PostgreSQL releases that lock on disconnect even if unlink continues.
Prefer a **durable deletion-intent marker**, with short tenant coordination
transactions and explicit terminal recovery:

1. Resolve the *authoritative* tenant/account identity and all shared storage
   owners. Canonical identity must survive GitHub casing changes, account rename,
   and multiple installations. Do not trust the caller's login string for scope.
2. Under the same deterministic tenant coordination protocol used by hold
   admission, revalidate lease, worker identity, current holds and object scope.
   Commit a durable in-progress intent **before** permitting filesystem unlink.
   If the commit outcome is unknown, do not call unlink.
3. All hold creation/reactivation paths (including independently deployed SQL
   writers) must participate. An unresolved intent blocks or rejects successful
   hold acknowledgement; an API must not display a successful hold when rejected.
4. A pending intent persists across lease expiry, process crash, DB disconnect,
   stuck I/O, restart, and failed completion. The claim path must not reclaim
   a job whose irreversible outcome is uncertain. A TTL alone cannot clear it.
5. Clear the intent only as part of a durable verified terminal result plus audit.
   Unlink succeeded but completion lost means quarantine and evidence-based
   operator reconciliation, not unconditional retry or automatic release.
6. Forbid installation/repository/run cascades or account rename from silently
   losing or changing the in-flight ownership marker. Protect cross-tenant shared
   storage paths. Unsupported storage drivers must remain non-destructive.
7. Hold release remains **not** authorization to requeue a previously blocked
   erasure. Preserve append-only audit, tenant isolation and safe-path checks.

A second ordinary SQL check, process-local mutex, or session lock around unlink
cannot on its own satisfy the disconnect and crash invariants.

## Internal export-copy admission (migration 0110)

An internal, installation-bound export preparation can now create a **durable, path-wide copy reservation before local object I/O**, under the same tenant-then-path PostgreSQL advisory-lock order as physical unlink. Unlink admission checks the active reservation before issuing a deletion fence, defers without spending retry budget, and also protects paths shared across installations. A queued deletion denies new export copying. A worker must release its random-token reservation **only after the read has settled**; a crash or unknown release outcome leaves a visible, unresolved reservation instead of assuming the bytes are safe to unlink. Repository/lease/retention checks still apply and cannot be bypassed by a legal hold.

This is a source-level fencing mechanism for **internal, in-memory export preparation**, not a persisted or delivered customer archive. Reservation-quarantine inspection and a separately authenticated, evidence-based reconciliation path remain required for production operation. No reservation is cleared automatically by time, and old physical-deletion workers must be quiesced for a safe migration cutover.

## Staged engineering and remaining acceptance evidence

The schema, store and worker changes are present in `main` and have source-level
PostgreSQL regression coverage. **Production cutover is not accepted** solely
because the migration and tests exist. The table is the complete safety and
release checklist; source-complete items still require live verification.

| Stage | Required evidence |
| --- | --- |
| Complete writer/owner inventory | Hold insert/reactivation/release, artifact metadata removal, enqueue/claim/reclaim/fail/complete/unlink, installation rename/delete, shared locators, nonlocal drivers, separately deployed workers |
| Data/transaction contract | Additive migration, deterministic identity and lock order, bounded wait, durable intent, fail-closed terminal transition, crash-safe rollback and audit |
| Real PostgreSQL 16/17 | Two independently pooled writers show both orderings: hold wins and no unlink; intent wins and no false hold acknowledgement |
| Fault injection | DB loss before/after reservation, crash after unlink before terminal commit, two workers, lease reclaim, timeout, duplicate path, overlapping tenant, account rename/cascade and partial migration |
| Operations | Quarantine visibility, manual inspection and authenticated reconciliation with irreversible-outcome evidence; no automatic time-based intent removal |
| Deployment | Owner-approved pause of old physical-deletion workers across mixed-version cutover, backup compatibility and non-destructive rollback, explicit capacity/storage monitoring |
| Merge/release gate | Security/data-retention review, required signed exact-head CI and PostgreSQL fault proof, independent postmerge checks, **separate** production/customer authorization |

## Stop conditions and complexity budget

Stop if any hold or unlink writer bypasses the barrier, if account identity or
shared object ownership is ambiguous, if disconnect removes the only in-flight
marker, if old workers can unlink during rollout, if an intent can be reclaimed
before a proven terminal outcome, or if a test fails to establish positive safety.
Do not retrofit an unreviewed lock key or suppress a failing test.

This direction adds durable PostgreSQL state, bounded contention, operator
quarantine and recovery procedures. It does *not* justify Redis, a new service,
extra credentials or a second deletion engine. If those costs are unacceptable,
the conservative interim is an **owner-approved pause of physical deletion**
with storage-capacity monitoring, not a compliance claim.

No production erasure, billing, customer storage relocation, release #938,
publish or GA action is authorized by this contract. #44 remains OPEN.
