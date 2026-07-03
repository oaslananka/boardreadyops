# Architecture Explanation

BoardReadyOps is a local-first hardware release pipeline for KiCad projects. The
system is intentionally split into boundary layers, core orchestration, parser
layers, rule packs, report emitters, release evidence, and GitHub Action wrappers.

## Why the layers matter

The repository enforces import boundaries through `pnpm run verify:structure` so
rules cannot accidentally depend on Action internals and report emitters cannot
call rule implementations directly. This keeps CLI, Action, and future hosted
control-plane integrations aligned around one core pipeline.

## Main flow

```text
Discover project -> Load config -> Load plugins -> Run rules -> Apply suppressions/waivers -> Compute readiness -> Emit reports -> Package release evidence
```

## Public contracts

The most important public contracts are:

- CLI commands and exit codes.
- GitHub Action inputs/outputs.
- `schemas/config.schema.json`.
- `schemas/findings.schema.json`.
- Release evidence bundle layout and manifests.
- Plugin SDK types.

## Further reading

- `docs/architecture/overview.md`
- `docs/architecture/pipeline.md`
- `docs/architecture/rule-engine.md`
- `docs/release/evidence-bundles.md`
- `docs/plugin-sdk.md`
