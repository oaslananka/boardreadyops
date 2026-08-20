# BoardReadyOps Strategy Execution System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a durable, reviewable strategy and execution documentation system that connects BoardReadyOps vision, current GitHub roadmap, architecture constraints, launch gates, business validation, metrics, and operating cadence.

**Architecture:** Keep accepted ADRs and issue #191 authoritative for technical decisions and delivery dependency order. Add `docs/strategy/` as a higher-level operating layer without rewriting historical `docs/ROADMAP.md`; keep strategy documents outside the public MkDocs navigation until explicitly reviewed for publication.

**Tech Stack:** Markdown, GitHub issues/milestones, existing MkDocs repository documentation, existing ADR process.

**Spec:** `docs/strategy/00-MASTER_PLAN.md`

## Global Constraints

- Do not override accepted ADRs from strategy documents.
- Issue #191 remains authoritative for current delivery sequence and Cloud GA gates.
- `docs/ROADMAP.md` remains the historical v2 capability roadmap.
- Do not make unverified security, compliance, availability, pricing, trademark, or domain-ownership claims.
- Mark unresolved strategic choices as `PROPOSED` or `OPEN`, not `ACCEPTED`.
- Keep deferred infrastructure trigger-based.
- Do not add the strategy section to `mkdocs.yml` until content is explicitly approved for public documentation.

---

### Task 1: Establish the strategy document hierarchy

**Files:**
- Create: `docs/strategy/README.md`
- Create: `docs/strategy/00-MASTER_PLAN.md`
- Create: focused strategy documents `01` through `23`

**Interfaces:**
- Consumes: `docs/ROADMAP.md`, issue #191, accepted ADRs, current repository structure.
- Produces: stable links and source-of-truth rules for subsequent product/engineering work.

- [ ] Verify every strategy document has a single responsibility and is linked from `docs/strategy/README.md`.
- [ ] Verify `00-MASTER_PLAN.md` points to issue #191 rather than duplicating task-level ownership.
- [ ] Verify unresolved decisions are visibly marked.
- [ ] Commit the documentation set with a conventional docs commit.

### Task 2: Reconcile current GitHub roadmap with the Master Plan

**Files:**
- Review: `docs/strategy/08-PRODUCT_ROADMAP.md`
- Review: `docs/strategy/09-CLOUD_GA_PLAN.md`
- Review: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: issue #191 milestone order and exit conditions.
- Produces: a phase model where current issue status wins over static prose.

- [ ] Check every #191 implementation issue appears in the appropriate strategy phase.
- [ ] Confirm completed historical milestones are not reopened by the strategy docs.
- [ ] Confirm Cloud GA remains blocked by reliability plus real GitHub trust evidence.
- [ ] Add/update issue links when sequencing changes.

### Task 3: Turn strategic choices into explicit decisions

**Files:**
- Review: `docs/strategy/19-DECISION_LOG.md`
- Review: `docs/strategy/06-OSS_CLOUD_BOUNDARY.md`
- Review: `docs/strategy/10-WEBSITE_BRAND_DOMAIN.md`
- Review: `docs/strategy/15-GTM_AND_PRICING.md`

**Interfaces:**
- Consumes: product/business choices made during execution.
- Produces: dated `PROPOSED`, `ACCEPTED`, `SUPERSEDED`, or `REJECTED` records.

- [ ] Resolve OSS/Cloud licensing only after appropriate legal/product review.
- [ ] Resolve canonical domain/brand only after registration and conflict checks.
- [ ] Resolve initial pricing/value metric only after design-partner evidence.
- [ ] Create ADRs for decisions that alter architecture or deployment boundaries.

### Task 4: Operate weekly and monthly reviews

**Files:**
- Use: `docs/strategy/23-WEEKLY_MONTHLY_OPERATING_REVIEW.md`
- Update: `docs/strategy/00-MASTER_PLAN.md`
- Update: `docs/strategy/18-RISK_REGISTER.md`
- Update: `docs/strategy/17-METRICS.md`

**Interfaces:**
- Consumes: GitHub delivery state, customer feedback, reliability/security evidence, product metrics.
- Produces: one current next outcome, updated risks, and explicit strategic changes.

- [ ] Run the weekly execution checklist.
- [ ] Update the Master Plan current phase/blockers only when evidence changed.
- [ ] Record new material decisions instead of silently editing past rationale.
- [ ] Run the monthly strategy review and remove/defer work that lacks evidence.

### Task 5: Gate launches through evidence

**Files:**
- Use: `docs/strategy/20-LAUNCH_CHECKLIST.md`
- Use: `docs/strategy/09-CLOUD_GA_PLAN.md`
- Reference: issue #191 and linked implementation issues.

**Interfaces:**
- Consumes: technical, product, security, legal, support, and operational evidence.
- Produces: explicit go/no-go decision for alpha/beta/GA promotions.

- [ ] Attach or link evidence for every mandatory gate.
- [ ] Confirm public product copy matches actual permissions/data/execution behavior.
- [ ] Do not promote when a P0 trust/release-health condition is unresolved.
- [ ] Record the promotion decision and date in the decision log.

### Task 6: Verify documentation consistency

**Files:**
- Review: `docs/strategy/**/*.md`
- Review: `mkdocs.yml`

**Interfaces:**
- Consumes: the completed strategy set.
- Produces: a coherent documentation system with no accidental public-nav change.

- [ ] Scan for placeholder language (`TBD`, unowned `TODO`, unsupported claims) and replace with explicit `OPEN` decisions or concrete gates.
- [ ] Check file links and numbering.
- [ ] Confirm `mkdocs.yml` was not changed unless publication was explicitly approved.
- [ ] Run the repository documentation checks when the plan is executed in a development environment: `corepack pnpm run docs` and the repository's standard verification command appropriate to documentation-only changes.
