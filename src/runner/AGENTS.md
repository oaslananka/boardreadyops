# Self-Hosted Runner Instructions

These instructions apply to `src/runner/**` and supplement the repository root instructions.

The self-hosted runner executes customer-selected work under control-plane authority. Treat this as a tenant/security boundary.

Read `docs/deployment/self-hosted-runner.md` and the managed-execution ADR before changing protocol behavior.

## Identity and assignment

- Runner identity material stays private, non-symlinked, and confined to the identity directory.
- Preserve Ed25519 request signing, bounded timestamps, and replay protection.
- The control plane selects repository, run, execution attempt, and lease authority.
- Execute only the exact assigned commit SHA and repository identity.
- Lease, run ID, execution attempt ID, runner identity, artifact capability, and terminal result must remain mutually bound.
- Stale or mismatched execution state fails closed.

## Source and workspace

- The worker remains outbound-only.
- Validate workspace roots, managed namespaces, and symlink boundaries before checkout or cleanup.
- Source checkout must resolve to the exact assigned commit SHA.
- Crash recovery cleans only the current runner's validated managed workspace namespace.
- Logs and evidence should not retain private source contents or unnecessary source paths.

## Artifact behavior

- Artifact upload capabilities remain short-lived and attempt-bound.
- Metadata-only mode must not request managed upload capabilities.
- Verify declared size, digest, and identity before treating an upload as belonging to a run.

## Verification

Run focused runner identity/client/source/worker tests plus relevant runner/control-plane integration suites.
