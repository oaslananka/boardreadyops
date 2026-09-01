# Quickstart Guide

Get from zero to your first release-readiness preflight in under 10 minutes.

BoardReadyOps is the **trust layer between KiCad commits and manufacturing release**. It validates design readiness, checks BOM risk, models PR hardware change impact, enforces policy-as-code, and generates verifiable manufacturer evidence packages.

---

## 1. Prerequisites

- **Node.js**: `^22.14.0 || ^24.0.0` (Node 24 LTS recommended). Verify with `node --version`.
- **KiCad (Optional for DRC/ERC preflight)**: KiCad 9 or KiCad 10 with `kicad-cli` available on PATH. Core design, BOM, pinmap, and release evidence checks run without KiCad installed.

---

## 2. Safe Installation

Install globally via npm:

```bash
npm i -g boardreadyops
```

Or verify and install using the official platform installer scripts with automated SHA-256 checksum verification:

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.ps1 | iex
```

### Manual Checksum Verification
To download standalone binaries manually without running scripts directly:
1. Download the platform binary and `SHA256SUMS` from the [Latest GitHub Release](https://github.com/oaslananka/boardreadyops/releases/latest).
2. Verify integrity:
   ```bash
   sha256sum --check SHA256SUMS --ignore-missing
   ```

---

## 3. Verify Environment with Doctor

Before scanning your project, verify that the runtime and toolchain are ready:

```bash
boardreadyops doctor
```

`doctor` tests Node runtime compatibility, platform capabilities, KiCad CLI availability, and configured vendor profiles.

---

## 4. Four Core Onboarding Paths

### Path A: Local First Check
Run a non-blocking scan on your KiCad project directory to discover findings without failing your shell:

```bash
cd /path/to/kicad/project
boardreadyops init
boardreadyops check . --fail-on never
```

Reports are emitted to `build/`:
- `build/boardreadyops.findings.json` (Structured machine-readable findings)
- `build/boardreadyops.report.md` (Human-readable Markdown summary)
- `build/boardreadyops.sarif.json` (OASIS SARIF v2.1.0 for IDE / Code Scanning)
- `build/boardreadyops.html` (Interactive release dashboard)

### Path B: GitHub PR Gate
Add BoardReadyOps to your repository workflow at `.github/workflows/boardreadyops.yml`:

```yaml
name: BoardReadyOps PR Gate

on:
  pull_request:
  push:
    branches: [main]

jobs:
  preflight:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: oaslananka/boardreadyops@9bc8a075d885ad1182e2ad4fcd4c9160f8160c94 # v1.31.2
        with:
          config: boardreadyops.yml
          mode: enforce
          fail-on: high
          comment-pr: "true"
          comment-format: review
```

### Path C: Manufacturer Handoff
Generate first-party manufacturing outputs and create an audited vendor-specific handoff bundle (e.g. for JLCPCB, PCBWay, or OSH Park):

```bash
# Generate Gerbers, drill, BOM, and CPL positions via kicad-cli
boardreadyops generate . --profile jlcpcb --output build/boardreadyops-generate

# Package and verify the vendor-specific handoff zip archive
boardreadyops handoff create build/boardreadyops-generate --profile jlcpcb
```

### Path D: Private / Local-Only Execution
For air-gapped or confidential hardware repositories where IP must stay strictly on-premise:

```bash
# Safe mode disables network dispatch, remote notifiers, and untrusted plugin loads
boardreadyops check . --safe-mode --fail-on high
```

---

## 5. Interpreting Findings: Fix vs. Suppression vs. Waiver

When BoardReadyOps reports an issue, you have three distinct actions:

1. **Fix the Root Cause**:
   - Edit the schematic (e.g., add missing MPN, fix duplicate reference designator `R1`).
   - Edit the PCB layout (e.g., close open `Edge.Cuts` boundary).
   - Re-run `boardreadyops check .` to verify clean status.

2. **Inline / Config Suppression (Design Intent)**:
   - For intentional design choices (e.g., a test pad intentionally outside the normal mask), add a suppression in `boardreadyops.yml`:
     ```yaml
     suppressions:
       - rule: silkscreen.over-pad
         path: "pcb/board.kicad_pcb"
         reason: "TP1 is an internal debug test point with exposed copper"
     ```

3. **Time-Bounded Waiver (Governance & Approvals)**:
   - When a temporary risk is accepted for a specific prototype or pilot build:
     ```yaml
     waivers:
       - rule: bom.lifecycle
         owner: "lead-engineer@company.com"
         reason: "NRND part acceptable for prototype run; redesign scheduled for rev B"
         expires: "2026-12-31"
     ```
   - *Note: Expired waivers automatically block production release gates.*

---

## 6. Golden Demo Run

Want to test BoardReadyOps on verified broken and clean hardware designs?

```bash
# Test broken fixture (exits with code 1, highlights 4 release blockers)
boardreadyops run examples/golden-demo/broken

# Test repaired fixture (exits with code 0, 100% release ready)
boardreadyops run examples/golden-demo/fixed
```

---

## 7. Updates, Rollback & Uninstall

### Updating
```bash
npm i -g boardreadyops@latest
```

### Rolling Back to a Specific Version
```bash
npm i -g boardreadyops@1.37.0
```

### Uninstalling
```bash
# npm installation:
npm rm -g boardreadyops

# Script installation:
rm -f /usr/local/bin/boardreadyops
```
