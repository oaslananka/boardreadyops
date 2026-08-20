# BoardReadyOps Strategy and Execution System

This directory is the project-level operating system for BoardReadyOps. It sits above implementation issues and below the long-term company/product vision.

## Source-of-truth hierarchy

When two documents disagree, use this order:

1. Deployed behavior and executable tests for what the software actually does.
2. Accepted ADRs under `docs/architecture/adr/` for architectural decisions.
3. GitHub issue #191 for the current delivery dependency order and GA gates.
4. `docs/strategy/00-MASTER_PLAN.md` for product, engineering, business, and operating context.
5. The focused strategy documents in this directory.
6. `docs/ROADMAP.md` for the historical v2 capability roadmap and completed foundations.
7. Individual implementation issues and PRs for task-level detail and evidence.

The strategy documents do not override accepted ADRs or security/release gates. If a strategy decision requires an architecture change, create or supersede an ADR first.

## Documents

- [00 — Master Plan](00-MASTER_PLAN.md)
- [01 — Vision and Positioning](01-VISION_AND_POSITIONING.md)
- [02 — Product Principles](02-PRODUCT_PRINCIPLES.md)
- [03 — ICP and Jobs To Be Done](03-ICP_AND_JOBS_TO_BE_DONE.md)
- [04 — Capability Map](04-CAPABILITY_MAP.md)
- [05 — Architecture and Boundaries](05-ARCHITECTURE_AND_BOUNDARIES.md)
- [06 — OSS / Cloud Boundary](06-OSS_CLOUD_BOUNDARY.md)
- [07 — Security, Trust, and Compliance](07-SECURITY_TRUST_COMPLIANCE.md)
- [08 — Product Roadmap](08-PRODUCT_ROADMAP.md)
- [09 — Cloud GA Plan](09-CLOUD_GA_PLAN.md)
- [10 — Website, Brand, and Domain](10-WEBSITE_BRAND_DOMAIN.md)
- [11 — EDA and Canonical Model](11-EDA_AND_CANONICAL_MODEL.md)
- [12 — Supply Chain Strategy](12-SUPPLY_CHAIN_STRATEGY.md)
- [13 — Manufacturing Feedback](13-MANUFACTURING_FEEDBACK.md)
- [14 — AI and Agent Strategy](14-AI_AND_AGENT_STRATEGY.md)
- [15 — GTM and Pricing](15-GTM_AND_PRICING.md)
- [16 — Customer Discovery and Design Partners](16-CUSTOMER_DISCOVERY_AND_DESIGN_PARTNERS.md)
- [17 — Metrics](17-METRICS.md)
- [18 — Risk Register](18-RISK_REGISTER.md)
- [19 — Decision Log](19-DECISION_LOG.md)
- [20 — Launch Checklist](20-LAUNCH_CHECKLIST.md)
- [21 — Not Now and Architecture Triggers](21-NOT_NOW_AND_TRIGGERS.md)
- [22 — Long-Term Vision and Moat](22-LONG_TERM_VISION_AND_MOAT.md)
- [23 — Weekly and Monthly Operating Review](23-WEEKLY_MONTHLY_OPERATING_REVIEW.md)

## Operating rules

- Keep the Master Plan short enough to scan and detailed enough to make the next decision.
- Put deep reasoning in the focused document and link to it from the Master Plan.
- Every active phase has an objective, scope, dependencies, evidence, metrics, and exit criteria.
- Every material decision is recorded in `19-DECISION_LOG.md` instead of silently rewriting history.
- Every deferred architecture idea has a measurable trigger in `21-NOT_NOW_AND_TRIGGERS.md`.
- Every GA claim requires evidence, not only merged code.
- Review this system weekly for execution state and monthly for strategy.

## Status vocabulary

- `PROPOSED`: discussed but not yet accepted.
- `ACCEPTED`: decision is currently binding.
- `ACTIVE`: work is being executed.
- `BLOCKED`: a dependency prevents completion.
- `VALIDATING`: implementation exists but acceptance evidence is incomplete.
- `COMPLETE`: exit criteria and evidence are satisfied.
- `SUPERSEDED`: replaced by a later explicit decision.
- `TRIGGER-BASED`: intentionally deferred until a measurable condition is met.
