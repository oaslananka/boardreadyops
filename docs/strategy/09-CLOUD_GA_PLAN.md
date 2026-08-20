# Cloud GA Plan

## Goal

Declare BoardReadyOps Cloud generally available only when the deployed system has reproducible evidence that it preserves tenant boundaries, authenticates execution results correctly, recovers accepted work, and accurately communicates its permissions/data model.

## Authoritative dependency

GitHub issue #191 states that Cloud GA is blocked until both:

1. Cloud Control Plane Reliability is complete; and
2. the GitHub Cloud GA milestone is complete.

This document organizes evidence; it does not weaken that gate.

## GA gate A — Repository/release health

Required:

- security/release-health P0 blockers closed;
- dependency vulnerability gates green;
- release references/current docs accurate;
- supported runtime/toolchain checks deterministic;
- package publishing trust state documented and verified.

## GA gate B — Control-plane reliability

### Durable acceptance

- webhook is authenticated before durable acceptance;
- accepted event can survive process restart;
- duplicate delivery is idempotent;
- job ownership/lease/retry semantics are bounded;
- side effects do not duplicate silently.

### Reconciliation

- stale/incomplete state is detectable;
- reconciliation is safe to rerun;
- dead-letter/manual recovery is documented;
- operator can distinguish transient from terminal failure.

### Backup/restore

Evidence includes:

- backup configuration;
- restoration to a clean target;
- migration/readiness validation after restore;
- measured RPO/RTO against stated objectives;
- restoration runbook.

### Load/soak

Evidence includes:

- expected GA workload model;
- sustained run within resource/SLO thresholds;
- queue age/latency/error behavior;
- no tenant-isolation degradation under pressure.

### Failure injection

Inject representative failure in:

- web process;
- worker process;
- database/network dependency where safe;
- GitHub API/dispatch/result callback path;
- retry/reconciliation path.

Verify no cross-tenant state, duplicate irreversible side effect, or ambiguous terminal state.

## GA gate C — GitHub execution trust

### Final GitHub App manifest

- permissions minimized to actual product needs;
- subscribed events justified;
- production registration validated;
- public documentation/Marketplace copy matches manifest.

### Target-repository workflow

- workflow is explicit in customer repository;
- exact target SHA is validated;
- checkout credentials are not persisted unnecessarily;
- supported KiCad/BoardReadyOps versions are explicit;
- private/fork safe-mode behavior is deterministic;
- result callback origin/path is validated.

### OIDC result validation

Validate expected claims/bindings for:

- installation/repository;
- workflow identity;
- ref/default branch policy;
- event;
- environment if used;
- run ID;
- current attempt;
- BoardReadyOps run/attempt identity;
- target SHA.

Reject:

- replay from previous attempt;
- result from another repository/installation;
- wrong workflow;
- wrong event/ref/environment;
- malformed/expired token;
- result for unknown/terminal run.

### Two-installation isolation

Use two real GitHub App installations with representative repositories.

Prove:

- each can dispatch and complete independently;
- no cross-installation result acceptance;
- no unauthorized artifact/evidence visibility;
- source/log/Actions artifacts remain within intended boundaries;
- database queries/API authorization remain installation-scoped;
- evidence is suitable for security review without secrets/customer data leakage.

## GA gate D — Artifact and evidence behavior

- artifact metadata is attempt-bound;
- digests are stored/verified as appropriate;
- access authorization is tenant scoped;
- large artifact bytes do not pass through dashboard process;
- signed URL lifetime is bounded;
- retention/deletion behavior is documented/tested;
- deleted/expired content produces understandable UI/API state;
- privacy/data lifecycle docs match implementation.

## GA gate E — Product readiness

- onboarding works for a fresh installation;
- user can see current run state and reconnect after refresh;
- errors explain next action;
- first useful finding is reachable without maintainer intervention for representative repo;
- evidence/findings are understandable;
- no dead-end setup state;
- support contact/process exists.

## GA gate F — Security, privacy, and legal operations

Before commercial/public GA, confirm as applicable:

- privacy policy;
- terms of service;
- data/subprocessor disclosures;
- vulnerability disclosure/security contact;
- incident response ownership;
- data retention/deletion behavior;
- trademark/domain/legal review status;
- billing/tax terms if charging.

This checklist is operational, not legal advice; obtain appropriate professional review for legal obligations.

## GA gate G — Observability and operations

At minimum monitor:

- webhook acceptance failures;
- job queue age/throughput/failures;
- reconciliation/dead-letter count;
- dispatch success/failure;
- OIDC/result rejection reasons;
- run terminal latency;
- database capacity/errors;
- worker liveness;
- artifact authorization/storage failures;
- customer-visible error rate.

Every alert should have an owner/runbook or be removed.

## Promotion levels

### Internal

Maintainer-controlled installations/repositories only.

### Design partner / private beta

Real external repositories with explicit expectations and direct feedback. P0 trust gates still apply; some non-critical UX/commercial work may remain incomplete.

### Public beta

Self-serve onboarding may be allowed only when isolation, authentication, and recovery evidence is already strong. “Beta” is not permission to weaken tenant/security boundaries.

### GA

All mandatory gates above plus issue #191 exit conditions complete and evidence linked in launch checklist.

## No-Go conditions

Do not promote when any of the following is unresolved:

- credible cross-tenant data path;
- forged/misattributed result acceptance;
- unexplained GitHub App privilege;
- accepted work can disappear without recovery path;
- restore objectives are unproven;
- deployed behavior differs materially from trust/security copy;
- P0 repository/release-health regression;
- required evidence exists only as an unrepeatable manual claim.

## Evidence index

For each GA gate, link evidence from `20-LAUNCH_CHECKLIST.md` to the owning issue, workflow run, test artifact, runbook, or security document. Do not copy secrets or private tenant data into public issues.
