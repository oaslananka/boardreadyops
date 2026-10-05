# Core Instructions

These instructions apply to `src/core/**` and supplement the repository root instructions.

## Responsibility

Core owns deterministic local orchestration: config loading, discovery, project context, findings, rule registration, logging, results, plugin loading, and pipeline execution.

Primary interfaces include:

- `runPipeline`
- `discoverProjects`
- `registerRule`, `listRules`
- `createFinding`, `summarizeFindings`, `sortFindings`

## Determinism and layering

- Keep externally visible finding/rule order deterministic.
- Multi-project execution remains bounded; do not replace bounded concurrency with unbounded fan-out.
- Core may register built-in rules through `src/rules/_index.ts`; rule modules must not self-register at import time.
- Preserve the import graph enforced by `corepack pnpm run verify:structure`.
- Keep user-facing validation failures structured. Do not call `process.exit()` from library code.

## Configuration

- Runtime config is validated against the canonical schemas.
- Preserve useful JSON-pointer/path context when validation can provide it.
- Do not silently coerce an unknown or unsupported policy value into a permissive default.

## Plugin trust boundary

Safe mode is the security boundary for plugin execution.

- Safe mode loads zero plugins.
- Standard mode treats configured plugins as trusted project code.
- Plugin permission manifests are defense-in-depth, not a sandbox.
- Do not describe `node:vm`, the Node permission model, or manifest permissions as malicious-code isolation.
- Static permission checks may reject an honestly declared capability before import, but they cannot make imported third-party code safe.
- A change that enables plugin execution in an untrusted context is security-sensitive and requires explicit design review.

Read `docs/architecture/adr/0009-plugin-sandboxing.md` before changing plugin loading semantics.

## Verification

Run focused core/plugin tests plus:

```bash
corepack pnpm run verify:structure
corepack pnpm run test:unit
corepack pnpm run coverage:core
```

Mutation-sensitive core changes may also require the mutation gate selected by CI.
