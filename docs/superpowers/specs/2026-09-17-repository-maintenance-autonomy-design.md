# Exception-Based Repository Maintenance

**Date:** 2026-09-17
**Status:** Approved for implementation
**Scope:** `oaslananka` public repositories, starting with `boardreadyops`

## Problem

The repositories already have strong CI, security scanning, dependency automation, issue templates, release automation, and merge governance. The operational problem is not missing automation; it is that too many routine maintenance events terminate in a maintainer queue.

Renovate can discover updates, security tooling can classify them, and CI can validate them, but many otherwise routine changes still wait for explicit approval. Over time this produces open dependency PRs, Dependency Dashboard backlog, stale branches, and maintenance work that competes with product work.

The target operating model is **human-on-exception** rather than human-in-every-loop:

```text
change discovered
      |
      v
risk classification
   /       \
 low       exception
  |           |
 CI          human inbox
  |
merge authority
  |
merge + cleanup
```

A maintainer should normally see only updates for which the repository cannot establish a sufficiently strong deterministic safety case.

## Goals

- Establish one shared Renovate baseline for the `oaslananka` repositories.
- Bound maintenance PR volume so automation cannot create an unmanageable queue.
- Preserve the existing seven-day release quarantine for routine updates.
- Automatically finish low-risk maintenance when required checks pass.
- Keep major, runtime-critical, protocol, database, native, release, and security-control changes in the exception path.
- Keep repository-specific risk knowledge in each repository rather than forcing product-specific package lists into the shared preset.
- Avoid duplicate dependency bots owning the same update class.
- Make rollback possible by configuration only; no dependency-update mechanism may require weakening required CI/security checks.

## Non-Goals

- Automatically merge arbitrary source-code PRs.
- Bypass required GitHub Ruleset checks.
- Remove human review from architectural, schema, migration, authentication, billing, release, or other high-impact changes.
- Force every repository to use the same merge bot. Risk classification is shared; merge authority may remain repository-specific where that is already proven.
- Treat a green AI or LLM review as a deterministic merge gate.

## Central Preset Repository

Create a public `oaslananka/.github` repository and restore the existing preset identifier:

```json
"github>oaslananka/.github:renovate-config"
```

The canonical shared file is `renovate-config.json` at the root of the `oaslananka/.github` repository. Renovate resolves the named preset above to that root-level file.

This identifier is already referenced by repositories including `fovux-kit`, and Fovux's validator expects inherited labels including `automerge`, `ci`, `dependencies`, `docker`, `github-actions`, `javascript`, `lockfile`, `major`, `python`, `requires-review`, `runtime`, and `security`. The first restored preset therefore has to be backward-compatible and conservative.

Creating `.github` is an operational prerequisite that must be done manually because the connected GitHub automation used for this rollout can modify existing repositories but cannot create a new repository.

## Bootstrap Safety Rule

The first version of the restored shared preset must **not** broadly enable new automerge behavior. Existing repositories already reference it, so publishing an aggressive preset could alter several repositories at once without repository-local review.

Bootstrap proceeds in two layers:

1. **Shared baseline:** scheduling defaults, quarantine, labels, dependency dashboard behavior, PR rate/concurrency bounds, digest pinning, and common risk classification.
2. **Repository autonomy:** each mature repository explicitly opts low-risk classes into its existing merge authority after its required status checks and branch/ruleset behavior have been verified.

This lets the central preset be restored safely before individual repositories are migrated to higher autonomy.

## Shared Baseline Contract

The initial `renovate-config.json` should establish these defaults:

- `Europe/Istanbul` timezone;
- seven-day `minimumReleaseAge` for routine updates;
- Dependency Dashboard enabled;
- semantic commits;
- digest pinning where supported;
- `internalChecksFilter: strict`;
- PR creation only after pending internal checks are resolved;
- `prHourlyLimit: 2`;
- `prConcurrentLimit: 5` as the target default;
- bounded branch concurrency;
- lockfile maintenance enabled on a maintenance schedule;
- majors require Dependency Dashboard approval and a review-required label;
- shared labels use the existing vocabulary expected by current consumers.

