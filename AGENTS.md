# AGENTS.md

## Scope and precedence

These instructions apply repository-wide. A nested `AGENTS.md` narrows or adds rules for its subtree; the closest applicable `AGENTS.md` wins.

Nested instructions may not weaken security, tenant isolation, release integrity, product-truth, evidence, or branch-governance constraints unless the underlying canonical policy is intentionally changed in the same work.

Executable repository policy, schemas, tests, ADRs, security documentation, and live GitHub rulesets remain authoritative when prose drifts.

## What this repository is

BoardReadyOps is the trust layer between hardware design changes and manufacturing release. It has four major execution surfaces:

1. the deterministic local engine and public CLI/GitHub Action under `src/**`;
2. the hosted web/control plane under `apps/web/**` plus `packages/cloud-core/**`, `packages/contracts/**`, and `packages/db/**`;
3. the customer self-hosted runner protocol under `src/runner/**`;
4. release, CI, deployment, provenance, and operational automation under `src/release/**`, `.github/**`, and `deploy/**`.

The deterministic BoardReadyOps engine remains authoritative for hardware findings and release-gate outcomes. Web, MCP, AI, and automation surfaces may present, route, or explain evidence; they do not invent a passing hardware verdict.

## Nested instruction boundaries

Read the closest relevant file before editing:

- `.github/AGENTS.md` — CI, branch policy, security automation, publishing, provenance, and release workflows.
- `apps/web/AGENTS.md` — Next.js generated compatibility guidance. Preserve its generated block.
- `apps/web/app/api/AGENTS.md` — public/API route trust boundary.
- `apps/web/lib/AGENTS.md` — web server authorization, workers, GitHub mutations, and tenant-scoped orchestration.
- `packages/cloud-core/AGENTS.md` — hosted domain/security logic.
- `packages/contracts/AGENTS.md` — cross-process and public wire contracts.
- `packages/db/AGENTS.md` — persistence, migrations, tenant isolation, leases, and lifecycle state.
- `packages/mcp-server/AGENTS.md` — read-only MCP adapter.
- `packages/plugin-sdk/AGENTS.md` — plugin public contract and trusted-code boundary.
- `src/action/AGENTS.md` — GitHub Action edge.
- `src/bom/AGENTS.md` — BOM parsing/normalization.
- `src/cli/AGENTS.md` — CLI edge.
- `src/core/AGENTS.md` — local orchestration and plugin-loading policy.
- `src/kicad/AGENTS.md` — KiCad process/parsing boundary.
- `src/pinmap/AGENTS.md` — pinmap loading.
- `src/release/AGENTS.md` — signed evidence and release bundles.
- `src/report/AGENTS.md` — report format contracts.
- `src/rules/AGENTS.md` — deterministic rule implementation.
- `src/runner/AGENTS.md` — self-hosted runner identity, lease, source, and artifact boundary.
- `src/util/AGENTS.md` — leaf utilities.
- `deploy/AGENTS.md` — production/self-hosted deployment topology and rollback controls.

Do not create one instruction file per directory. Add a new boundary only when behavior, authority, compatibility, or operational risk is materially different.

## Product-truth and trust rules

- Do not claim BoardReadyOps guarantees fabrication success, manufacturer approval, formal electrical correctness, or safety certification.
- Do not convert a warning, unknown, unsupported state, missing evidence, or failed verification into a pass for convenience.
- Private-repository, fork, draft-PR, and untrusted-context safety behavior must fail closed according to the current safe-mode contracts.
- Authentication proves identity, not resource authority. Repository, workspace, installation, run, review, artifact, and runner scope must be derived or revalidated server-side.
- Plugins are trusted project code, not a sandbox. Permission declarations are defense-in-depth and configuration policy, not malicious-code isolation.
- The MCP server is read-only by default. Mutating tools require a separately designed capability-elevation contract.
- Public site `/AGENTS.md` and generated docs discovery files are user-facing documentation surfaces. They are not repository coding-agent instructions and must not leak internal deployment or secret information.

## Setup

- Bootstrap the repository-local toolchain: `corepack pnpm run toolchain:bootstrap`
- Validate prerequisites before long checks: `corepack pnpm run toolchain:doctor`
- Install CI dependencies through the repository scripts; keep the frozen lockfile.
- Node support is defined by `package.json` and the support matrix, not by a developer's ambient Node version.

## Verification

Use the narrowest relevant checks first, then the repository gate appropriate to the risk.

- Lint: `task lint`
- Typecheck: `task typecheck`
- Unit/coverage: `task test`
- Integration: `task test:int`
- Action: `task test:action`
- Build: `task build`
- Structure: `task verify:structure`
- Agent instruction contract: `corepack pnpm run verify:agent-instructions`
- Full repository verification: `task verify`
- Complete monorepo verification when cloud/integration boundaries change: `task verify:all`

