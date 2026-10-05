# MCP Server Instructions

These instructions apply to `packages/mcp-server/**` and supplement the repository root instructions.

The MCP package is an agent-facing adapter to the real BoardReadyOps CLI. It does not make release decisions independently.

## Safety model

Read-only by default.

- Existing tools may inspect, check, plan, and verify; they must not modify project source or manufacturing outputs.
- Do not expose generation, release preparation, auto-fix, waiver creation, or gate-relaxation tools until a separately reviewed capability-elevation design exists.
- The deterministic CLI remains authoritative for findings and bundle verification.
- Keep transport/tool errors distinct from hardware verdicts returned by the CLI.

## Process boundary

- Invoke only the reviewed BoardReadyOps CLI path used by this package.
- Treat every MCP argument as untrusted and preserve plain-value/path validation.
- Keep tool inputs narrow; do not add generic process-control or environment-control parameters.
- Keep internal process details out of user-facing errors.

## Path and contract behavior

- Requested paths must stay within the documented project/bundle model.
- Any future write capability needs an explicit workspace allowlist and traversal/symlink policy.
- Reuse stable BoardReadyOps JSON/schema contracts instead of scraping human output.

## Verification

Run MCP package typecheck and focused tool/stdio/server tests. New tools also require docs and threat-model review.
