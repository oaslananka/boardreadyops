# @boardreadyops/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes BoardReadyOps'
read-only hardware release checks to coding agents (Claude Code, Cursor, and any other MCP
client).

Every tool spawns the real `boardreadyops` CLI as a child process and returns its actual output —
there is no reimplementation of check/plan/verify logic here, so results are always identical to
running the same command by hand.

## Design principles

1. **Deterministic release authority.** No tool here can decide whether a design passes or fails.
   All release decisions come from the deterministic CLI pipeline (DRC/ERC/DFM rules, vendor
   profiles, policies).
2. **Read-only.** Every registered tool only reads a project or a release bundle. None of them
   write files, generate manufacturing outputs, or create a release package.
3. **No gate relaxation.** No tool accepts a parameter that could disable a rule, relax a severity
   threshold, or approve a waiver.

## Tools

| Tool | Wraps | Parameters |
| --- | --- | --- |
| `boardreadyops_check` | `boardreadyops check --format json` | `path?`, `config?`, `failOn?` |
| `boardreadyops_plan` | `boardreadyops plan` | `path?`, `config?`, `failOn?` |
| `boardreadyops_verify_bundle` | `boardreadyops release verify --format json` | `bundleDir`, `trustedKey?` |

Each tool returns `{ ok: true, result: <parsed CLI JSON output> }` on success, or
`{ ok: false, error: string, exitCode: number }` when the underlying CLI invocation itself failed
(a genuine execution error — a config/environment problem, not a hardware finding). A run that
completes but reports blocking findings is still `ok: true`: check the returned result's own
`summary`/`status`/`exitCode` fields for the hardware verdict, the same way you would reading the
CLI's own JSON output.

## Usage

Configure your MCP client to run:

```json
{
  "mcpServers": {
    "boardreadyops": {
      "command": "npx",
      "args": ["-y", "@boardreadyops/mcp-server"]
    }
  }
}
```

## What's not here yet

`docs/integrations/boardreadyops-mcp.md` also describes `boardreadyops_explain`,
`boardreadyops_vendor_score`, and two mutating tools (`boardreadyops_generate`,
`boardreadyops_release_prepare`). Those are intentionally not implemented in this first version:

- `boardreadyops_explain` as documented takes a finding fingerprint, but the CLI only explains a
  **rule** (`boardreadyops explain <ruleId>`) — there is no per-finding explanation capability to
  wrap yet.
- `boardreadyops_vendor_score` as documented computes a project's actual 0–100 readiness score
  against a vendor profile. That score is real (`src/core/readiness.ts::computeReadiness`), but it
  is only produced as part of a full pipeline run with a vendor profile configured, not as a
  standalone `(path, profile)` call — wiring that up needs its own pass.
- The two mutating tools need a real "explicit capability elevation" mechanism (how an operator
  grants an agent permission to generate files or package a release) designed before they're
  exposed, not a default-on switch added alongside the read-only tools.
