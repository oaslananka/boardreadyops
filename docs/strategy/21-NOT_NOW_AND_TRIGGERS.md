# Not Now and Architecture Triggers

A disciplined “not now” list protects BoardReadyOps from solving scale/enterprise/ecosystem problems before they exist.

`NOT NOW` does not mean `NEVER`. It means a measurable trigger is required.

## Shared BoardReadyOps-managed KiCad execution pool

**State:** TRIGGER-BASED / deferred.

Do not make this the default hosted path.

Reconsider only when:

- repeated customers cannot use GitHub Actions/customer-hosted execution;
- economic analysis supports operating the fleet;
- source/data boundary requirements are understood;
- isolation/sandbox/capacity model is designed;
- a go/no-go ADR is accepted.

## Kubernetes

**State:** NOT NOW.

Trigger examples:

- existing deployment cannot meet measured availability/scaling/operational isolation requirements;
- multiple independently scaled services genuinely require orchestration features that current platform does not supply;
- operating cost/complexity model favors it.

“No longer fits on one service” must be measured, not assumed.

## Microservices

**State:** NOT NOW.

Trigger:

- a service boundary has independent scaling/reliability/security/team ownership needs that materially exceed monolith/module cost;
- network/API operational cost is justified.

Prefer modular process/package boundaries first.

## External queue/broker

**State:** TRIGGER-BASED.

Current PostgreSQL jobs/outbox remains default.

Trigger:

- measured queue throughput/latency/retention/fan-out requirement exceeds documented PostgreSQL thresholds;
- failure semantics clearly improve with a broker;
- migration/operations cost is justified.

## Workflow engine

**State:** TRIGGER-BASED.

Trigger:

- long-running, multi-step, human-approval workflows exceed maintainability/correctness of current state machine;
- retries/compensation/visibility needs are demonstrably painful.

## Go/Rust rewrite

**State:** NOT NOW.

Trigger:

- profiling identifies a specific service boundary where current runtime cannot meet required performance/resource/security properties;
- rewrite has a bounded interface and measurable expected gain.

No full-system rewrite for aesthetics.

## Cell-based tenant isolation / multi-region architecture

**State:** TRIGGER-BASED.

Trigger examples:

- contractual data residency;
- dedicated-key/dedicated-infrastructure commitments;
- material noisy-neighbor risk;
- regional availability requirement;
- scale data showing a single control-plane boundary is unsuitable.

## Binary delta uploads

**State:** TRIGGER-BASED.

First evaluate content-addressed deduplication, retention policy, compression, and direct storage economics.

Trigger: measured artifact transfer/storage pressure materially affects UX or gross margin.

## Graph database

**State:** NOT NOW.

The Evidence Graph is a domain model, not a database mandate.

Trigger:

- required relationship queries are measurably inefficient/complex in current storage;
- graph-specific traversal/query capability creates user value that justifies another datastore.

## Public arbitrary-code plugin marketplace

**State:** NOT NOW.

Trigger requires a hosted trust model covering:

- sandbox/isolation;
- permissions;
- network egress;
- resource limits;
- signing/provenance;
- review/revocation;
- version compatibility;
- incident response.

Before then prefer config-only rule packs or trusted/customer-side plugins.

## Broad multi-EDA support

**State:** NOT NOW.

Trigger:

- KiCad wedge shows activation/retention;
- repeated prospects/customers request one specific EDA;
- adapter feasibility/licensing/test automation are acceptable;
- canonical model avoids duplicating core logic.

## Full PLM/ERP/MES/QMS features

**State:** NOT NOW / product non-goal.

Trigger for any adjacent feature must show that BoardReadyOps uniquely needs it to own release trust. Otherwise integrate with the system of record.

## Mobile application

**State:** NOT NOW.

Trigger: repeated high-value workflow cannot be served by responsive web/notifications and requires mobile-native behavior.

## AI autonomous release approval

**State:** NOT NOW / default non-goal.

A future change would require a new product/trust decision with extensive evidence. Current strategy keeps final release policy deterministic.

## Real-time collaborative EDA editing

**State:** NOT NOW / non-goal.

Integrate with EDA collaboration systems rather than compete with them.

## Decision rule for removing an item from Not Now

Before starting, document:

1. exact measured trigger that fired;
2. customer/user problem;
3. alternatives considered;
4. expected metric/outcome;
5. security/privacy/operational cost;
6. rollback path;
7. ADR requirement if architecture changes.

If the trigger is “competitor has it” or “this architecture is modern,” it is not sufficient.
