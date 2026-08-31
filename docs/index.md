# BoardReadyOps

> **The trust layer between KiCad commits and manufacturing release.**

BoardReadyOps is a local-first, policy-as-code hardware review gate for teams designing PCBs with KiCad and GitHub. It explains what changed in every pull request, why it matters for fabrication, and binds every manufacturing release to auditable, cryptographically verifiable evidence.

---

## What BoardReadyOps Does (and Doesn't) Do

- **Does NOT replace KiCad DRC/ERC**: BoardReadyOps incorporates native `kicad-cli` DRC/ERC outputs and adds higher-order design preflight, BOM lifecycle intelligence, footprint verification, and pin contract checks.
- **Does NOT have to replace KiBot**: Works standalone or alongside KiBot/artifact automation tools. BoardReadyOps focuses on policy-as-code enforcement, exact PR change impact, explainable release risk, time-bounded waivers, signed evidence bundles, and manufacturer handoff packages.
- **Zero-Trust & Local-First**: Private designs, source files, and proprietary schematics remain in your local workspace or GitHub runner. No source code is uploaded to external clouds.

---

## 4 Ways to Get Started

| Path | Description | Typical Use Case |
| :--- | :--- | :--- |
| **[Local First Check](quickstart.md#path-a-local-first-check)** | Run `boardreadyops check . --fail-on never` locally. | Desktop engineers validating before git commit. |
| **[GitHub PR Gate](quickstart.md#path-b-github-pr-gate)** | Add GitHub Action with sticky review comments & SARIF. | Engineering teams enforcing review policies on PRs. |
| **[Manufacturer Handoff](quickstart.md#path-c-manufacturer-handoff)** | Generate JLCPCB / PCBWay / OSH Park zip packages. | Releasing production gerbers & BOM to fab houses. |
| **[Private / Air-Gapped](quickstart.md#path-d-private-local-only-execution)** | Run with `--safe-mode` offline. | High-security, defense, or on-premise hardware teams. |

---

## Core Capabilities

1. **Hardware Change Impact**: Deterministically analyzes what changed between the PR base SHA and head SHA across readiness, findings, BOM items, and manufacturing outputs.
2. **Policy as Code & Governance**: Define release gates per environment (`prototype`, `pilot`, `production`) with enforceable severity thresholds and audit logs.
3. **Time-Bounded Waivers**: Temporary risk acceptance with mandatory owners, rationale, and expiration dates. Expired waivers automatically block releases.
4. **Signed Evidence Bundles**: Generate Ed25519-signed release manifests tying every Gerber, drill, BOM, and schematic revision to an immutable release decision.
5. **Manufacturer Profiles**: Preconfigured rules and handoff templates for JLCPCB, PCBWay, and OSH Park.

---

## Documentation Navigation

- **Getting Started**: [Quickstart](quickstart.md) · [Installation](install.md) · [Golden Demo](golden-demo.md)
- **Execution Surfaces**: [CLI Reference](cli.md) · [GitHub Action](action.md) · [Agent Planning Output](agent-planning.md)
- **Configuration & Rules**: [Configuration Guide](configuration.md) · [Rule Catalog](rules/index.md) · [Vendor Profiles](vendor-profiles.md)
- **Reports & Artifacts**: [Reports Matrix](reports/json.md) · [Hardware SBOM](sbom.md) · [Release Bundles](release/evidence-bundles.md)
- **Architecture & Policies**: [Architecture Overview](architecture/overview.md) · [Security Policy](https://github.com/oaslananka/boardreadyops/blob/main/SECURITY.md) · [ADRs](architecture/adr/0001-single-repo-no-mirror.md)
