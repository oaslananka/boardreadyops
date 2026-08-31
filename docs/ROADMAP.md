# BoardReadyOps v2 Roadmap

> Current execution: [BoardReadyOps — Public Roadmap](https://github.com/users/oaslananka/projects/21) · Sequencing: [#191](https://github.com/oaslananka/boardreadyops/issues/191)

## Vision

Evolve BoardReadyOps from a KiCad release-readiness gate into an end-to-end hardware release operating system.

The target workflow is:

```
Generate → Validate → Decide → Package → Attest → Review → Handoff
```

BoardReadyOps should turn a KiCad project into a verified, signed, manufacturer-ready release package — running locally or in CI, producing auditable evidence, and blocking unsafe releases before boards are ordered.

---

## Milestones

### v1.6.0 — Artifact Generation MVP ✅

First-party artifact generation engine so BoardReadyOps can produce common KiCad manufacturing and documentation outputs.

| Issue | Title | Status |
|---|---|---|
| [#279](https://github.com/oaslananka/boardreadyops/issues/279) | `boardreadyops generate` CLI command | ✅ Done |
| [#280](https://github.com/oaslananka/boardreadyops/issues/280) | KiCad CLI backend detection and diagnostics | ✅ Done |
| [#281](https://github.com/oaslananka/boardreadyops/issues/281) | Generate Gerber, drill, BOM and CPL outputs | ✅ Done |
| [#282](https://github.com/oaslananka/boardreadyops/issues/282) | Add PDF, SVG and STEP documentation outputs | ✅ Done |
| [#283](https://github.com/oaslananka/boardreadyops/issues/283) | Add generation output recipe schema | ✅ Done |
| [#284](https://github.com/oaslananka/boardreadyops/issues/284) | Add KiCad artifact generation fixtures | ✅ Done |
| [#308](https://github.com/oaslananka/boardreadyops/issues/308) | Add BoardReadyOps v2 roadmap document | ✅ Done |
| [#309](https://github.com/oaslananka/boardreadyops/issues/309) | Add professional issue and PR templates | ✅ Done |
| [#310](https://github.com/oaslananka/boardreadyops/issues/310) | Add version consistency guard | ✅ Done |
| [#311](https://github.com/oaslananka/boardreadyops/issues/311) | Update README for hardware release pipeline positioning | ✅ Done |

### v1.7.0 — Release Prepare Pipeline ✅

One-command release preparation that generates artifacts, validates readiness, packages evidence, and produces a clear release decision.

| Issue | Title | Status |
|---|---|---|
| [#285](https://github.com/oaslananka/boardreadyops/issues/285) | `boardreadyops release prepare` command | ✅ Done |
| [#286](https://github.com/oaslananka/boardreadyops/issues/286) | Emit structured release decision JSON | ✅ Done |
| [#287](https://github.com/oaslananka/boardreadyops/issues/287) | Attach generated artifacts to evidence bundle | ✅ Done |
| [#288](https://github.com/oaslananka/boardreadyops/issues/288) | Create vendor-specific manufacturer handoff zip | ✅ Done |

### v1.8.0 — Visual Review & Vendor Readiness

Upgrade the HTML report into a product-quality release dashboard with vendor readiness scoring and release diff.

| Issue | Title | Status |
|---|---|---|
| [#291](https://github.com/oaslananka/boardreadyops/issues/291) | Build release dashboard v1 | ✅ Done |
| [#292](https://github.com/oaslananka/boardreadyops/issues/292) | Implement vendor readiness score core | ✅ Done |
| [#293](https://github.com/oaslananka/boardreadyops/issues/293) | Add BOM and CPL release diff | ✅ Done |

### v1.9.0 — Policy, Waivers & Provenance

Configurable release governance, formal waiver workflow, and supply-chain-grade provenance.

| Issue | Title | Status |
|---|---|---|
| [#289](https://github.com/oaslananka/boardreadyops/issues/289) | Define Evidence Bundle v2 layout and manifest schema | ✅ Done |
| [#290](https://github.com/oaslananka/boardreadyops/issues/290) | Add offline release bundle verification command | ✅ Done |
| [#294](https://github.com/oaslananka/boardreadyops/issues/294) | Add release policy schema and evaluator | ✅ Done |
| [#295](https://github.com/oaslananka/boardreadyops/issues/295) | Add `boardreadyops policy simulate` command | ✅ Done |
| [#296](https://github.com/oaslananka/boardreadyops/issues/296) | Add waiver schema and expired waiver blocking | ✅ Done |
| [#297](https://github.com/oaslananka/boardreadyops/issues/297) | Add signed release manifest support | ✅ Done |
| [#298](https://github.com/oaslananka/boardreadyops/issues/298) | Design GitHub Artifact Attestation integration | ✅ Done |

### v2.0.0 — Hardware Release OS

Full hardware release operating system: variants, HBOM, expanded DFM/DFA, firmware contracts, cloud dashboard, GitHub App.

| Issue | Title | Status |
|---|---|---|
| [#299](https://github.com/oaslananka/boardreadyops/issues/299) | Add variant config and output path support | ✅ Done |
| [#300](https://github.com/oaslananka/boardreadyops/issues/300) | Emit HBOM JSON from normalized BOM data | ✅ Done |
| [#301](https://github.com/oaslananka/boardreadyops/issues/301) | Define firmware contract adapter interface | ✅ Done |
| [#302](https://github.com/oaslananka/boardreadyops/issues/302) | Add first expanded DFM/DFA rule pack | ✅ Done |
| [#303](https://github.com/oaslananka/boardreadyops/issues/303) | Write GitHub App architecture RFC | ✅ Done |
| [#304](https://github.com/oaslananka/boardreadyops/issues/304) | Write Vercel control-plane architecture ADR | ✅ Done |
| [#305](https://github.com/oaslananka/boardreadyops/issues/305) | Define dashboard data and artifact storage model | ✅ Done |
| [#306](https://github.com/oaslananka/boardreadyops/issues/306) | Create golden demo walkthrough | ✅ Done |
| [#307](https://github.com/oaslananka/boardreadyops/issues/307) | Add bad-board zoo release corpus | ✅ Done |

---

## Workstreams

### 1. KiCad Artifact Generation Engine ([Epic #261](https://github.com/oaslananka/boardreadyops/issues/261))

First-party `kicad-cli` integration that produces Gerber, drill, BOM, CPL, PDF, and STEP outputs from a KiCad project. Replaces the need for KiBot for standard manufacturing workflows.

### 2. One-Command Release Prepare Pipeline ([Epic #262](https://github.com/oaslananka/boardreadyops/issues/262))

`boardreadyops release prepare` orchestrates the full pipeline: discover → generate → validate → decide → package. Produces a structured release decision JSON and evidence bundle in one command.

### 3. Evidence Bundle v2 & Signed Manifests ([Epic #263](https://github.com/oaslananka/boardreadyops/issues/263))

Formal evidence bundle layout with schema version 2, role-based artifact groups, checksums file, and Ed25519 signature support for trusted manufacturing releases.

### 4. Manufacturer Handoff Packages ([Epic #264](https://github.com/oaslananka/boardreadyops/issues/264))

Vendor-specific handoff packages (JLCPCB, PCBWay, OSH Park) that contain only the files required by that manufacturer, with a readable manufacturer note and manifest.

### 5. Vendor Readiness Scoring ([Epic #265](https://github.com/oaslananka/boardreadyops/issues/265))

0–100 readiness score per vendor profile, with required/recommended evidence weighting, score explanations in reports, and policy integration.

### 6. Visual Release Dashboard ([Epic #266](https://github.com/oaslananka/boardreadyops/issues/266))

Product-quality HTML release dashboard with decision overview, score cards, generated artifact list, vendor readiness, findings, waivers, and evidence manifest sections.

### 7. Release-to-Release Diff Engine ([Epic #267](https://github.com/oaslananka/boardreadyops/issues/267))

BOM and CPL diff between two release candidates or evidence bundles. JSON, Markdown, and HTML outputs for PR comments and dashboard sections.

> **Foundation landed:** the per-finding stable identity this diff engine needs (`Finding.fingerprint`) already existed locally (`src/core/diff/run.ts::diffRuns`) but was dropped at the cloud boundary. It now crosses the wire in `findingSchema` and `hardwareImpactV1Schema.evidence` ([ADR-0013](architecture/adr/0013-finding-fingerprint-wire-contract.md)), optional and backward compatible with an already-deployed CLI/Action. Cloud-side consumption (persisting fingerprints, cross-run lookup) is not yet built.

### 8. Variant-Aware Hardware Release ([Epic #268](https://github.com/oaslananka/boardreadyops/issues/268))

Prototype and production variant support across generation, validation, packaging, and release decisions. `--variant` flag and variant-specific output paths.

### 9. Policy Engine & Release Governance ([Epic #269](https://github.com/oaslananka/boardreadyops/issues/269))

Configurable policy layer with severity thresholds, vendor readiness thresholds, waiver-aware decisions, and `boardreadyops policy simulate`.

### 10. Waivers & Approval Workflow ([Epic #270](https://github.com/oaslananka/boardreadyops/issues/270))

Formal waiver schema with owner, reason, expiry, and approval metadata. Expired waivers block production release policy.

### 11. Provenance, Attestations & Hardware SLSA ([Epic #271](https://github.com/oaslananka/boardreadyops/issues/271))

Supply-chain provenance metadata, GitHub Artifact Attestation integration, signed release manifests, and Hardware Release Level model.

### 12. HBOM & BOM Intelligence ([Epic #272](https://github.com/oaslananka/boardreadyops/issues/272))

Structured hardware bill of materials (HBOM) output, MPN normalization, component identity checks, and plugin-ready supplier intelligence hooks.

### 13. Firmware-Hardware Contract Ecosystem ([Epic #273](https://github.com/oaslananka/boardreadyops/issues/273))

Stable adapter interface for multiple firmware ecosystems: PlatformIO, Zephyr, ESP-IDF, STM32CubeMX. Pin, peripheral, and boot/debug connector checks.

### 14. DFM/DFA Rule Corpus Expansion ([Epic #274](https://github.com/oaslananka/boardreadyops/issues/274))

Extended manufacturing and assembly risk rules covering polarity markers, pin-1 markers, silkscreen over pad, and initial test point coverage warnings.

### 15. GitHub App & PR Release Gate ([Epic #275](https://github.com/oaslananka/boardreadyops/issues/275))

Native GitHub App with check run lifecycle, PR comment strategy, and dashboard/evidence links. Complements the existing GitHub Action for zero-config integration.

### 16. Cloud Dashboard & Self-Hosted Control Plane ([Epic #276](https://github.com/oaslananka/boardreadyops/issues/276))

Hosted web dashboard and API on a self-hosted Docker/Compose control plane with GitHub App integration, artifact storage, and execution plane for KiCad-heavy jobs. ADR-0008 proposed Vercel for this role; the project deployed self-hosted instead (see [Self-hosted deployment](deployment/self-hosted.md)).

> **Foundation landed:** `GET /api/v1/runs` is now a real, cursor-paginated, session-authenticated, tenant-scoped listing (`apps/web/lib/run-listing.ts`) rather than the previous hardcoded-empty stub — the first real product API surface beyond the runner protocol and dashboard pages. Bearer-token auth for the CLI (`BOARDREADYOPS_TOKEN`) still needs its own token-issuance design before it can be added. Object storage beyond the local filesystem driver is scoped out for now: it needs a redesign of the runner upload protocol (proxy-through-server today vs. presigned direct-to-storage URLs) that already-deployed runner binaries depend on, which deserves its own design pass rather than a drive-by change.
>
> Plan entitlement tiers were renamed to match the product strategy's Free/Team/Business naming, with a migration that preserves every installation's existing entitlements ([ADR-0014](architecture/adr/0014-seat-based-entitlement-tier-rename.md)). Stripe webhook signature verification exists as a tested primitive (`verifyStripeWebhook` in `@boardreadyops/cloud-core`); the route, event-idempotency store, and entitlement projection it would back are not yet built.

### 17. Golden Demo & Bad-Board Zoo ([Epic #277](https://github.com/oaslananka/boardreadyops/issues/277))

Production-quality demo repo and intentionally broken fixture corpus that demonstrate and regression-test all major BoardReadyOps findings.

---

## Definition of Success

A hardware team can run:

```bash
boardreadyops release prepare . --profile jlcpcb
boardreadyops handoff create build/release --profile jlcpcb
```

And receive:
- A verified, signed evidence bundle capturing artifacts, decisions, and provenance
- A clean manufacturer handoff package ready to upload
- A human-readable dashboard for engineering review
- A machine-readable decision JSON for CI gates

---

## Contributing to the Roadmap

- Comment on the relevant epic issue to discuss scope or propose changes
- Open an RFC issue (use the RFC template) for significant design changes
- Reference the target milestone when opening issues or PRs
- Check the [Contributing guide](https://github.com/oaslananka/boardreadyops/blob/main/CONTRIBUTING.md) for development workflow

See the [BoardReadyOps — Public Roadmap](https://github.com/users/oaslananka/projects/21) for current execution and [#191](https://github.com/oaslananka/boardreadyops/issues/191) for roadmap sequencing.
