# BoardReadyOps Master Execution Plan

**Snapshot:** 2026-08-21  
**Plan version:** 1.0  
**Current public package:** `boardreadyops@1.31.6`  
**Authoritative delivery sequencing:** GitHub issue #191  
**Historical capability roadmap:** `docs/ROADMAP.md`

> This document answers: Where are we, what are we building, why now, what must happen next, what proves completion, and what decisions are still open?

## 1. Executive state

### Product state

BoardReadyOps is a local-first CLI and GitHub Action that generates, validates, decides, packages, attests, reviews, and hands off hardware releases. The repository also contains the foundations of a hosted control plane and web application.

### Current strategic phase

**ACTIVE — Cloud trust and GA foundation.**

The current execution order is intentionally conservative:

1. Repository/release health.
2. Cloud control-plane reliability.
3. GitHub Cloud GA trust closure.
4. Release dashboard, evidence, and artifact UX.
5. Enterprise trust and customer-hosted execution.
6. Marketplace/ecosystem/assisted review only after the trust foundation.

Issue #191 remains the authoritative source for detailed dependency order and issue ownership.

### Current product thesis

BoardReadyOps should become the **independent trust layer between a hardware change and physical production**.

Internal architectural framing: **hardware engineering control plane**.  
External product framing should emphasize release trust, manufacturing readiness, and verifiable evidence rather than generic infrastructure language.

### Primary near-term objective

Prove that a real hardware team can connect a repository, receive a trustworthy readiness decision in its existing GitHub workflow, investigate the evidence, and release without moving sensitive source into a BoardReadyOps-operated build fleet.

## 2. North Star

**Protected Hardware Changes / Month**

A protected hardware change is a meaningful hardware revision that BoardReadyOps evaluates with a deterministic decision and evidence before it reaches a release/production boundary.

Supporting outcomes:

- Issues caught before procurement or manufacturing.
- Repositories protected for eight or more consecutive weeks.
- Verified releases created and independently verifiable.
- Time to first useful finding.
- Supply-chain changes linked to affected products/releases.

See `17-METRICS.md`.

## 3. Product promise

A customer should be able to ask five questions and get evidence-backed answers:

1. **What changed?**
2. **Is it safe to manufacture?**
3. **Why did BoardReadyOps decide PASS/WARN/BLOCK?**
4. **Exactly what design/BOM/firmware/artifacts were released?**
5. **What changed after release that now puts this product at risk?**

The first four are the near-term wedge. The fifth creates recurring cloud value.

## 4. Product boundaries

BoardReadyOps is not intended to become:

- an EDA editor;
- a Git replacement;
- a PLM or ERP replacement;
- a PCB manufacturer;
- a component marketplace;
- a supplier-data vendor of record;
- a generic CI platform;
- an AI PCB generator.

It integrates with those systems and turns their evidence into a release decision and longitudinal trust record.

## 5. Non-negotiable principles

1. Deterministic policy decides release state; AI may explain but does not silently override PASS/WARN/BLOCK.
2. Evidence is first-class and should survive UI/product changes.
3. Default hosted execution runs in the target repository through GitHub Actions.
4. The control plane orchestrates and persists; it does not centrally clone customer source or run a shared KiCad fleet by default.
5. Large artifacts do not transit the dashboard/web process.
6. Tenant boundaries and result identity fail closed.
7. KiCad-first go-to-market does not imply a KiCad-dependent architecture.
8. Open formats and exportability are preferred over data lock-in.
9. Infrastructure is introduced because a measured trigger exists, not because it is fashionable.
10. The dashboard is a view layer; the workflow value must also exist in PRs, checks, CLI, and evidence.

See `02-PRODUCT_PRINCIPLES.md` and `05-ARCHITECTURE_AND_BOUNDARIES.md`.

## 6. Product layers

### Adoption layer

**PR Hardware Change Impact**

- What changed in schematic/PCB/BOM/manufacturing-relevant data?
- Which risks increased or decreased?
- Which policy gates changed?
- What is safe to auto-fix and how is it verified?

### Trust layer

**Hardware Release Passport / verifiable release evidence**

- source and artifact identities;
- tool/policy versions;
- findings, waivers, approvals;
- signatures/attestations;
- standard exports and offline verification.

### Recurring cloud layer

**Continuous Hardware Health / BOM and supply-chain monitoring**

Risk can change without a commit. Cloud value comes from history, monitoring, cross-repository context, notifications, and portfolio impact.

### Enterprise layer

**Organization policy + audit + customer-hosted execution**

- policy inheritance and controlled overrides;
- organization-wide evidence;
- bounded customer-hosted execution;
- identity, audit, data, and retention controls.

### Moat layer

**Evidence Graph + manufacturing outcomes**

Connect design/release evidence to actual manufacturing and field outcomes. This is long-term and must begin with pragmatic data ingestion, not a large platform rewrite.

## 7. Execution phases