The shared preset must not contain BoardReadyOps-, KiCad-, MCP-, computer-vision-, or product-specific protected package lists. Those remain local package rules.

## Risk Model

### Low risk

A change may enter the automatic path only when all applicable repository checks are deterministic and required before merge. Initial candidates are:

- development dependency patch updates;
- development dependency minor updates, except locally protected toolchains;
- `@types/*` patch/minor updates;
- lockfile-only maintenance;
- pin/digest refreshes that do not change a protected runtime or infrastructure contract;
- GitHub Action digest refreshes within an already-approved action release, except security/release-control actions protected locally.

Low-risk classification is an allowlist, not the absence of a high-risk match.

### Exception path

The following classes require explicit maintainer attention unless a repository later proves a narrower safe policy:

- all major updates;
- runtime/framework dependencies identified by the repository;
- language/compiler support-policy changes such as TypeScript, Node, Python, or Rust toolchain boundaries;
- database drivers, database server majors, schema/migration tooling, and storage infrastructure;
- authentication, authorization, signing, cryptography, GitHub App, and permission-sensitive packages;
- MCP/protocol/schema and compatibility-boundary packages;
- native dependencies and platform packaging stacks;
- release, provenance, scanner, dependency-review, CodeQL, secret-scanning, and other security-control tooling;
- changes that modify migrations, permissions, deployment policy, or protected workflows;
- any update whose required checks do not run or do not reach a terminal success state.

Security advisories remain schedule-urgent, but are not automatically classified as low risk merely because they are security fixes. Their normal package/update risk classification still applies.

## Merge Authority

The shared policy decides **what is eligible** for autonomous completion. The repository decides **how eligible work is merged**.

For `boardreadyops`, the existing GitHub Rulesets and Mergify queue remain the initial merge authority. Mergify already imports the applicable ruleset requirements and automatically queues PRs that are not drafts and do not carry `manual-review` or `do-not-merge`.

The BoardReadyOps migration therefore should use labels to route exceptions and should not introduce a second independent merge-control system in the first tranche. Low-risk Renovate PRs become self-completing because they avoid `manual-review`; protected classes retain it.

Repositories without an established merge queue may use Renovate's PR automerge only after they prove that required status checks are configured. Renovate platform automerge must never be used as a substitute for required checks.

## BoardReadyOps Migration

BoardReadyOps is the first migration because it already contains the necessary enforcement primitives:

- project-scoped Renovate execution;
- seven-day release quarantine;
- generated `NOTICE` and committed `dist/` regeneration;
- aggregate CI/security gates;
- repository Rulesets;
- Mergify queue injection of Ruleset requirements;
- static tests that enforce the dependency/security automation contract.

The migration should:

1. extend `github>oaslananka/.github:renovate-config`;
2. remove shared defaults from local `renovate.json` where doing so does not reduce explicit repository guarantees;
3. reduce the effective maintenance PR target from eight concurrent Renovate PRs toward five;
4. preserve BoardReadyOps-specific post-upgrade tasks, managers, ignored paths, generated-file behavior, and security-alert ownership;
5. preserve manual review for TypeScript, core runtime/GitHub integration packages, major upgrades, database/runtime infrastructure, and security/release controls;
6. narrow the current blanket manual-review rule for GitHub Actions so same-release digest refreshes of non-protected actions can enter the automatic path after required checks pass;
7. keep container/runtime image updates manual in the first tranche, because BoardReadyOps deploys stateful and production-facing containers;
8. update `docs/dependency-automation.md` and `tests/unit/scripts/security-automation-config.test.ts` so the policy remains executable documentation.

The first migration does not change required CI/security checks or the Mergify queue's authority.

## Dependency Bot Ownership

Every repository must have one owner for routine version-update PRs. For the mature repositories in this rollout, Renovate is preferred for routine dependency management because grouping, scheduling, dashboard approval, and risk-specific package rules are already in use.

