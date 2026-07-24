# GitHub Check Run Reconciliation Implementation Plan

**Goal:** Repair GitHub Check Run drift after a signed terminal BoardReadyOps result has been accepted.

**Architecture:** Add schema v21 candidate, claim, context, repair, and failure functions; extend the GitHub App client with a status-only Check Run reader; and process release-run reconciliation leases in the existing control-plane worker.

## Tasks

### 1. Specify safe contracts

- Add RED tests for normalized Check Run observation, content-free database context, worker deadline behavior, and atomic publication-state repair.
- Keep the accepted terminal release result authoritative.

### 2. Add schema v21

- Detect terminal unpublished Check Runs after an observation delay.
- Claim only `release_run / reporting_stale` reconciliation work.
- Atomically mark publication repaired or record a stable terminal publication failure.
- Append privacy-safe audit events and prevent repeated candidates after terminal failure.

### 3. Add GitHub observation and repair

- Read exactly one persisted Check Run ID with a short-lived installation token.
- Return only normalized status/conclusion or `not_found`.
- Update drifted Check Runs with bounded generic content and the persisted expected conclusion.

### 4. Wire the worker

- Reuse the reconciliation concurrency, polling, observation, deadline, and next-check settings.
- Add detection, claim, processing, readiness timestamps, and structured content-free events.
- Preserve installation/repository concurrency limits.

### 5. Verify and deliver

- Run focused and full unit tests, cloud coverage, typechecks, production build, worker-boundary verification, security scans, and PostgreSQL integration CI.
- Open a PR marked as part of #190, inspect every bot/agent review surface, and merge only after all required checks pass.