| Phase | Outcome | State | Hard exit signal |
|---|---|---|---|
| 0 | Strategy and operating system | ACTIVE | Decisions, boundaries, roadmap, metrics, and risk system exist and are reviewed |
| 1 | Repository & release health | ACTIVE | Required security/release gates green and publishing/reference integrity proven |
| 2 | Cloud reliability | ACTIVE | Recovery, backup/restore, load/soak, reconciliation evidence reproducible |
| 3 | GitHub Cloud GA trust | BLOCKED/VALIDATING | Production App permissions, target workflow, OIDC, private/fork policy, and two-installation isolation proven |
| 4 | Website + positioning | PROPOSED | Product is explainable in 30 seconds and has a credible trust story |
| 5 | Onboarding + first value | PROPOSED | A target user reaches first useful finding without maintainer intervention |
| 6 | Dashboard/evidence UX | NEXT | Users can investigate a run and evidence without proxying artifact bytes |
| 7 | PR Change Impact | NEXT | Meaningful hardware deltas produce useful evidence-backed PR decisions |
| 8 | Release Passport | NEXT | Release identity is durable, portable, and independently verifiable |
| 9 | Continuous BOM intelligence | LATER | External data changes map to affected products/releases and policy impact |
| 10 | Organization policy | LATER | Organization defaults, inheritance, overrides, waivers, and audit are usable |
| 11 | Enterprise trust | LATER | Customer-hosted execution and enterprise trust controls meet design-partner needs |
| 12 | Manufacturing feedback | EXPLORE | Real production outcome data is linked to releases for design partners |
| 13 | Evidence Graph | EXPLORE | Longitudinal product/release/component/outcome relationships are queryable |
| 14 | AI reviewer | LATER | AI reliably explains deterministic evidence with human-in-the-loop guardrails |
| 15 | Marketplace/ecosystem | TRIGGER-BASED | Plugin trust/sandbox/provenance model is sufficient for third-party code |
| 16 | EDA expansion | TRIGGER-BASED | KiCad wedge is validated and explicit customer demand justifies next adapter |

Detailed scope and gates: `08-PRODUCT_ROADMAP.md`.

## 8. Immediate work order

The following ordering is intentionally aligned with issue #191:

### Now — trust foundation

- Close repository/release-health blockers tracked by #191.
- Complete control-plane reliability evidence (#190 and #222).
- Complete GitHub Cloud GA evidence (#149, #42, #154, #88).
- Resolve any version/pinning drift in production-target workflows through an explicit compatibility decision.
- Keep public claims aligned with deployed behavior and actual GitHub App permissions.

### Next — useful product surface

- Hosted run dashboard and reconnectable status timeline (#25).
- Evidence viewer and direct signed artifact access (#26).
- Retention/deletion/privacy lifecycle UX (#44).
- First-class PR change-impact view.
- Onboarding that reaches a useful result quickly.

### Then — recurring value

- Release Passport registry and standard exports.
- Continuous BOM/supply-chain watch.
- Organization policy and cross-repository portfolio views.

### Later — defensibility and expansion

- Manufacturing outcome ingestion.
- Evidence Graph / Hardware Memory.
- Enterprise expansion driven by real contracts.
- AI explanation/reviewer layer.
- Marketplace after plugin runtime trust is mature.
- Additional EDA adapters after KiCad PMF signals.

## 9. Parallel business workstreams

Engineering sequencing must not postpone product validation.

Parallel tracks:

- customer discovery;
- 2–5 design partners using real repositories/releases;
- brand/domain/trademark review;
- website and trust messaging;
- OSS/Cloud licensing boundary decision;
- pricing/packaging experiments;
- security/privacy/legal readiness;
- support and incident operations.

See documents 10, 15, and 16.

## 10. Definition of Done

A feature or milestone is not complete because code merged.

**DONE = implemented + tested + security/privacy considered + documented + observable + migration/backward-compatibility handled + acceptance evidence captured + intended user outcome validated.**

Each implementation issue should state:

- problem and why now;
- user/business outcome;
- scope and non-scope;
- dependencies;
- acceptance criteria;
- security/privacy implications;
- test/evidence plan;
- rollout/rollback;
- documentation;
- metric expected to move.

## 11. Go/No-Go gates

### Cloud GA

No public GA claim until the reliability prerequisite and GitHub Cloud GA milestone in issue #191 are complete with real-environment evidence.

### Repository split

Do not split frontend/backend into multiple repositories merely for technical layering. Reconsider only when the OSS/commercial boundary, permissions, teams, or release cadences genuinely diverge. See `06-OSS_CLOUD_BOUNDARY.md` and `19-DECISION_LOG.md`.

### Second EDA

Do not fund a broad EDA matrix until KiCad activation/retention and explicit design-partner demand justify it.

### Marketplace

Do not run arbitrary untrusted third-party plugins in hosted infrastructure until a runtime trust model exists.

### Major infrastructure

Microservices, Kubernetes, external brokers, workflow engines, language rewrites, and cell-based isolation remain trigger-based. See `21-NOT_NOW_AND_TRIGGERS.md`.

## 12. Operating cadence

### Weekly execution review

- What shipped with evidence?
- What is blocked?
- What is the single most important next outcome?
- What did users teach us?
- Did a risk or assumption change?
- Does #191 still match reality?

### Monthly strategy review

- Is the ICP still correct?
- Is the PR/release trust wedge being adopted?
- What do users repeatedly pay attention to?
- Which planned capability should be killed or deferred?
- Are competitors/regulation/standards changing the opportunity?
- Is our moat becoming stronger or merely our infrastructure becoming more complex?

Templates: `23-WEEKLY_MONTHLY_OPERATING_REVIEW.md`.

## 13. Current open strategic decisions

The following must remain explicit instead of being accidentally decided by implementation:

- Final OSS vs proprietary Cloud licensing boundary.
- Canonical commercial domain acquisition and brand/trademark clearance.
- Initial paid packaging/value metric.
- Whether Release Passport is a product name or an internal concept.
- Which supplier-intelligence providers are acceptable for production data.
- When the canonical hardware model is mature enough to support a second EDA.
- What manufacturing outcome schema is sufficient for first design partners.

Track status in `19-DECISION_LOG.md`.

## 14. Success test for the whole strategy

BoardReadyOps is succeeding when a hardware team naturally says:

> Before this hardware change reaches production, BoardReadyOps tells us what changed, whether it is safe, why, and exactly what evidence proves the released state — then keeps watching that product after the code stopped changing.

Everything on the roadmap should strengthen that sentence. If it does not, it needs a stronger reason to exist.