GitHub Dependabot security alerts may remain enabled even when Renovate owns routine version updates. Security PR creation must be explicitly assigned per repository so Dependabot and Renovate do not generate competing remediation PRs for the same class.

## Queue Discipline

Automation must optimize completed maintenance, not PR creation count.

Target repository health indicators:

- no more than five concurrent Renovate PRs by default;
- no more than two newly opened Renovate PRs per hour;
- normal low-risk dependency work finishes without maintainer interaction;
- human-action-required maintenance stays at five items or fewer when practical;
- superseded dependency branches are rebased/replaced by Renovate rather than accumulated;
- stale automation PRs are treated as automation defects to fix, not as a permanent backlog.

A repository may use stricter limits when its CI cost or update surface warrants it.

## Rollout Sequence

### Phase 0 — restore shared policy

1. Create public `oaslananka/.github`.
2. Add conservative `renovate-config.json` compatible with existing consumers.
3. Validate the preset with the current Renovate config validator.
4. Confirm an existing consumer such as `fovux-kit` resolves the preset without changing its protected package behavior.

### Phase 1 — BoardReadyOps

1. Migrate local Renovate configuration to the shared baseline.
2. Adjust low-risk/manual-review routing.
3. Update policy tests and documentation.
4. Run repository Renovate config validation and focused policy tests.
5. Open a normal protected PR; do not bypass the Mergify/ruleset path.
6. Observe at least one eligible low-risk maintenance PR reach the queue and complete without manual approval.

### Phase 2 — remaining mature repositories

Migrate in this order so existing reference implementations are used before more conservative repositories are changed:

1. `debug-recorder-mcp`;
2. `kicad-studio-kit`;
3. `kicad-mcp-pro`;
4. other active public repositories after their CI and dependency-bot ownership are inventoried.

`fovux-kit`, `easyeda-mcp-pro`, and `zaptrace` serve as behavior/reference inputs rather than targets for broad immediate rewrites.

## Failure Handling and Rollback

- If the shared preset fails to resolve, repository-local config remains the recovery path; do not delete product-specific rules during the same change that first restores the preset.
- If a low-risk PR fails CI, it leaves the automatic path and becomes visible maintenance work rather than being retried indefinitely without context.
- If an update is misclassified, adding a local protected-package rule must be sufficient to force future matching updates into manual review.
- If a shared rule proves unsafe across consumers, revert it centrally and keep repository-local overrides until a corrected preset is released.
- No rollback may remove required tests, security gates, signed-commit requirements, or protected-main enforcement merely to make automerge succeed.

## Verification

Before a repository enables autonomous completion for a class, verify:

- the resolved Renovate config contains the intended shared and local rules;
- required CI/security status checks run for Renovate PRs;
- the merge authority cannot merge before those checks pass;
- protected packages and all major updates remain non-automerge/manual-review;
- Dependency Dashboard approval blocks the intended update classes before branch/PR creation;
- PR/hour and concurrent-PR limits are effective;
- generated artifacts required by the repository are refreshed deterministically;
- a deliberately failing dependency PR does not merge;
- a representative low-risk passing PR completes without maintainer approval.

For BoardReadyOps specifically, run the existing Renovate validator, the dependency/security automation unit tests, and the repository verification gates required by `AGENTS.md` before the implementation PR is ready.

## Acceptance Criteria

The rollout is successful when:

- `oaslananka/.github:renovate-config` resolves again for existing consumers;
- BoardReadyOps extends the shared preset while retaining all product-specific safety rules;
- routine low-risk maintenance no longer requires explicit maintainer approval;
- high-impact updates remain clearly routed to a small human exception queue;
- normal maintenance PR volume is bounded by shared rate/concurrency policy;
- no duplicate routine dependency-update bot is active for the same update class;
- failed or uncertain automation becomes visible instead of silently merging;
- required CI/security/ruleset enforcement is unchanged or stronger;
- the policy is documented and enforced by tests, not only by convention.
