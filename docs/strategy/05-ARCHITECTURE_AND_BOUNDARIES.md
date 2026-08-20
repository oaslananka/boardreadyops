# Architecture and Boundaries

This document summarizes strategic architecture constraints. Accepted ADRs remain authoritative for architecture decisions.

## Default hosted topology

```text
Browser
   |
   v
BoardReadyOps Web / API
   |
   +---- PostgreSQL (authoritative structured state)
   |
   +---- Worker (durable jobs, reconciliation, side effects)
   |
   +---- GitHub App / API
                 |
                 v
        Target customer repository
                 |
          GitHub Actions runner
                 |
          exact-SHA checkout
                 |
              KiCad
                 |
          BoardReadyOps CLI/Action
                 |
          normalized result/evidence
                 |
          short-lived GitHub OIDC
                 |
                 v
        BoardReadyOps result API
```

## Control-plane responsibilities

The hosted control plane may:

- authenticate/authorize users and installations;
- accept and durably record webhooks;
- orchestrate target-repository runs;
- persist normalized findings, metrics, release metadata, and audit state;
- validate OIDC/result identity;
- reconcile incomplete work;
- authorize artifact access and issue short-lived direct storage URLs;
- evaluate Cloud-level policy/history/monitoring behavior;
- present dashboards and notifications.

## Control-plane non-responsibilities by default

It should not:

- centrally clone private customer source merely for normal hosted execution;
- operate a shared KiCad worker fleet as the default path;
- proxy large artifact bytes through the web request process;
- exfiltrate full build logs by default;
- request GitHub Contents write only to claim zero-file onboarding.

These match the current delivery principles in issue #191.

## Execution identity

Results must be bound strongly enough to reject substitution/replay across:

- GitHub installation;
- repository;
- workflow identity;
- expected branch/default-branch constraints;
- event type;
- environment where applicable;
- run ID;
- run attempt;
- target commit SHA;
- BoardReadyOps run/attempt identity.

Unknown or mismatched identity fails closed.

## Data model rules

- Every tenant-owned object is scoped by installation/organization boundary.
- Attempt-bound evidence must not be accidentally attached to a different retry.
- Artifact metadata stores digest, kind/role, attempt, retention, and provider-neutral locator.
- Large bytes are stored/accessed out of process with authorized signed URLs.
- Webhook inbox and jobs must support idempotency, retry, dead-letter/reconciliation workflows.

## Process separation

Keep frontend and backend in one deployable codebase while useful, but keep runtime responsibilities separable:

- web/API process handles bounded requests;
- worker performs durable background work;
- database is authoritative state;
- execution is external to the web process.

A repository split is not an architecture requirement. See `06-OSS_CLOUD_BOUNDARY.md`.

## API boundary

Do not force all internal application reads through a public HTTP API. Server-side application code may use typed cloud-core/db interfaces directly. Expose versioned public APIs where external consumers require a stable contract.

## Contracts

Stable contracts are strategically important between:

1. CLI/Action result → Cloud ingestion;
2. evidence bundle → offline verifier;
3. supplier provider → normalized intelligence;
4. EDA adapter → canonical hardware model;
5. customer-hosted agent → control plane.

Contracts should be versioned, schema-validated, backward-compatible where promised, and independently testable.

## Architecture trigger policy

Do not add microservices, Kubernetes, external brokers, workflow engines, cell isolation, or language rewrites until the measurable trigger in `21-NOT_NOW_AND_TRIGGERS.md` is satisfied and an ADR records the decision.
