# Risk Register

Use this register for strategic/product/operational risks. Implementation-specific security threats remain in the threat model and owning issues.

Scale:

- Probability: Low / Medium / High
- Impact: Medium / High / Critical
- State: WATCH / ACTIVE / MITIGATING / ACCEPTED / CLOSED

| ID | Risk | Probability | Impact | State | Leading indicator | Primary mitigation |
|---|---|---|---|---|---|---|
| R-001 | Infrastructure success / product failure | High | Critical | ACTIVE | large platform progress but weak external retained use | design partners, time-to-value, outcome-gated roadmap |
| R-002 | Cross-tenant or forged-result trust failure | Low/Medium | Critical | MITIGATING | isolation/OIDC/authorization test failure | GA blockers, fail-closed identity, two-installation evidence |
| R-003 | OSS/Cloud licensing boundary remains ambiguous | High | High | ACTIVE | commercial code grows under unclear policy | explicit decision + legal review before proprietary split |
| R-004 | Single-maintainer/bus-factor risk | High | High | ACTIVE | release/security knowledge concentrated in one person | automation, runbooks, contributor path, independent review |
| R-005 | GitHub platform dependency | High | High | WATCH | App/Actions policy/pricing/outage materially blocks product | stable contracts, customer-hosted path, avoid unnecessary proprietary coupling |
| R-006 | KiCad-only perception limits market | Medium | Medium/High | WATCH | prospects reject before trying because EDA | EDA-neutral messaging/model; expand only on validated demand |
| R-007 | EDA expansion too early destroys focus | Medium | High | WATCH | adapter backlog exceeds core product learning | second-EDA gate and canonical-model boundary |
| R-008 | Supplier-data cost/quality undermines SaaS economics | Medium | High | WATCH | high API cost, stale/conflicting observations, noisy alerts | provider neutrality, freshness/trust metadata, cost metrics |
| R-009 | Continuous monitoring creates alert fatigue | Medium | High | WATCH | low action rate/high dismiss rate | product/release impact context, policy relevance, low-noise defaults |
| R-010 | Release score becomes opaque pseudo-risk oracle | Medium | High | WATCH | users cannot explain score/blocker relationship | decomposable evidence; score never overrides blockers |
| R-011 | Plugin ecosystem creates hosted supply-chain risk | Medium | Critical | WATCH | demand to run arbitrary third-party code before sandbox | defer marketplace; safer config-only/first-party surfaces |
| R-012 | Security/compliance marketing outruns evidence | Medium | Critical | ACTIVE | copy says “secure/compliant” beyond verified scope | trust review gate; copy tied to deployed behavior |
| R-013 | Domain/trademark conflict after brand investment | Low/Medium | High | WATCH | canonical domain unavailable or similar mark found | early availability/conflict/legal review |
| R-014 | SaaS repository split happens too early | Medium | Medium | WATCH | cross-repo contract/version choreography slows iteration | keep monorepo until explicit split triggers |
| R-015 | SaaS repository split happens too late | Medium | High | WATCH | proprietary/team/permission boundaries become painful | quarterly boundary review and trigger list |
| R-016 | Manufacturing-feedback scope expands into MES/QMS | Medium | High | WATCH | requests drive scheduling/WIP/operator features | strict outcome-ingestion scope and design-partner pilots |
| R-017 | Manufacturing correlations are presented as causation | Medium | Critical | WATCH | users/AI infer root cause from weak temporal data | association labels, engineer confirmation, evidence discipline |
| R-018 | AI weakens deterministic trust | Medium | Critical | WATCH | AI action changes release state without policy path | AI role constraints, citations, human/deterministic approvals |
| R-019 | Customer private data leaks through public evidence/issues | Low/Medium | Critical | ACTIVE | logs/evidence contain tenant identifiers/secrets | redaction policy, evidence review, private storage, public-issue hygiene |
| R-020 | GA pressure bypasses reliability gates | Medium | Critical | ACTIVE | “beta/GA” date used to waive #191 requirements | launch checklist and no-go conditions |
| R-021 | Product becomes dashboard-centric and leaves engineer workflow | Medium | High | WATCH | high dashboard work, low PR/check engagement | PR-first success metrics and workflow surfaces |
| R-022 | Pricing metric discourages adoption/collaboration | Medium | High | WATCH | users limit repos/users to control bill | test product/repo/org value metrics; generous collaboration |
| R-023 | Public strategy reveals sensitive commercial information | Medium | Medium/High | ACTIVE | customer/pricing/private assumptions placed in public repo | keep identifying/confidential notes private; publish generalized strategy only |
| R-024 | Standard/version churn creates lock-in to premature format | Medium | Medium | WATCH | internal model mirrors unreleased spec too closely | versioned adapters and independent canonical model |
| R-025 | Operational burden exceeds small-team capacity | Medium/High | High | WATCH | on-call/support/reconciliation work dominates development | managed services, automation, narrow GA scope, clear SLOs |

## Top risks requiring continuous attention

### R-001 — Infrastructure success / product failure

This is the primary strategic risk. BoardReadyOps already contains unusually strong architecture/security/release machinery for its stage. The next increment of value must increasingly come from real users and repeated workflows, not only more infrastructure.

**Mitigation tests:**

- Are external teams activating without maintainer intervention?
- Do they return next week?
- Did a BoardReadyOps result change a real decision?
- Are customers asking for history/monitoring/policy because local checks were valuable?

### R-002 — Trust-boundary failure

A single credible cross-tenant or forged-result failure can invalidate the product category promise.

**Mitigation:** treat #88/#154 and equivalent trust work as launch blockers, not optional hardening.

### R-003 — Licensing ambiguity

The current MIT repository and emerging Cloud code require an explicit commercial/open-source decision before large proprietary investment or code movement.

### R-004 — Bus factor

Automated verification is strong but independent human review and operational continuity matter for an enterprise trust product.

### R-023 — Public strategy confidentiality

This repository is public. Do not store customer names, contract terms, credentials, private incident details, unpublished exact pricing commitments, or proprietary partner data in these files.

## Risk review

Weekly:

- new/changed P0 trust/product risks;
- risks blocking current phase.

Monthly:

- probability/impact changes;
- new competitive/regulatory/platform risks;
- whether mitigations have evidence;
- whether accepted risks remain acceptable.

When a risk becomes implementation-specific, open/link an issue and keep the register summary concise.
