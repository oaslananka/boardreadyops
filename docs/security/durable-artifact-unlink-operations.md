# Durable local artifact unlink / legal hold incident contract

This document describes the local-storage physical deletion gate introduced
under issue #44. It does not authorize a production deployment, a mixed-version
rollout, external object deletion or a compliance signoff.

## Mandatory ordering

- The worker must commit `boardreadyops_begin_artifact_unlink` before file I/O.
  The PostgreSQL function checks a live lease, all tenant holds and records
  an unresolved UUID fence under the canonical tenant transaction advisory lock.
- Every active `legal_holds` INSERT / reactivation uses that same lock and
  refuses to acknowledge a hold while any unresolved tenant fence exists.
  Hold creation failure must be reported to the operator as failure, never success.
- Existing claim/reclaim logic excludes unresolved fences. An expired lease,
  worker crash, database disconnect or process restart must NOT release them.
- After the filesystem Promise settles and the existing durable job completion
  or failure transition commits, only the owning worker/token may call
  `boardreadyops_settle_artifact_unlink`. A matching audited DB outcome is
  required; no guessed or time-based auto-expiry is permitted.
- A rejected filesystem Promise does not prove that the object survived: unlink
  may already have occurred. Keep the fence unresolved even after a durable
  failure transition unless trusted pre-unlink validation proves no unlink was
  attempted. Uncertain results require evidence-backed operator reconciliation,
  not an automatic retry or fence settlement.
- Renaming or deleting an installation during an unresolved unlink fence is
  rejected to preserve tenant-key identity.
- Direct deletion or ownership/path mutation of a fenced deletion job, including
  repository and release-run cascading deletion or table truncation, is rejected.
  Unresolved fences must retain their backing job and audit context.

## Rollout, rollback and operator recovery

**Never hot-roll** a migration while unfenced workers can still physically
unlink. Quiesce and enumerate every worker/deployment first, including any
out-of-band host. Verify no unlink remains in flight, apply draft migration 0104
and then start ONLY the new worker version. Get explicit owner/release and
security acceptance; the source PR or green CI does not deploy anything.

A rollback to an old unlink worker is unsafe even with the new schema:
stop deletion instead, preserve all unresolved fences and audit evidence,
and reconcile before any downgrade. Do not drop the guard trigger, remove
an unresolved fence, or mark a deletion completed merely to clear a queue.

Unresolved marker monitoring (aggregate only, no sensitive storage paths):

```sql
select tenant_key, count(*)::integer as unsettled_count,
       min(started_at) as oldest_started_at
from artifact_unlink_fences
where settled_at is null
group by tenant_key;
```

### Bounded read-only operator inventory

For an authorized operator with **read access to `started_at` and `settled_at`**
on `public.artifact_unlink_fences`, run:

```sh
node scripts/inspect-artifact-unlink-fences.mjs
```

Supply `DATABASE_URL` through the operator's existing secret-handling mechanism
(not as an argument, printed command, support ticket or committed environment
file). The script opens `BEGIN READ ONLY`, uses bounded statement/lock
timeouts, checks that the table is not RLS-filtered, and returns only the
unresolved fence count and oldest timestamp. On missing credentials, absent
grant/schema, row-level security or a query error, it returns
`{"status":"unknown","reason":"..."}` with nonzero exit status. **Unknown is not
zero**. No tenant identifiers, file paths, worker IDs or raw database errors
are returned.

The production `boardreadyops_evidence_reader` role has been observed to lack
the necessary access. This documentation does **not** authorize changing its
privileges or creating a privileged `SECURITY DEFINER` endpoint. A separate
approved DBA/security change must provision the least-privilege observation
grant, or an already-authorized read-only operator account must be used. Do
not use this command with a production write-capable service identity merely
to bypass the evidence-reader restriction. In any case this is point-in-time
evidence only, not a hold-release or deletion authorization.

An unresolved fence is **quarantined**, not an automatically retryable job.
Before authenticated manual reconciliation, prove all old workers were stopped
and cannot resume, verify local-file outcome using bounded path/symlink guards,
inspect the job and append-only audit, and retain evidence of the operator,
scope and incident. The settlement function requires the matching token,
worker, and committed terminal job outcome. When there is uncertainty,
leave the fence and escalate. A rejected hold is NOT an active hold; retry
creation and verify its acknowledged status only after safe reconciliation.
Releasing a hold must never silently requeue previously blocked erasures.

## Known boundaries

This protects BoardReadyOps's controlled `local` artifact unlink worker,
not untracked filesystem administrators, backups, unsupported non-local
storage drivers, or legacy pre-upgrade workers. Physical storage locator
sharing across installations/tenants, true process-crash recovery, operational
capacity/on-call monitoring, production topology and legal/customer review
remain separate acceptance gates. Issue #44 stays open until those are proven.
