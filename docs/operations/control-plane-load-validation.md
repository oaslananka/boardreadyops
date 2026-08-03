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

The explicit `worker-fleet-interruption` profile repeats the same real child-process claim path for a bounded fleet. Every child must hold a distinct lifecycle-job lease at the same time before the parent terminates the entire process fleet with `SIGKILL`. After lease expiry, distinct replacement worker identities must reclaim and complete every abandoned job at attempt two. `BOARDREADYOPS_LOAD_WORKER_FLEET_SIZE` accepts 2 through 20 and defaults to 3. This proves bounded full process-fleet loss on one isolated test runner; it does not claim host, container-runtime, availability-zone, or regional failure recovery.

The explicit `github-api-interruption` profile starts a loopback HTTP fault server and calls the real GitHub workflow reconciliation reader. Each round returns HTTP `503`, then HTTP `429` with `Retry-After`, and finally a completed workflow response. PostgreSQL reconciliation must schedule two bounded retries and converge on the third request. No request leaves the runner, no GitHub credential is used, and response bodies are never copied into the report or durable error metadata.

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
# Alternative explicit profiles: soak-recovery, database-interruption, worker-process-interruption,
# worker-fleet-interruption, or github-api-interruption
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

Set `BOARDREADYOPS_LOAD_PROFILE=worker-fleet-interruption` to hold one distinct job lease per child across the configured bounded fleet and then terminate every child. Each round must record `fleet size` starts, forced terminations, attempt-two lease reclaims, and replacement completions. A partial claim, partial termination, duplicate reclaim, missing completion, or convergence above the configured maximum fails with a stable signal. Reports contain only the fleet size and aggregate counters/timing; they exclude process IDs, job IDs, worker IDs, lease material, database URLs, and child output.

Set `BOARDREADYOPS_LOAD_PROFILE=github-api-interruption` to run the real reconciliation HTTP reader against the loopback fault server. Every round must record one `503`, one `429`, two scheduled retries, three observed requests, and one successful convergence. This proves bounded handling of status-level GitHub API interruptions; it does not exercise GitHub production infrastructure, real installation authentication, or organization-level rate-limit sharing.

## Measured scaling envelope

On 2026-08-02, the representative profile was measured at three increasing tiers on GitHub-hosted Ubuntu runners with isolated PostgreSQL 16 services. All runs used commit `f357592ed52c90cfc66d8dc41eeec79a756a830f`, produced zero threshold signals and zero cross-tenant mismatches, and converged to the exact expected delivery, job, release-run, and outbox counts.

- **Baseline:** 200 unique and 50 duplicate deliveries, 4 repositories, 80 release runs, concurrency 20; intake p95 65.631 ms, lifecycle p95 74.119 ms, dashboard p95 42.139 ms; evidence run `30731094803`.
- **Medium:** 500 unique and 100 duplicate deliveries, 8 repositories, 240 release runs, concurrency 40; intake p95 67.630 ms, lifecycle p95 130.246 ms, dashboard p95 44.938 ms; evidence run `30731144759`.
- **High:** 1,000 unique and 200 duplicate deliveries, 12 repositories, 600 release runs, concurrency 80; intake p95 116.451 ms, lifecycle p95 127.909 ms, dashboard p95 109.367 ms; evidence run `30731105219`.

The high tier is the current validated engineering envelope: **1,000 unique deliveries**, 200 duplicate replays, **600 release runs**, 12 tenant repositories, and concurrency 80 through the harness's 50-connection database-pool cap. It is not a production capacity guarantee, sustained requests-per-second claim, or substitute for an hours-long soak on the intended deployment shape. Treat any workload above this tier as unvalidated until the `control-plane-scale-envelope` workflow passes on the target commit and infrastructure.

Capacity decisions remain tied to the authoritative `github-cloud-ga-v1` SLO policy rather than to a new parallel threshold set:

- webhook acceptance p95 above 1,000 ms for five minutes opens capacity triage;
- lifecycle queue age or outbox lag above 60 seconds for five minutes requires incident response and, when PostgreSQL and GitHub are healthy, worker-capacity review;
- reconciliation backlog above 20 immediately or increasing for three snapshots requires reconciliation-capacity review;
- stale attempts above zero for two snapshots or terminal failure rate above 500 basis points with at least 20 terminal runs blocks blind scale-out and requires failure analysis;
- a failed high-tier envelope, any threshold signal, invariant drift, or cross-tenant mismatch blocks raising the validated envelope.

The manual `control-plane-scale-envelope` workflow runs baseline, medium, and high tiers against separate disposable PostgreSQL 16 services and creates one mode `0600`, aggregate-only `control-plane-scale-envelope.json` artifact. The report contains preset counts and aggregate timings only; it excludes database URLs, tenant identifiers, payloads, response bodies, credentials, and raw errors.

## GitHub Actions evidence

Run the `control-plane-load` workflow manually. It provisions an isolated PostgreSQL 16 service, applies every repository migration, executes the selected scenario, and uploads `control-plane-load-report.json` for 30 days. The workflow uses no repository secret and has read-only repository permissions.

Keep the report with the GA-readiness evidence for issue #222. The representative profile covers bounded load and tenant isolation. The `soak-recovery` profile adds bounded repeated worker-lease expiry, transient delivery retry, uncertain-delivery classification, delayed callback convergence, and stale-attempt rejection. The `database-interruption` profile adds real PostgreSQL backend termination, atomic rollback, replacement connection, and post-interruption convergence. The `worker-process-interruption` profile covers one bounded child-process death and lease reclaim. The `worker-fleet-interruption` profile covers bounded full process-fleet loss on one isolated runner and attempt-two convergence. The `github-api-interruption` profile covers status-level HTTP fault injection through the real reconciliation client. This evidence does not by itself satisfy hours-long soak, host or availability-zone loss, whole-service or regional PostgreSQL outage, real GitHub production or shared-rate-limit behavior, or final GA sign-off.