Environment-dependent PostgreSQL and KiCad suites must be reported as skipped when prerequisites are absent; do not present a skip as executed evidence.

## Repository map

- `src/**` — deterministic local engine, CLI, Action, parsers, rules, reports, runner, release logic.
- `apps/web/**` — Next.js hosted UI/API and control-plane worker entry.
- `packages/cloud-core/**` — hosted domain, policy, signing, sanitization, provider, lifecycle, and orchestration logic.
- `packages/contracts/**` — Zod/runtime contracts shared across cloud, runner, DB, and web surfaces.
- `packages/db/**` — PostgreSQL stores and ordered additive migrations.
- `packages/mcp-server/**` — agent-facing read-only CLI adapter.
- `packages/plugin-sdk/**` — public plugin authoring contract.
- `schemas/**` — public JSON/evidence contracts.
- `dist/**` — committed generated CLI/Action bundles.
- `docs/**` — architecture, security, product state, operations, rule, and release documentation.
- `.github/**` — rulesets, required checks, security scans, publishing, provenance, and automation.
- `deploy/**` — generic self-hosted/production topology assets; provider-specific commissioning belongs in the private infra repository.
- `scripts/**` — build, policy, CI classification, verification, migration, docs, and release tooling.
- `tests/**` — unit, integration, Action, property, snapshot, browser, and regression evidence.

## Architecture discipline

For `src/**`, preserve the layer model enforced by `corepack pnpm run verify:structure`. Do not bypass it by moving logic into a convenient but incorrect layer.

For the hosted system:

- web routes are transport edges, not authorization policy;
- `cloud-core` owns reusable hosted domain/security logic rather than Next.js-specific rendering;
- `contracts` owns shared runtime wire shapes;
- `db` owns persistence primitives and transactional state transitions;
- callers must not duplicate tenant or authorization rules by hand when a canonical helper exists.

For the runner:

- the control plane selects tenant/repository/run/attempt authority;
- the runner executes only the assigned exact source identity;
- leases, signatures, nonces, capabilities, and terminal results remain bound to the same execution identity.

## Change discipline

- Keep diffs focused and preserve existing architecture.
- Prefer fixing a root cause over weakening a gate, threshold, permission check, test, or scanner.
- Do not add broad suppressions, `continue-on-error`, ignored failures, fake success steps, or fallback credentials to make CI green.
- Treat changes to authorization, tenant scope, runner protocol, migrations, retention/erasure, billing, release signing, publishing, workflow permissions, and production deploy behavior as security-sensitive.
- Do not log tokens, signing material, webhook signatures, signed capabilities, credentials, raw private source, sensitive storage paths, or unredacted provider/database errors.

## Generated and public contracts

Do not hand-edit generated bundles or generated docs when a repository generator owns them.

- Build committed bundles with `corepack pnpm run build`.
- Verify them with `corepack pnpm run verify:dist`.
- Regenerate documentation with `corepack pnpm run docs`.
- Update schemas/snapshots/tests when a public JSON, Action, CLI, runner, review, plugin, or report contract changes.

Generated output must be reproducible and idempotent.

## CI and release integrity

The committed ruleset and live repository protection are governance contracts.

- Required check names must remain stable unless branch protection is migrated deliberately.
- Third-party Actions remain pinned to reviewed full commit SHAs.
- Publishing credentials and signing/provenance permissions must not be exposed to pull-request code.
- npm Trusted Publishing/OIDC is the normal publication path; do not add a long-lived token fallback to the normal publish job.
- Do not rewrite immutable release tags or silently replace released bytes.
- Release evidence, checksums, SBOMs, attestations, package contents, and version metadata must bind to the same release identity.

## Documentation and claims

Keep architecture, current-state, security, and operations docs consistent with implementation.

When documenting a capability, distinguish shipped, experimental, planned, unsupported, and external-validation-required states. Do not convert roadmap intent, synthetic tests, or configuration examples into claims of deployed production capability.

## SonarQube

- Shared Connected Mode binding: `.sonarlint/connectedMode.json`; project key: `oaslananka_boardreadyops`.
- SonarQube Cloud Automatic Analysis is authoritative while configured that way; do not add a redundant CI scanner just to obtain another badge.
- Treat remote quality status as evidence for the analyzed commit/branch only.

## Definition of done

A change is complete when the implementation, tests, schemas/contracts, generated artifacts, docs, security boundaries, and exact-head CI evidence appropriate to the touched surface agree. State clearly which environment-dependent checks were not run.
