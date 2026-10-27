# CI domains and independent release boundaries

BoardReadyOps remains **one GitHub repository**. Code ownership and release
responsibility are separated within the monorepo, without version-skew between
the signed CLI/runner and hosted evidence contracts.

| Domain | Primary ownership | Delivery |
| --- | --- | --- |
| Engine/CLI | `src/`, KiCad/rules, CLI, report and engine fixtures | npm/GitHub Action release workflows, with native KiCad acceptance |
| Cloud/control plane | `apps/web/`, `packages/cloud-core/`, `packages/db/`, `packages/contracts/`, `deploy/` | Independent protected cloud deployment and database acceptance |
| Integrations/SDK | `packages/mcp-server/`, `packages/plugin-sdk/`, `src/action/` and `src/runner/` | Explicit package/API compatibility and protocol validation |

Shared dependency, workflow, root TypeScript configuration and toolchain changes
conservatively mark **all three** domains. Some files legitimately affect more than one domain. The
`ci / risk-profile` step outputs `domain_engine`, `domain_cloud` and
`domain_integrations` so PR owners can see the impacted surfaces.

The *only* routing optimization initially attached to these domain flags is
`needs_web_standalone`: the non-required Windows Next.js standalone-package
job and the cloud-build step inside the always-required Linux `ci / build`
job run for cloud/shared runtime changes, not engine-only changes. The
`ci / build` job itself still builds the CLI when required. Every
**previously required** CI context, plus Linux build, unit tests, security,
coverage, mutation and fail-closed real KiCad routing remain unchanged.
Main pushes/manual CI still run the full suite. Do not use the domain
indicator to skip an unresolved authorization/security acceptance.

## Performance measurements

The previous CodSpeed simulation workflow and Vitest plugin are retired.
The benchmark fixtures exercise filesystem/OS calls that the CodSpeed CPU
simulation instrument does not time; repeated PR failures compared different
runner types even when benchmark/engine source was unchanged. The available
walltime instrument needs consistently provisioned hardware to be a meaningful
gate, which is not part of this repository's free-only infrastructure.

`.github/workflows/benchmark.yml` retains the existing native Vitest
benchmarks: push to `main`, manual dispatch, and targeted PRs changing
engine/benchmark/runtime input. Results are stored as short-lived artifacts
for inspection **without claiming stable cross-runner regression thresholds**.
The benchmark command uses Bash \`pipefail\` so unsuccessful measurements remain
failed checks even when output is captured via \`tee\`.
No new runner, subscription, secret or release privilege is introduced.

Removing the workflow and its plugin prevents future repository-originated
CodSpeed uploads. It does *not* delete historical provider reports or uninstall
a CodSpeed GitHub App, if connected outside this repo. Existing old-SHA
check runs and external provider configuration may remain until the provider
itself is disconnected by an authorized owner. Verify fresh-head CI before
merging; never override required checks or unreviewed changes.

## Reconsider a separate repository only when

The cloud and local product acquire independent release owners and cadences,
shared API contracts can be versioned and tested independently, migration
ownership is defined, and observed CI/build costs justify duplicated security
maintenance. Until then keep source and contracts in one repo.
