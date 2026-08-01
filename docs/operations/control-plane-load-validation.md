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
pnpm run cloud:load:verify
```

The command refuses to start without the exact confirmation value. It also refuses a database containing control-plane rows. Scenario rows are removed after success or failure, but the database must still be disposable because termination during cleanup can leave synthetic rows behind.

Optional bounded overrides are:

```dotenv
BOARDREADYOPS_LOAD_UNIQUE_DELIVERIES=200
BOARDREADYOPS_LOAD_DUPLICATE_DELIVERIES=50
BOARDREADYOPS_LOAD_REPOSITORIES=4
BOARDREADYOPS_LOAD_RUNS_PER_REPOSITORY=20
BOARDREADYOPS_LOAD_CONCURRENCY=20
BOARDREADYOPS_LOAD_INTAKE_P95_MS=1000
BOARDREADYOPS_LOAD_LIFECYCLE_P95_MS=1500
BOARDREADYOPS_LOAD_DASHBOARD_P95_MS=1000
BOARDREADYOPS_LOAD_MINIMUM_THROUGHPUT_PER_SECOND=10
```

The generated report is mode `0600` and contains aggregate timing, throughput, stable threshold signals, scenario counts, and invariant results only. It is written before threshold assertions so a failed capacity gate still leaves reviewable evidence.

## GitHub Actions evidence

Run the `control-plane-load` workflow manually. It provisions an isolated PostgreSQL 16 service, applies every repository migration, executes the selected scenario, and uploads `control-plane-load-report.json` for 30 days. The workflow uses no repository secret and has read-only repository permissions.

Keep the report with the GA-readiness evidence for issue #222. This validation covers representative load and tenant isolation; it does not by itself satisfy sustained soak, worker termination, database interruption, delayed callback, transient GitHub API failure, or full reconciliation-recovery acceptance criteria.
