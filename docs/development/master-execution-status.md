# BoardReadyOps — Master Execution Status & Workstream Ledger

> **Last Updated:** September 2, 2026
> **Source Specification:** `BoardReadyOps_Agent_Master_Development_Spec.md` (SHA-256 e02df14e…857c62, **not committed to this repository** — provenance unverified; see the `spec` field in [master-execution-status.json](master-execution-status.json))
> **Public Roadmap Alignment:** [ROADMAP.md](../ROADMAP.md) · **Delivery Sequencing:** Issue [#191](https://github.com/oaslananka/boardreadyops/issues/191)

---

## 1. Executive Summary & Delivery Sequencing

This ledger is the single engineering source of truth tracking all 37 capabilities and workstreams (**W00** through **W36**) across the 8 execution phases. It bridges high-level product strategy, architectural ADRs, and granular code/test evidence.

### Phase Progression Model

```text
Phase 0: Baseline & Drift Control (W00)
    │
Phase 1: Release Health & Cloud Reliability [P0] (W01, W02, W16, W28, W29, W34)
    │
Phase 2: GitHub Cloud GA Security Gates [P0] (W15, W17, W18)
    │
Phase 3: Core Daily Value & Adoption [P0/P1] (W20, W21, W08, W10, W11, W14, W19)
    │
Phase 4: Core Engineering Depth [P1] (W03, W05, W09, W12, W13)
    │
Phase 5: Enterprise Trust & Governance [P1/P2] (W22, W23, W33, W18)
    │
Phase 6: Manufacturer Collaboration & Production Loop [P2] (W24, W25, W10)
    │
Phase 7: Agent/AI & Ecosystem Layer [P2] (W26, W27, W35)
    │
Phase 8: Moat & Predictive Intelligence [P3, Data-Triggered] (W36)
```

---

## 2. Workstream Status Matrix

<!-- master-execution-status:start -->
| Workstream | Name | Priority | Phase | Status | Owner | Dependencies | Roadmap target |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| W00 | Repository Inventory & Execution Ledger | P0 | 0 | implemented | maintainers | — | Repository Maintenance & Release Health |
| W01 | Repository Maintenance & Release Health | P0 | 1 | partial | maintainers | W00 | Repository Maintenance & Release Health |
| W02 | Schema & Contract Governance | P0 | 1 | partial | maintainers | W00 | Repository Maintenance & Release Health |
| W06 | Deterministic Release Decision Engine | P0 | 1 | partial | maintainers | W00 | Repository Maintenance & Release Health |
| W07 | Evidence Bundle, Signing, Provenance & Hardware SLSA | P0 | 1 | partial | maintainers | W00 | Repository Maintenance & Release Health |
| W16 | Cloud Control Plane Reliability | P0 | 1 | implemented | maintainers | W00 | Cloud Control Plane Reliability — GitHub GA Prerequisite |
| W28 | Security, Privacy, Threat Modeling & Trust Center | P0 | 1 | partial | maintainers | W00 | Repository Maintenance & Release Health |
| W29 | Observability, SLOs & Operations | P0 | 1 | partial | maintainers | W00 | Cloud Control Plane Reliability — GitHub GA Prerequisite |
| W34 | Quality Engineering: Fuzz, Mutation, Bad-Board Zoo | P0 | 1 | partial | maintainers | W00 | Repository Maintenance & Release Health |
| W30 | Performance, Scalability & Cost Controls | P1 | 1 | partial | maintainers | W00 | Cloud Control Plane Reliability — GitHub GA Prerequisite |
| W15 | GitHub App & PR Manufacturing Gate | P0 | 2 | partial | maintainers | W01, W16, W28 | v2.2 — GitHub Cloud GA |
| W17 | Authentication, Tenant Isolation, RBAC & API Tokens | P0 | 2 | partial | maintainers | W16, W28 | v2.2 — GitHub Cloud GA |
| W18 | Artifact Storage, Access, Retention & Privacy | P0 | 2 | partial | maintainers | W16, W17 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W04 | Artifact Generation Engine | P0 | 3 | partial | maintainers | W02, W06 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W08 | Release-to-Release Diff & Hardware Change Impact | P0 | 3 | partial | maintainers | W06, W07 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W14 | Policy, Waivers & Approval Governance | P0 | 3 | partial | maintainers | W06, W07 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W20 | Release Command Center & Cloud UX | P0 | 3 | partial | maintainers | W15, W17, W18 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W10 | Manufacturer Intelligence & Versioned Process Profiles | P1 | 3 | partial | maintainers | W06, W07 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W11 | BOM, Supply Chain & Cost Intelligence | P1 | 3 | partial | maintainers | W06, W07 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W19 | Billing, Entitlements & Metering | P1 | 3 | partial | maintainers | W17, W18 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W21 | PCB/Schematic/Gerber/3D Viewers & Visual Diff | P1 | 3 | partial | maintainers | W15, W18 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W31 | Documentation, Onboarding, Golden Demo & DevEx | P1 | 3 | partial | maintainers | W15, W20 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W32 | Product Analytics & Privacy-Safe Adoption Metrics | P1 | 3 | partial | maintainers | W17, W20 | v2.3 — Release Dashboard, Evidence & Artifact UX |
| W03 | Core Discovery, Parsers & Normalized Hardware Model | P1 | 4 | partial | maintainers | W02, W04 | Backlog — Core Engineering Depth |
| W05 | DFM / DFA / DFT Rule Engine | P1 | 4 | partial | maintainers | W03, W04 | Backlog — Core Engineering Depth |
| W09 | Variants, Multi-Board & Product Hierarchy | P1 | 4 | partial | maintainers | W03, W04 | Backlog — Core Engineering Depth |
| W12 | Firmware ↔ Hardware Contract | P1 | 4 | partial | maintainers | W03, W06 | Backlog — Core Engineering Depth |
| W13 | Mechanical ↔ PCB Contract | P1 | 4 | partial | maintainers | W03, W04 | Backlog — Core Engineering Depth |
| W22 | Enterprise Trust: SSO, SCIM, Customer-Hosted Agent | P1 | 5 | partial | maintainers | W17, W18, W20 | v2.6 — Enterprise Trust & Customer-Hosted Execution |
| W33 | Compliance & Audit Export | P1 | 5 | partial | maintainers | W17, W18, W22 | v2.6 — Enterprise Trust & Customer-Hosted Execution |
| W23 | Integrations: GitLab, Azure DevOps, Jira, Slack/Teams | P2 | 5 | partial | maintainers | W17, W20 | v2.6 — Enterprise Trust & Customer-Hosted Execution |
| W24 | Manufacturer / CM Handoff Portal, RFQ & Questions | P2 | 6 | partial | maintainers | W20, W22 | Backlog — Manufacturer Collaboration & Production Loop |
| W25 | Production Runs, Traceability, Yield & Outcomes | P2 | 6 | partial | maintainers | W20, W22, W24 | Backlog — Manufacturer Collaboration & Production Loop |
| W26 | AI Reviewer & Agent Remediation Layer | P2 | 7 | partial | maintainers | W06, W20, W22 | v2.7 — Marketplace, Ecosystem & AI Reviewer |
| W27 | MCP / Agent API / Plugin SDK | P2 | 7 | partial | maintainers | W06, W20, W22 | v2.7 — Marketplace, Ecosystem & AI Reviewer |
| W35 | Marketplace, Ecosystem & Distribution | P2 | 7 | partial | maintainers | W15, W22 | v2.7 — Marketplace, Ecosystem & AI Reviewer |
| W36 | Manufacturing Feedback Intelligence & Predictive Risk | P3 | 8 | deferred | maintainers | W25 | Deferred — outcome-data trigger |
<!-- master-execution-status:end -->

---

## 3. Workstream Execution Details

### W00 — Repository Inventory & Execution Ledger
- **Status:** `Implemented`
- **Scope:** Canonical single-ledger tracking all capabilities, architecture boundaries, and execution status.
- **Code & Test Evidence:** `docs/development/master-execution-status.md`, `ROADMAP.md`.
- **Next Steps:** Continuous automated reconciliation in CI.

### W01 — Repository Maintenance & Release Health
- **Status:** `Partial`
- **Remaining:** Issue #546 is now closed (PR #566). Reproducible-build/clean-room independent rebuild evidence is documented as future work in docs/security/release-integrity.md; no other tracked blocker remains open.
- **Scope:** Zero-drift build/test/release toolchain, strict TypeScript compilation, Knip unused-code analysis, and LTS matrix.
- **Code & Test Evidence:** `scripts/toolchain.mjs`, `scripts/build.mjs`, `scripts/verify-dist.mjs`, `tests/unit/scripts/`.
- **Verification:** `task verify` passes deterministically.

### W02 — Schema & Contract Governance
- **Status:** `Partial`
- **Remaining:** The schema-shape drift guard (tests/snapshot/schemas.snapshot.test.ts, PR #568), RFC 8785 canonicalization (src/util/json.ts), the Runner↔Control-Plane .strict()/.strip() security triage, and explicit unknown-enum-value forward-compatibility tests are all resolved. Consumer-driven contract tests now also span the CLI→Cloud and Action→Cloud boundaries specifically: `tests/unit/contracts/cli-cloud-forward-compat.test.ts` (`review publish` → `POST /api/v1/runs`, `ingestRunRequestSchema`) and `tests/unit/contracts/action-cloud-forward-compat.test.ts` (the Action's two wire paths — OIDC `POST /api/v1/runs/github-actions-result` via `releaseRunResultSchema`, and the bearer-token `POST /api/v1/runs` quick cloud upload). No further gaps are tracked against this workstream's evidence at this time.
- **Scope:** 11 versioned public JSON schemas in `schemas/` and shared TypeScript contracts in `packages/contracts/`.
- **Code & Test Evidence:** `schemas/agent-plan.schema.json`, `findings.schema.json`, `release-manifest.schema.json`, `tests/unit/contracts/`.

### W03 — Core Discovery, Parsers & Normalized Hardware Model
- **Status:** `Partial`
- **Remaining:** No Gerber X2/X3 or Excellon metadata parser, no IPC-2581/ODB++ adapter, no parser confidence/provenance fields, and no hostile-input size/DoS guard beyond the sexpr nesting-depth cap (PR #565) were found.
- **Scope:** Deterministic KiCad project/schematic/PCB discovery, S-expression parsing, variants extraction, and normalized BOM loading.
- **Code & Test Evidence:** `src/core/discovery.ts`, `src/kicad/sexpr.ts`, `src/bom/loader.ts`, `src/bom/identity.ts`.

### W04 — Artifact Generation Engine
- **Status:** `Partial`
- **Remaining:** No integration test exercises real kicad-cli output generation (tests/integration/e2e.test.ts runs with --skip-generate); the manifest omits source-commit/KiCad-version/recipe-hash/environment provenance fields; no jobset-vs-recipe conflict reporting or reproducibility score.
- **Scope:** Versioned generation of Gerber, Excellon drill, BOM, CPL, PDF, SVG, and STEP files using KiCad CLI backend.
- **Code & Test Evidence:** `src/release/generate.ts`, `src/cli/commands/generate.ts`, `schemas/generate-recipe.schema.json`.

### W05 — DFM / DFA / DFT Rule Engine
- **Status:** `Partial`
- **Remaining:** CLOSED (this pass): `RuleMetadata` (`src/core/rule-registry.ts`) now carries four required, non-optional classification fields backfilled with a genuine per-rule value for all 44 built-in rules, each individually asserted in `tests/unit/rules/metadata.test.ts` — `category` (electrical | manufacturability | assembly | testability | sourcing | release, grounded in this repo's own rule-group split and its pre-existing `dfa`/`dfm` rule tags), `evidenceType` (exact | heuristic, grounded in which rules do deterministic checks vs free-text pattern/scoring heuristics), `fixability` (manual | assisted | none, grounded in the `rules only report` convention — `drc.kicad`/`erc.kicad` are `assisted` since the remedy lives in KiCad's own UI), and `vendorDependence` (manufacturer-specific | profile-specific | none, grounded in the existing `src/vendor/profiles.ts` mechanism). An `unclassified` value was added to each enum solely for plugin-loaded rules, since `PluginRuleMetadata` (the separately versioned `packages/plugin-sdk` public contract) does not yet carry this data — that public contract was deliberately left untouched as out of scope. SonarCloud flagged 11.8% new-code duplication (gate ≤ 3%) from the same four-field block repeating near-verbatim across the 44 rule files; fixed by adding `RULE_CLASSIFICATIONS` to `rule-registry.ts` — 14 named presets, one per distinct combination that actually occurs — so each rule spreads its preset instead of repeating the literals, with values unchanged. False-positive telemetry: this codebase's only existing mechanism for marking a finding as wrong is waiving it (`src/core/waivers.ts`); that hook was extended rather than replaced — `applyWaivers()` now returns `falsePositiveSignals` whenever a waiver's free-text reason matches a false-positive pattern, and `src/core/pipeline.ts` enriches each signal with the rule's `category`/`evidenceType` and emits it through the existing structured `Logger` as a `pipeline.waiver.false-positive` event, making false-positive rate queryable per rule category/evidence-type. Still genuinely open and unchanged: geometry-heavy DFM (trace/spacing/copper-edge/hole-hole/annular-ring/via-aspect-ratio) is delegated entirely to KiCad's native DRC/ERC, not owned by a BoardReadyOps rule engine; no solder-mask/paste/NPTH-PTH-slot semantics.
- **Scope:** Comprehensive DRC/ERC execution, manufacturing clearance, annular ring, solder mask, silkscreen, and DFA component checks.
- **Code & Test Evidence:** `src/rules/drc/`, `src/rules/erc/`, `src/rules/manufacturing/`, `src/core/rule-registry.ts`, `src/core/waivers.ts`, `src/core/pipeline.ts`, `tests/unit/rules/metadata.test.ts`, `tests/unit/core/waivers.test.ts`, `tests/unit/core/pipeline-waiver-telemetry.test.ts`.

### W06 — Deterministic Release Decision Engine
- **Status:** `Partial`
- **Remaining:** No explicit named PASS/FAIL/CONDITIONAL/UNKNOWN vocabulary (readiness.ts uses ready/at-risk/blocked; policy.ts uses pass/fail) and no dedicated cross-run decision fingerprint/hash for same-input-same-decision regression testing, though the DecisionExplanationGraph (PR #565) and injectable clock cover the core acceptance criteria.
- **Scope:** Pure functional release decision synthesis (PASS / FAIL / CONDITIONAL / UNKNOWN) based on findings, policies, and waivers.
- **Code & Test Evidence:** `src/core/policy.ts`, `src/core/readiness.ts`, `packages/cloud-core/src/decision-engine.ts`, `tests/unit/cloud-core/decision-engine.test.ts`.

### W07 — Evidence Bundle, Signing, Provenance & Hardware SLSA
- **Status:** `Partial`
- **Remaining:** No signing-key rotation/revocation/trust-store mechanism, no signed-release-certificate UI/API, and no formal Hardware Release Level model exists yet (tracked as roadmap Epic #271); matches the ledger's own note on the unmilestoned Hardware Release Passport slice (#448).
- **Scope:** Cryptographic release packaging (v2 layout), checksum manifests, Ed25519 digital signatures, and offline verification.
- **Code & Test Evidence:** `src/release/evidence.ts`, `src/release/signing.ts`, `src/cli/commands/release.ts`.

### W08 — Release-to-Release Diff & Hardware Change Impact
- **Status:** `Partial`
- **Remaining:** Impact dimensions cover readiness/findings/bom/manufacturing only (not electrical/assembly/test/firmware/supply/cost/mechanical); no worsened/improved per-finding classification beyond added/resolved/unchanged; no explicit merge-base/previous-release/selected-release baseline modes; no hosted web visualization route. Matches the unmilestoned PR-native hardware-change-impact slice (#447).
- **Scope:** Semantic diffing of BOM, CPL, board outline, and findings across releases with wire-level fingerprint stability (ADR-0013).
- **Code & Test Evidence:** `src/core/diff/run.ts`, `src/release/diff.ts`, `packages/cloud-core/src/review-diff.ts`.

### W09 — Variants, Multi-Board & Product Hierarchy
- **Status:** `Partial`
- **Remaining:** No product→board→variant→revision canonical hierarchy exists in packages/db/prisma/schema.prisma (only a flat Board table); no multi-board release manifest, cross-variant diff, fleet BOM-exposure analysis, or cloud navigation for the hierarchy.
- **Scope:** KiCad 10 variant configuration support, multi-board repository models, and DNP component filtering.
- **Code & Test Evidence:** `src/kicad/variants.ts`, `packages/db/prisma/schema.prisma` (`Board`, `BoardBomSnapshot`).

### W10 — Manufacturer Intelligence & Versioned Process Profiles
- **Status:** `Partial`
- **Remaining:** src/vendor/profiles.ts is a static hardcoded array of 9 vendor presets answering only 'what output evidence does vendor X require' — no versioned/immutable profile revisions, source/date/verifier/confidence metadata, freshness alerting, verified-badge workflow, or cross-vendor manufacturability compare.
- **Scope:** Manufacturer capability modeling (JLCPCB, PCBWay, OSH Park), 0–100 vendor readiness scoring, and handoff zip packaging.
- **Code & Test Evidence:** `src/vendor/profiles.ts`, `src/vendor/outputs.ts`, `src/release/handoff.ts`.

### W11 — BOM, Supply Chain & Cost Intelligence
- **Status:** `Partial`
- **Remaining:** Provider rate-limit/circuit-breaker, authorized-distributor-vs-marketplace classification, and cost/quantity-tier/currency snapshot metadata are now closed (see `master-execution-status.json` for detail). Distributor classification is limited to what Nexar's `Seller.isAuthorized` field actually signals — no other provider is implemented. HTTP surface for `findBoardsByMpn` and the new snapshot fields is still deliberately out of scope: no installation-level (cross-repository) API auth context exists yet, a separate access-control decision. Matches open issue #449.
- **Scope:** Component MPN normalization, lifecycle tracking (Active/NRND/EOL), CycloneDX HBOM generation, and provider abstraction (Nexar) with a rate-limited, circuit-broken outbound path and distributor/pricing snapshot metadata.
- **Code & Test Evidence:** `src/bom/identity.ts`, `src/bom/lifecycle.ts`, `src/report/hbom.ts`, `packages/cloud-core/src/supply-watch.ts`, `packages/cloud-core/src/component-intelligence-resilience.ts`, `packages/cloud-core/src/nexar-component-intelligence.ts`, `packages/db/src/board-supply-watch-store.ts`.

### W12 — Firmware ↔ Hardware Contract
- **Status:** `Partial`
- **Remaining:** Zephyr and ESP-IDF adapters (src/firmware/zephyr.ts, esp-idf.ts) are thin wrappers around the generic YAML contract loader, not real DeviceTree/ESP-IDF-format parsers as specified; no firmware commit-SHA/artifact-identity binding to a hardware release; no MCU-specific voltage-domain plugin boundary.
- **Scope:** Cross-domain pin mapping validation against PlatformIO and generic YAML firmware contracts.
- **Code & Test Evidence:** `src/firmware/contract.ts`, `src/pinmap/loader.ts`, `src/rules/pinmap/`.

### W13 — Mechanical ↔ PCB Contract
- **Status:** `Partial`
- **Remaining:** Existing matrix claim requires code, test, documentation, deployment, commit or pull-request, and passing verification reconciliation.
- **Scope:** STEP model export from KiCad CLI, basic [REDACTED] hole/board outline consistency checks. Full MCAD bounding box contract planned.
- **Code & Test Evidence:** `src/release/generate.ts` (STEP recipe).

### W14 — Policy, Waivers & Approval Governance
- **Status:** `Partial`
- **Remaining:** No waiver carry-forward-by-fingerprint-equivalence workflow, no separation-of-duties enforcement, and no emergency-release/post-release-review workflow were found, though fail-closed expiry, org-hierarchy policy inheritance with dry-run impact preview, and digest-change approval invalidation are all real and tested.
- **Scope:** Policy-as-code evaluation, `boardreadyops policy --simulate`, time-bounded waiver lifecycle, and expired waiver blocking.
- **Code & Test Evidence:** `src/core/policy.ts`, `src/core/waivers.ts`, `packages/cloud-core/src/policy-engine.ts`.

### W15 — GitHub App & PR Manufacturing Gate
- **Status:** `Partial`
- **Remaining:** No Check-Run annotations array is emitted (only markdown output.summary/text), so annotation limit/pagination/truncation is unverified; no explicit re-run command/API found. HMAC verification, delivery idempotency, fail-closed safeMode, OIDC result binding, and two-installation isolation evidence are all real and tested.
- **Scope:** Native GitHub App integration, Check Run status lifecycle, OIDC-bound runner submission, and sticky PR review comments.
- **Code & Test Evidence:** `apps/web/lib/`, `ADR-0010`, `packages/contracts/src/runner-protocol.ts`.

### W16 — Cloud Control Plane Reliability
- **Status:** `Implemented`
- **Remaining:** None within W16. Issue #222 and Cloud Control Plane Reliability milestone #11 are closed with public-safe backup/restore, load, soak, failure-recovery, and deploy-topology evidence linked from the milestone. Downstream GitHub Cloud GA isolation and App-permission validation remain owned by W15/W17 and milestone v2.2.
- **Scope:** Postgres transactional outbox, durable job scheduling with retry/leasing/dead-letter semantics, and disaster restore drills.
- **Code & Test Evidence:** `packages/db/`, `packages/cloud-core/src/lifecycle.ts`, `scripts/control-plane-restore-drill.mjs`.

### W17 — Authentication, Tenant Isolation, RBAC & API Tokens
- **Status:** `Partial`
- **Remaining:** No granular RBAC role model exists — session auth grants a hardcoded full scope set to every authenticated user; no session revocation/device-management UI or store; no auth-attempt-specific rate limiting; no end-user docs for the bro_live_ API token feature.
- **Scope:** Secure session auth with HMAC-signed cookies, tenant-isolated Prisma queries, and scoped API tokens for runners/CLI.
- **Code & Test Evidence:** `apps/web/lib/api-auth.ts`, `packages/db/src/api-token-store.ts`, `packages/cloud-core/src/entitlements.ts`.

### W18 — Artifact Storage, Access, Retention & Privacy
- **Status:** `Partial`
- **Remaining:** Only the local-filesystem storage driver is wired (S3/GCS/Azure Blob return HTTP 501, per the driver's own docs); no malware/archive-bomb scanning; region/residency routing (kms-adapter.ts getTenantDataRegion) is an unused stub; age-based retention purge is previewed but not activated, matching open issue #44.
- **Scope:** Pluggable storage abstraction, role-based artifact metadata tracking, and automatic retention cleanup workers.
- **Code & Test Evidence:** `packages/cloud-core/src/storage.ts`, `apps/web/lib/retention-maintenance-worker.ts`.

### W19 — Billing, Entitlements & Metering
- **Status:** `Partial`
- **Remaining:** Subscription/customer/price→entitlement projection and trial/grace-period downgrade logic are now implemented and unit-tested (`billing-store.ts`: `linkStripeCustomer`, `applyStripeSubscriptionEvent` guarded against out-of-order/redelivered events via a new `last_event_created_at` column, `clearGraceOnPaymentSuccess`; reuses the pre-existing `applyGraceOnPaymentFailure` and the pre-existing `recordEvent` idempotency). Price→tier mapping reuses the pre-existing `STRIPE_*_PRICE_ID` env-driven table — those price ids are illustrative and must be confirmed against the real Stripe dashboard before production use. Still open: (1) `/api/v1/billing/checkout` stays guarded HTTP 410 `marketplace_free_only`, so `checkout.session.completed` — the only event linking a Stripe customer id to a tenant — never fires in production today; the new code is real but dormant until that guard is lifted. (2) Coverage is unit-level only (mocked DB/executor); no live-Postgres integration test exists for the Stripe path, unlike the Marketplace path's `tests/integration/marketplace-billing-postgres.test.ts`. (3) A tier change does not itself call `entitlement-store.ts`'s `applyWatchAllowance`, mirroring the pre-existing Marketplace path's behavior.
- **Scope:** Tiered plan entitlements (Free / Team / Business / Enterprise), Stripe signature verification, and marketplace billing models.
- **Code & Test Evidence:** `ADR-0014`, `packages/cloud-core/src/stripe-service.ts`, `packages/db/src/billing-store.ts`, `packages/db/migrations/0060_stripe_subscription_event_ordering.sql`, `apps/web/app/api/v1/billing/webhook/route.ts`.

### W20 — Release Command Center & Cloud UX
- **Status:** `Partial`
- **Remaining:** No per-domain score cards (Design/DFM/DFA/DFT/BOM/Supply/Firmware/Manufacturer/Policy) were found — findings appear as a flat/tabbed list; no 'Open in KiCad' deep link (only GitHub Actions deep links).
- **Scope:** Dedicated web application (`apps/web`) with full route suite for runs, repositories, reviews, settings, and real-time live refresh.
- **Code & Test Evidence:** `apps/web/app/runs/`, `apps/web/app/reviews/`, `apps/web/app/settings/`, `tests/e2e/qa-audit.spec.ts`.

### W21 — PCB/Schematic/Gerber/3D Viewers & Visual Diff
- **Status:** `Partial`
- **Remaining:** No true 3D viewer implementation exists (3d_render is a schema enum value only, no renderer); no dedicated Gerber-layer-stack/drill-overlay parser (the view is generated from parsed .kicad_pcb data, not exported Gerbers); no large-board performance/LOD test; no dedicated documentation page.
- **Scope:** Interactive HTML fabrication reports with findings overlay, Playwright visual snapshot regression baselines, and web components.
- **Code & Test Evidence:** `src/report/html.ts`, `tests/e2e/visual.spec.ts`, `apps/web/components/`.

### W22 — Enterprise Trust: SSO, SCIM, Customer-Hosted Agent
- **Status:** `Partial`
- **Remaining:** SSO (OIDC/SAML), SCIM provisioning, customer-managed keys, and SIEM export are all in-memory stub adapters with no wired API routes, honestly labeled 'Proposed / Blueprint (planned upon enterprise customer commitment)' in ADR-0015. Only the customer-hosted execution agent (enrollment/lease/heartbeat/revocation) is production-grade.
- **Scope:** Enterprise governance architecture (ADR-0015), customer-hosted execution agent protocol, and KMS residency isolation.
- **Code & Test Evidence:** `ADR-0015`, `packages/contracts/src/runner-protocol.ts`, `packages/db/src/runner-registration-enrollment-store.ts`.

### W23 — Integrations: GitLab, Azure DevOps, Jira, Slack/Teams
- **Status:** `Partial`
- **Remaining:** Only Slack/Teams webhook notifications exist. GitLab, Azure DevOps, Jira, PLM, and ERP adapters, an integration-SDK capability manifest, encrypted credential storage/rotation, per-integration audit trail, and retry/idempotency semantics are all absent — repo-wide search found zero matches for gitlab/azure-devops/jira in code.
- **Scope:** Generic notification adapters (Slack/Discord/Webhook) and external review collaboration contracts.
- **Code & Test Evidence:** `src/notifiers/`, `packages/contracts/src/external-review.ts`.

### W24 — Manufacturer / CM Handoff Portal, RFQ & Questions
- **Status:** `Partial`
- **Remaining:** No external manufacturer/CM web portal exists — no time-bound access token, CM accept/issue-found/clarification state, question threads, or RFQ/vendor-quote metadata. boardreadyops release handoff is a real local CLI command producing a signed vendor-profile zip, not a collaboration portal.
- **Scope:** Clean zip handoff generation with manufacturer notes, signed manifest verification, and external reviewer tokens.
- **Code & Test Evidence:** `src/release/handoff.ts`, `packages/contracts/src/external-review.ts`.

### W25 — Production Runs, Traceability, Yield & Outcomes
- **Status:** `Partial`
- **Remaining:** Entirely unimplemented: no production-run entity, no built/pass/fail/rework/scrap outcome counts, no failure taxonomy, no yield calculation, no CM-vs-internal access split. ReleaseRun/ReleaseRunAttempt in the Prisma schema are CI/CD check-run models, not physical production runs. Matches open issues #450 and #451.
- **Scope:** Production outcome ledger models and WDRR metrics calculation. Correlation engine expands as factory data arrives.
- **Code & Test Evidence:** `packages/contracts/src/evidence-ledger.ts`, `packages/cloud-core/src/wdrr-metrics.ts`.

### W26 — AI Reviewer & Agent Remediation Layer
- **Status:** `Partial`
- **Remaining:** No real model integration exists yet — NoOpAiAssistant is a hardcoded deterministic stub, off by default. No explain/prioritize/propose-fix action taxonomy, prompt-injection defense, tool allowlist/sandbox, agent audit log, or human-approval workflow for design-intent edits, beyond the single AI_ASSIST_ENABLED kill switch. boardreadyops plan itself (safeAutoFixPossible, commandsToVerify) is real. Matches open issue #52.
- **Scope:** Deterministic `boardreadyops plan` CLI remediation output, prompt-injection protected assistant adapters, and human-in-the-loop gates.
- **Code & Test Evidence:** `schemas/agent-plan.schema.json`, `src/cli/commands/plan.ts`, `packages/cloud-core/src/assist/ai-assistant.ts`.

### W27 — MCP / Agent API / Plugin SDK
- **Status:** `Partial`
- **Remaining:** No actual MCP server implementation exists (no @modelcontextprotocol/sdk dependency anywhere) — docs/integrations/boardreadyops-mcp.md only documents a proposed tool contract. The Plugin SDK half is genuinely strong (real capability manifest, pre-import permission checks, honest ADR-0009 rejecting a false node:vm sandbox claim).
- **Scope:** Extensible Plugin SDK for custom rules and adapters, sandboxing architecture (ADR-0009), and reference plugins.
- **Code & Test Evidence:** `packages/plugin-sdk/`, `ADR-0009`, `examples/plugin-dfm-custom/`.

### W28 — Security, Privacy, Threat Modeling & Trust Center
- **Status:** `Partial`
- **Remaining:** Existing matrix claim requires code, test, documentation, deployment, commit or pull-request, and passing verification reconciliation.
- **Scope:** Published Security and Privacy charters, secret encryption at rest, target-repository isolation validation, and rate-limiting.
- **Code & Test Evidence:** `SECURITY.md`, `PRIVACY.md`, `packages/cloud-core/src/credential-encryption.ts`.

### W29 — Observability, SLOs & Operations
- **Status:** `Partial`
- **Remaining:** No distributed tracing implementation exists (no OpenTelemetry dependency; the broader webhook→job→dispatch→ingestion→decision trace propagation is unbuilt — only the webhook→release_run edge is traceable via `release_runs.delivery_id`). The dead-letter admin dashboard UI gap is closed (`apps/web/app/ops/dead-letters/`) and correlation-id threading is closed for the webhook→release-run path (DB-only, migration 0058) — distributed tracing is the only gap left open.
- **Scope:** Structured logging with correlation IDs, control-plane SLO tracking, Sentry integration, automated health checks, and an operator dashboard for dead-lettered jobs.
- **Code & Test Evidence:** `src/core/logger.ts`, `tests/unit/web/control-plane-slo.test.ts`, `apps/web/app/ops/dead-letters/`, `tests/unit/web/dead-letters-page.test.ts`.

### W30 — Performance, Scalability & Cost Controls
- **Status:** `Partial`
- **Remaining:** No per-tenant quotas beyond webhook rate limiting, no viewer payload/LOD sizing, no explicit cost-attribution tags/counters, and no documented cloud run list/query pagination benchmark, though real p50/p95/p99 load benchmarking with numeric broker-migration trigger thresholds exists and runs in CI.
- **Scope:** Performance benchmarking corpus, bundle size enforcement in CI, and scale envelope validation.
- **Code & Test Evidence:** `tests/benchmark/`, `scripts/check-bundle-sizes.mjs`, `scripts/control-plane-scale-envelope.mjs`.

### W31 — Documentation, Onboarding, Golden Demo & DevEx
- **Status:** `Partial`
- **Remaining:** Both previously flagged gaps are now closed: `tests/unit/examples/golden-demo.test.ts` gained an end-to-end test that runs the documented two-command walkthrough (`boardreadyops run examples/golden-demo/broken` then `.../fixed`) through the real CLI entrypoint and asserts wall-clock duration stays under the documented `<2 minute` target (120s budget, deliberate CI slack over a raw stopwatch assert, following the existing pattern in `tests/integration/scale-envelope.test.ts`). `docs/reference/exit-codes.md` is a new dedicated reference, cross-checked against the CLI and core source, documenting every real exit code (0-4) and the five finding severities. This closes the specific golden-demo timing and error-code documentation gaps; it is not a full re-audit of the rest of this workstream's broader onboarding/DevEx scope.
- **Scope:** Comprehensive MkDocs documentation suite, `<2 min` golden demo walkthrough, and bad-board zoo fixture corpus.
- **Code & Test Evidence:** `docs/`, `docs/golden-demo.md`, `docs/reference/exit-codes.md`, `tests/fixtures/bad-board-zoo/`.

### W32 — Product Analytics & Privacy-Safe Adoption Metrics
- **Status:** `Partial`
- **Remaining:** No source code anywhere in src/, apps/, or packages/ emits or consumes telemetry events, and no test validates the schema — this is a schema-and-plan artifact; the doc itself frames most validation gates as 'External Validation Required.'
- **Scope:** Strictly privacy-safe telemetry event schema without source exfiltration, and webhook activation metrics.
- **Code & Test Evidence:** `schemas/telemetry-event.schema.json`, `apps/web/lib/webhook-intake-telemetry.ts`.

### W33 — Compliance & Audit Export
- **Status:** `Partial`
- **Remaining:** The audit export endpoint emits JSON only (no CSV/PDF/JSONL), and there is no watermark or tamper-evidence hash on exported evidence, though authorization enforcement, legal-hold blocking of erasure/cancellation, and CycloneDX 1.7 HBOM generation are all real, tested, and schema-validated.
- **Scope:** Tamper-evident audit logging, Hardware BOM (HBOM) export, and cryptographically signed release certificates.
- **Code & Test Evidence:** `packages/db/src/audit-log-store.ts`, `src/report/hbom.ts`.

### W34 — Quality Engineering: Fuzz, Mutation, Bad-Board Zoo
- **Status:** `Partial`
- **Remaining:** Only two fast-check property-test files exist, scoped to findings/config/report formatting, not dedicated BOM/CSV/YAML/JSON/KiCad-text parser fuzzing or state-machine/waiver-combinatorial property tests; no licensing-aware record/replay network cassette system, though mutation testing has real per-module thresholds enforced in CI and the flaky-test policy explicitly rejects silent quarantine.
- **Scope:** Property-based testing with `fast-check`, snapshot tests, Stryker mutation testing, and automated E2E QA crawler.
- **Code & Test Evidence:** `tests/property/`, `tests/snapshot/`, `tests/e2e/qa-audit.spec.ts`.

### W35 — Marketplace, Ecosystem & Distribution
- **Status:** `Partial`
- **Remaining:** verify-release-channels.mjs genuinely cross-checks npm/GitHub-Release/Homebrew/container digest identity in CI, but the public GitHub Marketplace listing itself remains gated on open issue #88 (least-privilege GitHub App permissions) before it can be considered a fully shipped, unblocked capability.
- **Scope:** Automated GitHub Action bundling, Homebrew formula distribution, committed bundle verification, and Marketplace metadata validation.
- **Code & Test Evidence:** `dist/`, `Formula/`, `scripts/check-marketplace-listing.mjs`.

### W36 — Manufacturing Feedback Intelligence & Predictive Risk
- **Status:** `Deferred / Moat`
- **Defer Trigger:** Production outcome dataset reaches a documented statistically useful threshold.
- **Scope:** Machine-learning-based yield prediction triggered only when verified outcome datasets meet quality thresholds.
- **Constraint:** Advisory only; will never override deterministic release gates.

---

## 4. Engineering Verification Protocol

Before declaring any release or milestone complete, verify against the full repository verification gate:

```bash
task verify
```

Or via direct package scripts:
```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run knip
corepack pnpm run compatibility:check
corepack pnpm run build
corepack pnpm run verify:dist
corepack pnpm run verify:version
corepack pnpm run verify:marketplace
corepack pnpm run test:unit
corepack pnpm run test:property
corepack pnpm run test:snapshot
corepack pnpm run test:action
corepack pnpm run test:a11y
corepack pnpm run coverage
corepack pnpm run verify:structure
corepack pnpm run gc
corepack pnpm run docs
corepack pnpm run security
```
