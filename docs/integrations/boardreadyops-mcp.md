# BoardReadyOps MCP Server

BoardReadyOps provides a Model Context Protocol (MCP) tool integration contract designed specifically for coding agents, AI reviewers, and automated hardware release workflows.

**Implementation status:** `packages/mcp-server` (`@boardreadyops/mcp-server`) implements the tools marked `implemented` in the table below — each spawns the real `boardreadyops` CLI and returns its actual output, so results are always identical to running the same command by hand. See the package's [README](https://github.com/oaslananka/boardreadyops/blob/main/packages/mcp-server/README.md#whats-not-here-yet) for why the rest aren't implemented yet — each needs a real design decision, not a drive-by wrapper.

## Design Principles & Safety Model

1. **Deterministic release authority:** AI models never decide whether a hardware design passes or fails production gates. All release decisions originate from deterministic DRC/ERC/DFM rules, vendor profiles, and formal policies.
2. **Read-only by default:** The standard MCP tool set is read-only. Mutating operations (artifact generation, release packaging) require explicit capability elevation.
3. **Structured evidence references:** Every claim made by an AI assistant must reference a stable finding fingerprint or evidence manifest hash.
4. **No gate relaxation:** Agents are never granted tools to relax severity thresholds, disable active rules, or create unapproved waivers.

---

## Available MCP Tools

### Read-Only Tools

| Tool Name | Parameters | Description | Status |
| :--- | :--- | :--- | :--- |
| `boardreadyops_check` | `path`, `config`, `failOn` | Runs the full hardware validation pipeline against the KiCad project and returns structured findings. | `implemented` |
| `boardreadyops_plan` | `path`, `config`, `failOn` | Returns an ordered remediation plan with fix strategies, `safeAutoFixPossible` flags, and verification commands. | `implemented` |
| `boardreadyops_verify_bundle` | `bundleDir`, `trustedKey` | Verifies cryptographic integrity (Ed25519 signature + SHA256 checksums) of an offline evidence bundle. | `implemented` |
| `boardreadyops_explain` | `findingId`, `path` | Explains the physical manufacturing and electrical risks associated with a specific finding fingerprint. | `planned` — the CLI only explains a rule id today, not a finding fingerprint |
| `boardreadyops_vendor_score` | `path`, `profile` | Computes the 0–100 manufacturing readiness score against a specific vendor profile (e.g. JLCPCB, PCBWay). | `planned` — the score exists (`src/core/readiness.ts`) but only inside a full pipeline run, not as a standalone call |

### Mutating Tools (Controlled / Previewable)

| Tool Name | Parameters | Description | Status |
| :--- | :--- | :--- | :--- |
| `boardreadyops_generate` | `path`, `outputDir`, `recipes` | Generates manufacturing outputs (Gerber, drill, BOM, CPL, PDF, STEP) from the KiCad source using `kicad-cli`. | `planned` — needs a capability-elevation design first |
| `boardreadyops_release_prepare` | `path`, `profile`, `outDir` | Orchestrates end-to-end release preparation: generation, validation, packaging, and signed manifest creation. | `planned` — needs a capability-elevation design first |

---

## Agent Remediation Loop

When an AI assistant operates on a BoardReadyOps project:

1. **Discover:** Run `boardreadyops_plan` to inspect blocking issues.
2. **Prioritize:** Address `high` and `error` severity items first.
3. **Inspect:** Examine only the referenced schematic/PCB coordinates and evidence.
4. **Modify:** For `safeAutoFixPossible: true`, prepare the minimal patch. For complex EDA changes, present a reviewable design proposal.
5. **Verify:** Execute `commandsToVerify` and re-run `boardreadyops_plan` to confirm resolution.
6. **Package:** Prepare the signed evidence bundle with `boardreadyops_release_prepare`.
