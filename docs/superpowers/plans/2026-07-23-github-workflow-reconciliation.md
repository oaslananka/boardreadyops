# GitHub Workflow Reconciliation Implementation Plan

**Goal:** Detect stale GitHub Actions attempts and converge missed callbacks through tenant-scoped authoritative workflow state.

**Architecture:** Add schema v20 SQL functions to detect candidates, load lease-bound safe context, reschedule pending work, and atomically apply terminal GitHub state. Add an installation-authenticated workflow reader and a reconciliation worker wired into the control-plane process.

## Tasks

### 1. Specify database contracts

- Extend `ControlPlaneOperationsStore` with candidate detection, context loading, rescheduling, and terminal application.
- Add unit tests for exact SQL calls, safe decoding, deadlines, and identifier validation.

### 2. Add schema v20 reconciliation functions

- Add `0020_github_workflow_reconciliation.sql`.
- Detect only current non-terminal attempts with a workflow run ID.
- Return no payload-bearing columns.
- Require a valid lease owner for context and mutations.
- Atomically update attempt/run/reconciliation/audit state.

### 3. Add the GitHub workflow reader

- Query one workflow run with a short-lived installation token.
- Return only `pending`, `completed`, or `not_found` state plus a bounded conclusion.
- Never include response bodies or credentials in errors.

### 4. Add the convergence worker

- Reschedule pending state, temporary `404`, and completed-success observations before the deadline.
- Terminalize non-success conclusions immediately and fail closed only after the callback deadline for success/missing state.
- Route transient failures through bounded retry, but fail closed with `github_workflow_lookup_failed` after the explicit deadline.

### 5. Wire and verify

- Add candidate detection to maintenance.
- Add a dedicated reconciliation claim loop and health timestamps.
- Run focused tests, cloud coverage, typechecks, production build, security scans, and the full repository gates.
- Open a PR marked as part of #190 and inspect every bot/review surface before merge.
