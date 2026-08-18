# Control-plane Restore Drill

BoardReadyOps provides a manual restore-readiness drill for issue #222. The drill is intentionally destructive only inside disposable PostgreSQL databases created by the workflow. It must never be pointed at production, retained staging data, or a shared developer database.

The initial GitHub Cloud GA engineering objectives remain a **15-minute RPO** for PostgreSQL state and a **60-minute RTO** from incident declaration to an isolated, database-backed ready service. These are engineering targets, not contractual availability guarantees.

## What the drill proves

The `control-plane-restore-drill` workflow uses PostgreSQL 17, matching the repository's self-hosted deployment baseline. It applies every current migration to an empty disposable source database, inserts one synthetic installation/repository/run/attempt fixture, and runs the existing native `pg_dump`/`pg_restore` verifier into a different empty database. The verifier checks migration versions, public tables, representative row counts, backup file safety, and representative run state after restore.

After the database verification succeeds, the workflow builds the **production runtime image** from `apps/web/Dockerfile`. It starts the real web server and control-plane worker against the restored database, with outbound execution disabled and no production GitHub credentials, then requires both `/api/health/ready` and `/health/ready` to become ready.

The uploaded evidence is aggregate-only. It contains the source commit SHA, backup byte count, migration/table/representative-row counts, a restored-run-state boolean, the runtime image contract, and web/worker readiness booleans. It does not contain installation IDs, repository names, run IDs, database URLs, payloads, findings, tokens, webhook values, or private source data.

## Running the database portion locally

Use two disposable PostgreSQL databases on PostgreSQL 17. The source must contain only the current schema before the drill seeds its synthetic representative run, and the restore target must be empty.

```bash
export BOARDREADYOPS_RESTORE_DRILL_SOURCE_DATABASE_URL='postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_restore_source'
export BOARDREADYOPS_RESTORE_DRILL_TARGET_DATABASE_URL='postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_restore_target'
export BOARDREADYOPS_RESTORE_DRILL_BACKUP_PATH='/tmp/boardreadyops-restore-drill.dump'
export BOARDREADYOPS_RESTORE_DRILL_CONFIRMATION=isolated-disposable-database
pnpm run cloud:restore:verify
```

The command refuses a non-absolute backup path, identical source/restore database identities, a pre-existing backup file, a non-empty restore database, or a source database containing existing control-plane tenant/run work. The temporary dump is removed after the drill; the restored database is deliberately left intact so service-readiness checks can run against it before the disposable environment is destroyed.

## Boundaries and remaining GA evidence

This drill closes the repeatable isolated backup/restore plus real web/worker readiness gap. It **does not prove** provider backup scheduling meets the 15-minute RPO, that a regional database or availability-zone outage meets the 60-minute RTO, or that the separately defined local managed-artifact byte recovery objective is met; that still requires an encrypted artifact-volume backup/restore drill. Non-local object-storage drivers have no GA recovery claim in the current deployment profile. An hours-long production-shape soak and real GitHub shared-rate-limit behavior also remain separate GA evidence items in issue #222.

The workflow uses no repository secrets and never contacts GitHub as a product integration. Its `BOARDREADYOPS_RUNNER_MODE=disabled` setting is deliberate: restore readiness verifies the persisted control-plane state and production runtime image without granting a disposable drill authority to dispatch customer workflows or publish Check Runs.
