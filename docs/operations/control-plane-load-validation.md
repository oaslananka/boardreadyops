# Control-plane Load Validation

BoardReadyOps includes a bounded PostgreSQL load-validation scenario for the GitHub Cloud control plane. It is intended for an isolated, disposable database only. Never point it at production, staging with retained tenant data, or a shared developer database.

## What the scenario exercises

The validation creates synthetic installation and repository scopes, then measures:

- unique and duplicate webhook acceptance through the durable inbox and lifecycle-job store;
- bounded concurrent job claiming and completion;
- transactional release-run and Check Run outbox creation;
- bounded outbox claiming and completion without contacting GitHub;
- tenant-scoped dashboard reads, including deliberate cross-tenant lookups that must return `not-found`; and
- database invariants proving exact delivery, job, run, and outbox counts with zero cross-tenant mismatches.

The scenario persists only generated identifiers and synthetic metadata. It does not read workflow logs, source, findings, artifacts, tenant payloads, or credentials. External GitHub effects are not emitted; Check Run creation effects are completed locally with synthetic identifiers.

The optional `soak-recovery` profile repeats a bounded recovery round against the same disposable database. Each round proves an abandoned lifecycle-job lease can be reclaimed while the old worker is rejected, a transient outbox failure can retry, an uncertain delivery is quarantined as `reconciliation_required`, a delayed callback converges through workflow reconciliation, and a stale attempt terminal result is rejected after the current-attempt pointer changes. No GitHub API call is made; the workflow observation is deterministic synthetic input to the real reconciliation worker and PostgreSQL store.

The explicit `database-interruption` profile additionally opens a real PostgreSQL transaction, changes a synthetic repository row, and terminates that backend with `pg_terminate_backend`. It requires the interrupted transaction to reject further work, verifies transaction rollback from an independent executor, establishes a replacement connection, and then runs the normal bounded recovery proofs. This profile must run only with a disposable PostgreSQL role allowed to terminate its own test backends.

The explicit `worker-process-interruption` profile starts a separate Node child process that uses the real PostgreSQL job store to claim a one-second lifecycle lease. The parent waits for the claim, terminates that child process with `SIGKILL`, and proves lease reclaim plus completion by a replacement worker before running the normal bounded recovery proofs. The report records only aggregate process, reclaim, completion, and convergence counters; it never includes process IDs, job IDs, worker IDs, lease material, database URLs, or child output.

## Default engineering baseline

The default manual workflow runs this scenario:

| Signal | Default |
| --- | ---: |
| Unique webhook deliveries | 200 |
| Duplicate deliveries | 50 |
| Repositories | 4 |
| Runs per repository | 20 |
| Concurrent operations | 20 |
| Intake p95 limit | 1,000 ms |
| Lifecycle p95 limit | 1,500 ms |
| Dashboard p95 limit | 1,000 ms |
| Minimum throughput per phase | 10 operations/second |
| Recovery rounds | 3 |
| Maximum recovery-round convergence | 5,000 ms |

Crossing a latency or throughput limit fails the run with a stable signal name. Treat a failure as a capacity or architecture-review trigger until repeated measurements show that the regression is environmental rather than systemic.

## Run locally

Use PostgreSQL 16 with an empty database that contains only the current BoardReadyOps schema. Apply migrations first:

```bash
export DATABASE_URL='postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_load'
pnpm --filter @boardreadyops/db db:migrate
```

Confirm the destructive test boundary and run the baseline:

```bash
export BOARDREADYOPS_LOAD_CONFIRMATION=isolated-disposable-database
export BOARDREADYOPS_LOAD_REPORT_PATH=control-plane-load-report.json
export BOARDREADYOPS_LOAD_PROFILE=representative
# Alternative explicit profiles: soak-recovery, database-interruption, or worker-process-interruption
pnpm run cloud:load:verify
```

The command refuses to start without the exact confirmation value. It also refuses a database containing control-plane rows. Scenario rows are removed after success or failure, but the database must still be disposable because termination during cleanup can leave synthetic rows behind.

Optional bounded overrides are:

```dotenv
BOARDREADYOPS_LOAD_PROFILE=representative
BOARDREADYOPS_LOAD_RECOVERY_ROUNDS=3
BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES=200
BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES=50
BOARDREADYOPS_LOAD_REPOSITORIES=4
BOARDREADYOPS_LOAD_RUNS_PER_REPOSITORY=20
BOARDREADYOPS_LOAD_CONCURRENCY=20
BOARDREADYOPS_LOAD_INTAKE_P95_MS=1000
BOARDREADYOPS_LOAD_LIFECYCLE_P95_MS=1500
BOARDREADYOPS_LOAD_DASHBOARD_P95_MS=1000
BOARDREADYOPS_LOAD_MINIMUM_THROUGHPUT_PER_SECOND=10
BOARDREADYOPS_LOAD_RECOVERY_MAX_CONVERGENCE_MS=5000
```

The generated report is mode `0600` and contains aggregate timing, throughput, stable threshold signals, scenario counts, and invariant results only. A `soak-recovery` report adds only aggregate recovery counters, maximum convergence time, dead-letter count, and ambiguous non-terminal-state count. It never includes tenant identifiers, payloads, lease tokens, request nonces, or simulated failure text. It is written before threshold assertions so a failed capacity gate still leaves reviewable evidence.

To run the bounded recovery profile locally, set `BOARDREADYOPS_LOAD_PROFILE=soak-recovery`. `BOARDREADYOPS_LOAD_RECOVERY_ROUNDS` accepts 1 through 20; the default is 3. Every round must produce one lease recovery, stale job-completion rejection, outbox retry, uncertain delivery quarantine, delayed-callback repair, and stale attempt result rejection. A missing proof, a dead letter, ambiguous non-terminal state, or convergence above the configured maximum fails with a stable signal.

Set `BOARDREADYOPS_LOAD_PROFILE=database-interruption` to run the same recovery proofs after real backend interruption. Each round must record one backend termination, interrupted-transaction rejection, transaction rollback proof, and replacement connection. The aggregate report contains only those counters and maximum convergence time; it never includes backend process identifiers, connection strings, SQL error text, or synthetic repository identifiers. This proves session interruption and reconnect behavior, not a complete managed-cluster or regional outage.

Set `BOARDREADYOPS_LOAD_PROFILE=worker-process-interruption` to run a real child process claim and `SIGKILL` cycle. Each round must record one child process start, forced termination, abandoned lease reclaim, and replacement completion. This proves bounded process-death recovery for a lifecycle job. It does not prove host, container runtime, availability-zone, or full worker-fleet failure.

## GitHub Actions evidence

Run the `control-plane-load` workflow manually. It provisions an isolated PostgreSQL 16 service, applies every repository migration, executes the selected scenario, and uploads `control-plane-load-report.json` for 30 days. The workflow uses no repository secret and has read-only repository permissions.

Keep the report with the GA-readiness evidence for issue #222. The representative profile covers bounded load and tenant isolation. The `soak-recovery` profile adds bounded repeated worker-lease expiry, transient delivery retry, uncertain-delivery classification, delayed callback convergence, and stale-attempt rejection. The `database-interruption` profile adds real PostgreSQL backend termination, atomic rollback, replacement connection, and post-interruption convergence. The `worker-process-interruption` profile covers bounded child-process death and lease reclaim. This evidence does not by itself satisfy hours-long soak, host or full worker-fleet termination, whole-service or regional PostgreSQL outage, external GitHub API fault injection, or final GA sign-off.
