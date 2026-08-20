# Product Roadmap

This roadmap translates product strategy into gated phases. It does not replace GitHub issue #191; #191 remains authoritative for current issue dependency order and GA sequencing.

## Roadmap rules

- Phases are outcome-gated, not date-gated.
- Work may run in parallel only when it does not violate a trust/dependency gate.
- Every phase has explicit exit evidence.
- Historical capability work in `docs/ROADMAP.md` remains historical/completed context.
- New infrastructure is trigger-based unless an accepted ADR says otherwise.

## Phase 0 — Strategy and Operating System

**Objective:** make priorities, boundaries, decisions, metrics, and risks explicit.

**Deliverables:**

- Master Plan and focused strategy docs;
- source-of-truth hierarchy;
- decision log;
- risk register;
- metrics definitions;
- launch checklist;
- weekly/monthly review cadence.

**Exit:** project work can be explained from vision → phase → issue → acceptance evidence without contradictory roadmaps.

## Phase 1 — Repository and Release Health

**Objective:** keep the OSS/release foundation trustworthy before product promotion.

Current #191 scope includes:

- #329 dependency vulnerability gates/stale overrides — P0;
- #321 supported Node.js LTS patch refresh — P1;
- #330 temporary Git repository isolation — P1;
- #331 public release reference freshness — P1;
- #332 toolchain bootstrap/Python diagnostics — P1;
- #333 public contribution vs internal tracking — P2;
- #334 npm Trusted Publishing migration — P2.

**Exit:** required security checks are green, release references are accurate, contributor verification is deterministic, and long-lived npm publishing authentication is removed after verified cutover.

## Phase 2 — Cloud Control Plane Reliability

**Objective:** accepted work survives normal process/dependency failure and can be recovered predictably.

Primary issues:

- #190 reconciliation, dead-letter operations, SLOs, canaries, runbooks;
- #222 backup, restore, load, soak, and failure-recovery validation.

**Required evidence:**

- durable webhook intake;
- durable jobs/outbox;
- idempotent transitions and side effects;
- crash/retry/reconciliation behavior;
- restore drill with RPO/RTO evidence;
- sustained load/soak evidence;
- failure injection without cross-tenant/duplicate/ambiguous state;
- runbooks matching deployed configuration.

**Exit:** reliability evidence is reproducible against the configuration intended for GA.

## Phase 3 — GitHub Cloud GA Trust Closure

**Objective:** prove the default hosted execution path is safe enough for real customer repositories.

Primary issues:

- #149 operationalize target-repository GitHub Actions;
- #42 private-repository and fork safe-execution policy;
- #154 two-installation isolation validation;
- #88 least-privilege production GitHub App permissions.

**Required evidence:**

- final production App manifest;
- target workflow identity and exact-SHA execution;
- short-lived OIDC result authentication;
- private/fork safe mode behavior;
- replay/cross-tenant/wrong-repo/wrong-workflow/wrong-attempt rejection;
- two distinct installations completing end-to-end without boundary leakage;
- product/Marketplace copy matching actual permissions and data flow.

**Exit:** both Phase 2 and Phase 3 gates are complete. Only then may public Cloud GA be declared.

## Phase 4 — Website, Brand, and Trust Surface

**Objective:** make the product understandable and credible before broad promotion.

**MVP surface:**

- homepage;
- product/workflow;
- developer entry points;
- security/trust explanation;
- pricing/early access as appropriate;
- links to docs/GitHub/status/support.

**Exit:** a target user can understand “what it does, where it runs, what data leaves GitHub, and how to try it” in a few minutes.

This phase can run in parallel with technical GA work but marketing claims cannot outrun evidence.

## Phase 5 — Onboarding and Time to First Value

**Objective:** turn GitHub installation into a useful result without maintainer handholding.

**Golden flow:**

`Sign in → Install App → Select repo → Enable reviewed workflow → First run → First useful finding`

**Metrics:**

- install-to-enabled-repo conversion;
- time to first successful run;
- time to first useful finding;
- onboarding abandonment step;
- maintainer intervention rate.

**Exit:** design partners can activate representative repositories independently with documented recovery paths for common failures.

## Phase 6 — Dashboard, Evidence, and Artifact UX

**Objective:** make run state and trust evidence investigable.

Primary #191 issues:

- #25 hosted run dashboard and reconnectable status timeline;
- #26 evidence viewer and direct signed artifact access;
- #44 metadata/artifact retention, deletion, privacy, lifecycle controls.

