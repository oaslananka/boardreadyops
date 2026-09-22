# BoardReadyOps Assurance Hardening Program

## Status

- **Baseline date:** 2026-09-22
- **Baseline commit:** `029d1be5ca82d0ebe212add9f9a0cbe22016c86f`
- **Baseline public release:** `v1.67.0`
- **Document type:** architectural program design
- **Primary objective:** make the product's externally stated trust model equal the trust model enforced by runtime code, data boundaries, release evidence, and repository governance.

## Problem

BoardReadyOps already has unusually broad engineering controls: high coverage thresholds, mutation testing, CodeQL/Semgrep/Gitleaks/OSV/Trivy, SBOM generation, release automation, provenance work, reproducibility checks, rulesets, and extensive documentation. The remaining risk is not a lack of controls. It is **trust-contract drift** between what the system says it guarantees and what the implementation actually binds or enforces.

The 2026-09-22 audit found four recurring classes of drift:

1. **Data-boundary drift:** credentials or upload mode names can imply stronger consent/minimization semantics than the execution path enforces.
2. **Evidence drift:** evidence digests and provenance manifests do not yet bind every input needed to reconstruct a release decision.
3. **Authorization/governance drift:** tenant, token, migration, and review guarantees are not uniformly enforced at the strongest available layer.
4. **Operational/documentation drift:** release, dependency, documentation, roadmap, and capability-state sources can diverge from runtime reality.

The program therefore prioritizes explicit invariants over adding new product breadth.

## Goal

A production BoardReadyOps release decision must be independently reconstructable from the exact source revision, tool build, rule pack, configuration/policy, fabrication artifacts, evidence class, and trusted provenance origin that produced it.

The target trust chain is:

```text
Explicit Cloud Consent
        ↓
Upload Data-Class Enforcement
        ↓
Source Revision + Tool Build
        ↓
Rule Pack + Config/Policy Digest
        ↓
Artifact/Snapshot Digests
        ↓
Exact/Heuristic Evidence Classification
        ↓
Decision
        ↓
Provenance Manifest
        ↓
Signature / Trusted Attestation
        ↓
Independent Verification
```

## Non-goals

- Do not add unrelated product features while hardening these invariants.
- Do not weaken existing CI, security scanning, ruleset, signing, or reproducibility controls to make the program easier to ship.
- Do not turn heuristic manufacturing evidence into exact evidence by terminology alone.
- Do not call in-process plugin execution a security sandbox.
- Do not describe PolyForm Noncommercial code as OSI open source.
- Do not use documentation as the only enforcement mechanism for security-sensitive behavior.

## Global Invariants

### Cloud data boundary

- A credential is authentication material, never feature consent.
- `BOARDREADYOPS_TOKEN` alone must never start a cloud publish.
- Upload classes are explicit: `metadata`, `snapshots`, and `source`.
- `metadata` must not generate or transmit snapshots or raw source.
- `snapshots` must not transmit raw source.
- `source` requires an explicit source-mode selection.
- Server-side ingestion validates declared data class; it does not trust the client label alone.

### Evidence identity

Evidence identity must bind at least:

```text
schemaVersion
toolVersion
toolBuildCommit
rulePackDigest
configDigest
policyDigest
headCommitSha
baseCommitSha
kicadVersion
findingFingerprints[]
artifactDigests[]
snapshotDigests[]
executionMode
uploadMode
```

Changing any decision-relevant field must change the evidence digest.

### Provenance

- Generator and verifier consume the same versioned provenance contract.
- Provenance verification must detect source, artifact, and commit drift.
- Content consistency and origin authenticity are separate claims.
- "Authentic provenance" is used only when signature/attestation is verified against a trust root.

### Gate semantics

- Evidence strength is a first-class gate input.
- Exact evidence may block according to policy.
- Heuristic evidence is warning-only by default.
- Escalating heuristic evidence to blocking requires an explicit user policy override.

### Authorization and tenancy

- Protected routes use centralized authorization wrappers.
- Multi-tenant data isolation is enforced in PostgreSQL with RLS or an equivalent database-level boundary where practical.
- Cross-tenant read/write/list/search attempts are covered by adversarial integration tests.
- API token scope omission never expands privilege.
- Applied migrations are immutable by checksum.

### Governance and release

- Critical security/trust changes require at least one human approval.
- Generated workflows and bootstrap installers prefer immutable release identities.
- Dependency/agent tooling is pinned rather than executed from `latest`.
- Public stable releases have a stabilization/RC path distinct from internal continuous delivery.

## Workstreams

### Workstream A — Cloud, Evidence, and Provenance

