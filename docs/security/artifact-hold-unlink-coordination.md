# Legal-hold admission versus irreversible artifact unlink: safety contract

Status: **design contract / implementation pending**. This document defines acceptance
criteria for #44, not an implemented guarantee, migration instruction or permission
to perform production deletion. The current pre-unlink hold check remains best-effort.

## Hazard and required ordering

The worker authorizes a leased deletion with one PostgreSQL statement, returns the
DB client to the pool, then unlinks a local file. A separate transaction can
acknowledge a new tenant legal hold in between. A disposable two-client PostgreSQL
test reproduces the loss; its passing status characterizes the defect, not safety.

**Required invariant:** A successfully acknowledged applicable legal hold cannot
coexist with an in-flight, unaccounted irreversible unlink of the protected object.
An unlink already in progress must finish before hold acknowledgement *or* force
a truthful, actionable hold-admission rejection. Connection failure or retry must
never implicitly clear a destructive reservation.

## Selected design direction: persisted, fail-closed deletion intent

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

## Staged engineering and proof requirements

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