**Exit:** users can investigate a run, access authorized evidence directly, and understand retention/deletion without large artifact bytes passing through the web process.

## Phase 7 — PR Hardware Change Impact

**Objective:** create the primary engineer-facing “wow” moment inside the existing workflow.

Candidate output:

- schematic/PCB/BOM/placement change summary;
- manufacturing-readiness delta;
- supply-chain/policy delta when available;
- blockers/warnings introduced or resolved;
- evidence and verification commands;
- safe-auto-fix metadata only where deterministic and bounded.

**Exit:** design partners repeatedly use PR findings to make merge/release decisions, not merely view a dashboard after the fact.

## Phase 8 — Hardware Release Passport

**Objective:** give each production release a durable, portable trust identity.

Candidate identity includes:

- BoardReadyOps release ID;
- repository/source revision;
- schematic/PCB/BOM/firmware/manufacturing artifact digests where applicable;
- policy/tool/EDA versions;
- findings/waivers/approvals;
- signatures/attestations;
- timestamps;
- standard exports and offline verification.

**Exit:** a release can be independently verified later without relying on the current web UI.

## Phase 9 — Continuous BOM and Supply-Chain Intelligence

**Objective:** create recurring value when source code has not changed.

**Capabilities:**

- scheduled/provider-driven observations;
- lifecycle/availability/lead-time/supplier-count/compliance changes;
- trust/freshness metadata;
- mapping to affected products/releases;
- policy impact;
- actionable notifications;
- historical observation trail.

**Exit:** real design partners receive at least one useful external-change alert connected to a real product/release decision.

## Phase 10 — Organization Policy and Portfolio

**Objective:** turn repository-level gates into scalable engineering governance.

**Capabilities:**

- organization defaults;
- inheritance;
- repository/variant overrides;
- policy version history;
- waivers/approvals;
- portfolio risk/readiness views;
- audit trail.

**Exit:** a multi-repository design partner manages policy centrally without copying config and can explain each effective policy decision.

## Phase 11 — Enterprise Trust and Customer-Hosted Execution

Primary #191 issues:

- #41 outbound customer-hosted execution agent;
- #45 organization policy inheritance and repository overrides.

Additional enterprise capabilities are demand-triggered: SSO, SCIM, data residency, dedicated keys/deployment, retention, SLA/support.

**Exit:** at least one real enterprise design/contract requirement is satisfied end-to-end with bounded identity/network/update/audit behavior.

## Phase 12 — Manufacturing Feedback Pilot

**Objective:** connect release evidence to physical outcomes without becoming an MES.

Start with CSV/API ingestion for a few design partners:

- batch/lot and release ID;
- quantity;
- FPY;
- rework;
- AOI/SPI defect categories;
- functional test;
- NCR/RMA/corrective action.

**Exit:** at least one design/release change can be meaningfully correlated with a production outcome and used in an engineering review.

## Phase 13 — Evidence Graph / Hardware Memory

**Objective:** make longitudinal relationships queryable across product, revision, release, components, policies, suppliers, and outcomes.

Do not assume a graph database. Start from a stable domain model and queries users need.

**Exit:** the system can answer cross-time questions that cannot be answered from a single release bundle.

## Phase 14 — Assisted Review / AI

Issue #52 remains downstream of trust/GA work.

**Objective:** reduce interpretation time while preserving deterministic authority.

**Exit:** AI explanations are grounded in exact evidence, cite the relevant finding/policy/history, expose uncertainty, and cannot modify final release state without explicit deterministic workflow.

## Phase 15 — Marketplace / Ecosystem

**Objective:** expand rule/adaptor/provider ecosystem safely.

**Gate:** hosted arbitrary-code marketplace remains blocked until plugin runtime trust is adequate.

Safer earlier ecosystem surfaces:

- config-only rule packs;
- signed provider adapters running customer-side;
- schemas/contracts/examples;
- reviewed first-party integrations.

## Phase 16 — EDA Expansion

**Objective:** prove BoardReadyOps is architecturally EDA-neutral only after the first wedge works.

**Gate:** next EDA is selected from explicit customer demand and economic value, not market-size assumptions alone.

**Exit:** second adapter maps into the canonical model without duplicating release/policy logic.

## Roadmap stop conditions

Stop or defer a phase when:

- the underlying user problem is not repeated in discovery;
- activation/retention does not support the assumed wedge;
- a lower-cost integration solves the need;
- the phase introduces trust risk disproportionate to user value;
- a prerequisite is incomplete;
- work exists mainly because it is technically interesting.