Plan: `docs/superpowers/plans/2026-09-22-trust-evidence-and-provenance.md`

Owns cloud consent, upload data classes, evidence identity, tool/rule/config binding, provenance schema unification, commit binding, authenticated provenance, exact-vs-heuristic gating, and trust-facing documentation.

### Workstream B — Security, Tenancy, and Governance

Plan: `docs/superpowers/plans/2026-09-22-security-tenancy-and-governance.md`

Owns migration immutability, schema-version truth, migration no-op prevention, PostgreSQL tenant isolation, centralized route authorization, token least privilege, plugin trust semantics, security capability registry, and mandatory human review for critical paths.

### Workstream C — Supply Chain and Release Discipline

Plan: `docs/superpowers/plans/2026-09-22-supply-chain-and-release-discipline.md`

Owns immutable Action references, release-SHA documentation synchronization, installer bootstrap integrity, MCP/tool pinning, runtime version source-of-truth, CI definition-of-done, NOTICE reproducibility, dependency automation health, binary distribution, and stable release train discipline.

### Workstream D — Verification, Architecture, and Documentation

Plan: `docs/superpowers/plans/2026-09-22-verification-architecture-and-docs.md`

Owns risk-invariant tests, capability reachability, stale constants, real PostgreSQL/KiCad release verification, large-module decomposition, trust-core boundaries, documentation source-of-truth, execution-status generation, roadmap naming, issue/code reconciliation, and feature definition-of-done.

## Sequencing

Execute in this order:

1. **A1–A5:** consent, data classes, evidence identity, provenance contract, exact/heuristic gate.
2. **B1–B5:** migration integrity, schema truth, DB tenancy, centralized auth, token scopes.
3. **C1–C5:** immutable distribution paths and release verification.
4. **D1–D4:** invariant verification and architecture decomposition.
5. **B6/C6/D5+:** governance/documentation/operational cleanup once hard invariants are executable.

Workstreams may overlap only where they do not modify the same trust contract. In particular, do not run provenance schema changes and release-passport contract changes independently without a shared review.

## Program Acceptance Criteria

The program is complete only when all of the following are true:

- Token presence without upload mode produces zero outbound cloud calls.
- Metadata mode produces no snapshot or source payload.
- Evidence identity changes when tool build, rule pack, config, policy, commit, artifact, snapshot, or KiCad version changes.
- `boardreadyops generate` output passes the real artifact-provenance rule without a test-only manifest constructor.
- Source, artifact, and commit tampering each fail provenance verification.
- Authenticity language is backed by signature/attestation verification or narrowed to integrity language.
- Heuristic evidence cannot block by default.
- Applied migration file mutation is detected before application.
- Tenant A credentials cannot read or mutate Tenant B data in adversarial integration tests.
- API tokens require explicit least-privilege scopes.
- Critical trust/security PRs require a human approval.
- Generated GitHub workflows use immutable BoardReadyOps release identity.
- Installer examples do not execute mutable `main` bootstrap code.
- `.mcp.json` contains no `@latest` executable dependency.
- Release verification exercises real PostgreSQL and supported KiCad versions.
- Capability reachability is contract/registry based rather than source-text grep based.
- Canonical documentation data is generated from machine-readable sources.
- Roadmap phases are not presented as product semver.
- Open issue state, release notes, and implementation state are reconciled before declaring a capability complete.
- Public stable releases use explicit stabilization criteria.

## Audit Coverage Matrix

| Audit items | Program owner |
| --- | --- |
| 1–9 | Workstream A |
| 10–21 | Workstream B, with licensing/privacy wording coordinated with D |
| 22–27 | Workstream C |
| 28–32 | Workstream D |
| 33–37 | Workstream C |
| 38–47 | Workstream D |
| 48–50 | Workstreams B/C/D program governance |

No audit item is intentionally dropped. If implementation discovers that an item is already fixed on a later `main`, close it with a regression test and update the relevant plan rather than reimplementing it.

## Rollback Principle

A rollback may remove a new hardening mechanism only if the previous safe behavior is restored. Rollbacks must never:

- silently broaden upload behavior;
- turn failed authorization into allow;
- accept unverifiable provenance as verified;
- remove required CI/security checks;
- reduce tenant isolation;
- replace an immutable supply-chain reference with a floating one.

## Completion Evidence

Each workstream closes with:

1. focused RED/GREEN tests;
2. repository-required validation from `CONTRIBUTING.md`;
3. generated-artifact verification when applicable;
4. a fresh review of the affected trust claims;
5. an implementation PR linked back to its plan;
6. a short post-merge reconciliation of docs/issues/current-state metadata.
