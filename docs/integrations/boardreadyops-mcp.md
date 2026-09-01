# BoardReadyOps MCP Server

BoardReadyOps provides a Model Context Protocol (MCP) tool integration contract designed specifically for coding agents, AI reviewers, and automated hardware release workflows.

## Design Principles & Safety Model

1. **Deterministic release authority:** AI models never decide whether a hardware design passes or fails production gates. All release decisions originate from deterministic DRC/ERC/DFM rules, vendor profiles, and formal policies.
2. **Read-only by default:** The standard MCP tool set is read-only. Mutating operations (artifact generation, release packaging) require explicit capability elevation.
3. **Structured evidence references:** Every claim made by an AI assistant must reference a stable finding fingerprint or evidence manifest hash.
4. **No gate relaxation:** Agents are never granted tools to relax severity thresholds, disable active rules, or create unapproved waivers.

---

## Available MCP Tools

### Read-Only Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `boardreadyops_check` | `path`, `config`, `failOn` | Runs the full hardware validation pipeline against the KiCad project and returns structured findings. |
| `boardreadyops_plan` | `path`, `config`, `failOn` | Returns an ordered remediation plan with fix strategies, `safeAutoFixPossible` flags, and verification commands. |
| `boardreadyops_explain` | `findingId`, `path` | Explains the physical manufacturing and electrical risks associated with a specific finding fingerprint. |
| `boardreadyops_verify_bundle` | `bundleDir`, `trustedKey` | Verifies cryptographic integrity (Ed25519 signature + SHA256 checksums) of an offline evidence bundle. |
| `boardreadyops_vendor_score` | `path`, `profile` | Computes the 0–100 manufacturing readiness score against a specific vendor profile (e.g. JLCPCB, PCBWay). |

### Mutating Tools (Controlled / Previewable)

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `boardreadyops_generate` | `path`, `outputDir`, `recipes` | Generates manufacturing outputs (Gerber, drill, BOM, CPL, PDF, STEP) from the KiCad source using `kicad-cli`. |
| `boardreadyops_release_prepare` | `path`, `profile`, `outDir` | Orchestrates end-to-end release preparation: generation, validation, packaging, and signed manifest creation. |

---

## Agent Remediation Loop

When an AI assistant operates on a BoardReadyOps project:

1. **Discover:** Run `boardreadyops_plan` to inspect blocking issues.
2. **Prioritize:** Address `high` and `error` severity items first.
3. **Inspect:** Examine only the referenced schematic/PCB coordinates and evidence.
4. **Modify:** For `safeAutoFixPossible: true`, prepare the minimal patch. For complex EDA changes, present a reviewable design proposal.
5. **Verify:** Execute `commandsToVerify` and re-run `boardreadyops_plan` to confirm resolution.
6. **Package:** Prepare the signed evidence bundle with `boardreadyops_release_prepare`.
