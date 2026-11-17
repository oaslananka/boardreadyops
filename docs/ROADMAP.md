# BoardReadyOps Roadmap

BoardReadyOps is **Hardware Release Authority**: the trust layer between hardware engineering and physical production.

This file is intentionally a concise public summary. It is **not** a third roadmap authority.

## Roadmap authorities

- [#758 — Product strategy and sequencing](https://github.com/oaslananka/boardreadyops/issues/758) is the canonical product roadmap.
- [#191 — Platform and delivery dependencies](https://github.com/oaslananka/boardreadyops/issues/191) is the canonical repository, cloud, GitHub App, execution, security, and delivery roadmap.
- [BoardReadyOps — Public Roadmap](https://github.com/users/oaslananka/projects/21) shows current execution.
- Historical milestones and shipped versions belong in [Releases](https://github.com/oaslananka/boardreadyops/releases), not in a competing roadmap narrative.

When this summary and either authority disagree, the issue authority wins.

## Product lifecycle

The product is organized around one release-to-production lifecycle:

```text
Design Source
→ Change Impact
→ Native ERC / DRC
→ Policy
→ Fabrication Artifact Verification
→ Release Passport
→ Approval / Waiver
→ Manufacturer Handoff
→ As-Built Record
→ Production Outcome
→ Continuous Supply / Security Watch
→ Audit / Field Traceability
```

The north-star measure is **verified production releases under active BoardReadyOps policy**.

## Current product sequence

These are **product sequence** groupings, not engineering execution phases. The numeric **Phase 0–8** model remains canonical only in [master-execution-status.md](development/master-execution-status.md); implementation work keeps its numeric phase/workstream assignment there.

### Product sequence 1 — Release trust

Goal: provide reliable evidence for an explicit, human-controlled manufacturing release decision; automated checks alone do not authorize fabrication.

- [#753](https://github.com/oaslananka/boardreadyops/issues/753) — fabrication artifact parsing, mask/paste and measured board-edge clearance implementation is complete; live customer source-to-export acceptance is tracked separately.
- [#770](https://github.com/oaslananka/boardreadyops/issues/770) — paste/stencil, mask and board-edge manufacturing closure. **Complete.**
- [#771](https://github.com/oaslananka/boardreadyops/issues/771) — source-to-export attestation implementation tracking **closed**; independent customer-run and signed-handoff acceptance remains open under [#1197](https://github.com/oaslananka/boardreadyops/issues/1197), [#154](https://github.com/oaslananka/boardreadyops/issues/154), and [#1161](https://github.com/oaslananka/boardreadyops/issues/1161).

Exit condition: exact parsed evidence may block, heuristic evidence warns by default, and retained release evidence can be tied to the approved source revision.

### Product sequence 2 — Continuous product assurance

Goal: identify production impact even when no Git commit changes.

- [#449](https://github.com/oaslananka/boardreadyops/issues/449) — continuous supplier monitoring and affected-product/release impact. **Complete.**
- [#755](https://github.com/oaslananka/boardreadyops/issues/755) — shipped-board security/CVE impact. **Complete.**

Exit condition: BoardReadyOps can re-evaluate tracked releases from external supply/security changes with explicit evidence quality and affected-release mapping.

### Product sequence 3 — Manufacturing truth

Goal: connect what was approved to what was actually manufactured.

- [#448](https://github.com/oaslananka/boardreadyops/issues/448) — verifiable Hardware Release Passport v1. **Complete.**
- [#450](https://github.com/oaslananka/boardreadyops/issues/450) — release-linked production outcome ingestion pilot. **Complete.**
- [#756](https://github.com/oaslananka/boardreadyops/issues/756) — approved-versus-as-built reconciliation implementation **complete**; independent real-production acceptance remains a separate task.
- [#447](https://github.com/oaslananka/boardreadyops/issues/447) — PR-native hardware change-impact implementation tracking **closed**; real customer-facing Review completion remains open under [#1161](https://github.com/oaslananka/boardreadyops/issues/1161).

Exit condition: an approved release can be linked to manufacturer handoff, batch/as-built data, substitutions, and production outcomes without requiring a deep MES integration.

### Product sequence 4 — Evidence, compliance, and enterprise trust

Goal: project the release record into the governance and evidence views customers already need.

- [#757](https://github.com/oaslananka/boardreadyops/issues/757) — clause-oriented audit evidence projection.
- [#45](https://github.com/oaslananka/boardreadyops/issues/45) — organization policy inheritance and repository overrides.
- [#41](https://github.com/oaslananka/boardreadyops/issues/41) — customer-hosted execution hardening.
- [#451](https://github.com/oaslananka/boardreadyops/issues/451) — release-to-production Evidence Graph foundation **complete**.

These remain downstream of release trust and manufacturing truth unless a live production security or correctness blocker requires an earlier bounded change.

## Current delivery dependencies

Product sequencing above is constrained by the platform roadmap in [#191](https://github.com/oaslananka/boardreadyops/issues/191).

### GitHub Cloud GA

- [#149](https://github.com/oaslananka/boardreadyops/issues/149) — operationalize target-repository GitHub Actions execution.
- [#42](https://github.com/oaslananka/boardreadyops/issues/42) — private-repository and fork safe-execution policy.
- [#154](https://github.com/oaslananka/boardreadyops/issues/154) — validate isolation across two installations.

These remain blocked until the required real-environment acceptance evidence is available.

### Dashboard, evidence, and lifecycle controls

- [#25](https://github.com/oaslananka/boardreadyops/issues/25) — hosted run dashboard; implementation is substantially complete but final acceptance depends on the GitHub GA isolation boundary.
- [#44](https://github.com/oaslananka/boardreadyops/issues/44) — metadata/artifact retention, deletion, privacy, and lifecycle controls.

### Enterprise execution and governance

Enterprise execution and governance items are summarized once in **Product sequence 4** above; their delivery dependencies and sequencing remain canonical in [#191](https://github.com/oaslananka/boardreadyops/issues/191).

## Architecture discipline

The roadmap does not imply a default move to a shared BoardReadyOps worker fleet, Kubernetes, an external broker, a workflow engine, a language rewrite, or cell-based tenant isolation.

Those changes require measured operational or contractual triggers. The current architecture keeps the control plane responsible for orchestration and state while customer-source execution remains in reviewed target-repository workflows or outbound customer-hosted agents.

## Priority discipline

- **P0** — release blocker, trust/correctness failure, source/artifact integrity risk, false-PASS risk, critical shared foundation, or production security/compliance blocker.
- **P1** — high-value product/commercial differentiation or major production capability.
- **P2** — important expansion after core foundations.
- **P3** — maintenance, polish, or intentionally deferred work.

The next proof is not “more features.” It is a trustworthy release authority used on real hardware releases, followed by continuous impact, as-built traceability, production outcomes, and evidence/compliance workflows.

Current external acceptance remains tracked in [#1161](https://github.com/oaslananka/boardreadyops/issues/1161) (end-to-end user journey), [#154](https://github.com/oaslananka/boardreadyops/issues/154) (cross-installation execution isolation), and [#1197](https://github.com/oaslananka/boardreadyops/issues/1197) (customer-run signed artifact verification). Closed source-tracking issues do not constitute independent fabrication approval.

## Contributing

- Discuss scope on the relevant roadmap or implementation issue.
- Use an RFC for significant architecture or product decisions.
- Do not create a parallel roadmap document; update [#758](https://github.com/oaslananka/boardreadyops/issues/758), [#191](https://github.com/oaslananka/boardreadyops/issues/191), or this concise summary as appropriate.
- Follow the [Contributing guide](../CONTRIBUTING.md) for implementation workflow.
