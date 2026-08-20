# Decision Log

This log records strategic decisions and open choices. Architecture decisions that change system design still belong in ADRs; this file points to them rather than replacing them.

## Status values

- `PROPOSED`
- `ACCEPTED`
- `REJECTED`
- `SUPERSEDED`
- `OPEN`

## Decisions

### DEC-001 — Target-repository GitHub Actions is the default hosted execution path

**Status:** ACCEPTED  
**Source:** ADR-0010 and current issue #191 delivery principles.

**Decision:** normal hosted execution runs in a reviewed workflow in the target customer repository. The control plane orchestrates and receives authenticated normalized results.

**Reason:** keeps checkout/source/log/Actions artifact boundaries close to customer GitHub; avoids a persistent BoardReadyOps shared KiCad fleet; uses GitHub execution identity and billing model.

**Revisit trigger:** documented customer/economic evidence justifies a BoardReadyOps-managed execution pool and a new go/no-go ADR.

---

### DEC-002 — Control plane does not centrally clone customer source by default

**Status:** ACCEPTED  
**Source:** issue #191 delivery principles / ADR-0010 architecture.

**Decision:** hosted control plane persists and orchestrates trusted state; it does not need customer source for normal execution.

**Revisit trigger:** a specific feature cannot be delivered safely in the target/customer-hosted execution path and customer value justifies a new trust boundary.

---

### DEC-003 — Large artifact bytes do not transit the web/dashboard process

**Status:** ACCEPTED  
**Source:** issue #191 delivery principles and cloud data model direction.

**Decision:** authorize access in control plane; transfer large bytes directly with bounded storage URLs/target-repository mechanisms.

---

### DEC-004 — Major infrastructure remains trigger-based

**Status:** ACCEPTED  
**Source:** issue #191 deferred architecture/non-goals.

**Decision:** no immediate Kubernetes, microservices, external broker, workflow engine, language rewrite, cell isolation, or binary-delta system without measured trigger and appropriate ADR.

---

### DEC-005 — Position BoardReadyOps as a hardware release trust layer

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** lead external positioning with manufacturing readiness, verifiable release evidence, and the trust boundary between hardware change and physical production. Use “hardware engineering control plane” mainly as internal architecture language.

**Validation:** customer comprehension tests, homepage messaging, design-partner interviews, conversion/activation quality.

---

### DEC-006 — KiCad-first GTM, EDA-neutral architecture

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** continue deep KiCad product quality while designing canonical interfaces that permit later EDA adapters.

**Revisit trigger:** repeated customer demand and validated economics for a specific second EDA.

---

### DEC-007 — Open deterministic engine + paid managed continuity/intelligence

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** keep local deterministic trust capabilities useful/open while monetizing persistent history, monitoring, collaboration, organization policy, portfolio, enterprise controls, and managed integrations.

**Important:** final licensing/legal boundary is not yet decided. Current root repository is MIT licensed. Obtain appropriate review before treating Cloud code as proprietary.

---

### DEC-008 — Keep current monorepo; do not split frontend/backend by layer

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** preserve co-change benefits across contracts/cloud-core/db/web while pre-GA. If code visibility/commercial/team/release boundaries diverge, consider a public OSS repo plus separate Cloud repo.

**Revisit triggers:** defined in `06-OSS_CLOUD_BOUNDARY.md`.

---

### DEC-009 — `boardreadyops.com` as preferred canonical commercial domain

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** prefer `.com` for the commercial product if registrar availability and brand/trademark review succeed. `.dev`/`.io` may be defensive/developer registrations if justified.

**Acceptance evidence:** registration ownership, security configuration, conflict review, final naming decision.

---

### DEC-010 — Hardware Release Passport as a portable trust-object concept

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** define a stable release identity connecting source, artifact digests, BOM/firmware, tool/policy versions, findings, waivers, approvals, signatures, and standard exports.

**Constraint:** do not create proprietary lock-in; preserve offline verification and open exports.

---

### DEC-011 — Continuous BOM/supply-chain watch as primary recurring Cloud value hypothesis

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** validate recurring monitoring because hardware risk changes without commits. Differentiate through affected-product/release mapping and policy impact rather than raw component search.

**Validation:** alert usefulness, retention, provider cost, willingness to pay.

---

### DEC-012 — AI is an explanation/assistance layer, not release authority

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** deterministic policy remains authoritative for release state. AI can explain, summarize, prioritize, investigate, and draft bounded actions with evidence citations.

---

### DEC-013 — Manufacturing feedback is a long-term moat experiment, not an MES roadmap

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** start with release-linked batch/outcome ingestion for design partners; do not build factory execution/scheduling/WIP features.

---

### DEC-014 — Strategy docs remain outside MkDocs navigation until publication review

**Status:** PROPOSED  
**Date proposed:** 2026-08-21

**Decision:** keep this strategy system in the public repository but not in the generated user-doc navigation until content, confidentiality, and desired public positioning are reviewed.

**Note:** files in a public repository are still public even when absent from MkDocs navigation.

## Open decisions

- final OSS/Cloud licensing and repository boundary;
- canonical domain acquisition/brand clearance;
- exact initial pricing/package/value metric;
- Release Passport product naming;
- production supplier provider(s);
- second EDA priority and timing;
- manufacturing feedback schema/pilot partners;
- whether public strategy docs should remain public long-term;
- self-hosted control plane product position.

## Decision process

For material decisions:

1. record problem/context;
2. list options and constraints;
3. record evidence/customer input;
4. mark `PROPOSED`;
5. obtain required technical/legal/business review;
6. mark `ACCEPTED` or `REJECTED` with date;
7. create/supersede ADR when architecture changes;
8. update Master Plan/roadmap references;
9. never erase old rationale — use `SUPERSEDED`.
