# Master Execution Ledger Design

## Context

The BoardReadyOps master development specification defines 37 workstreams (W00-W36) and orders delivery through phases 0-8. It explicitly requires repository reconciliation before product implementation and treats GitHub issue #191 as the authoritative dependency sequence.

The repository already has an in-progress `docs/development/master-execution-status.md`, a documentation contract test, MkDocs navigation, and release-reference drift checks through `verify:public-surface`. The first implementation slice must adopt those changes without overwriting unrelated work.

## Goal

Complete W00 and Phase 0 by making the execution ledger deterministic, locally verifiable, evidence-backed, and aligned with issue #191. After this slice, a new agent session must be able to identify the next valid work package within five minutes and prove why incomplete work remains incomplete.

## Scope

- Inventory all W00-W36 workstreams.
- Record phase, priority, status, owner, dependencies, roadmap target, evidence, commit or pull-request references, and verification result for every workstream.
- Generate the Markdown status matrix from canonical machine-readable data.
- Validate ledger structure and generated-document drift offline in normal repository verification.
- Reconcile current issue, milestone, ADR, schema, implementation, test, documentation, and deployment evidence.
- Run the existing verification baseline and freeze security or release blockers as evidence.
- Preserve completed milestones as closed and route follow-up work to current milestones.

## Non-goals

- Implement W01-W36 product features.
- Reopen completed milestones.
- Add a network dependency to normal CI verification.
- Replace issue #191 as roadmap authority.
- Modify unrelated source, generated bundles, or documentation.

## Canonical Data

`docs/development/master-execution-status.json` is the canonical inventory. It contains:

- `spec`: source path, SHA-256, and inventory date.
- `roadmap`: issue #191 URL, checked revision timestamp, ordered milestones, and completed milestones.
- `baseline`: command, result, checked commit, timestamp, and blocker references.
- `workstreams`: exactly one entry for every ID W00-W36.

Each workstream entry contains:

- `id`, `name`, `phase`, `priority`, and `status`.
- `owner` and `dependencies`.
- `milestone` and `issues`.
- `evidence.code`, `evidence.tests`, `evidence.docs`, `evidence.deployed`, `evidence.commits`, and `evidence.pullRequests`.
- `verification.command`, `verification.result`, and `verification.checkedAt`.
- `remaining` for partial, missing, or blocked work.
- `deferUntil` for deferred work.

Allowed statuses are `implemented`, `partial`, `missing`, `blocked`, and `deferred`.

An `implemented` entry requires code, test, documentation, deployment evidence or an explicit non-deployable justification, at least one commit or pull request, and a passing verification result. Other statuses require an explicit remaining gap, blocker, or defer trigger. This prevents optimistic status claims.

## Rendering

`scripts/master-execution-status.mjs` owns validation and rendering. It replaces only the generated matrix between stable markers in `docs/development/master-execution-status.md`; human-maintained narrative remains untouched.

Commands:

- `node scripts/master-execution-status.mjs render` updates the generated section.
- `node scripts/master-execution-status.mjs check` validates canonical data and fails when rendered output differs from the committed Markdown.

Output ordering is deterministic: phase, priority, then workstream ID. JSON arrays that carry roadmap sequence keep their declared order.

## Validation Rules

Offline validation fails when:

- W00-W36 are missing, duplicated, or unknown.
- Status, priority, or phase is invalid.
- A dependency does not exist, points to itself, or creates a cycle.
- A workstream is scheduled before its dependency.
- Required owner, roadmap, evidence, commit/PR, or verification fields are absent.
- An implemented entry lacks required evidence.
- A completed milestone is used as a target for new work.
- A referenced repository path does not exist.
- Generated Markdown is stale.
- Issue #191 is absent as roadmap source or its ordered milestone snapshot is empty.

Live GitHub reconciliation remains an explicit audit command because normal CI must be deterministic and work without credentials. Its checked timestamp and resulting issue/milestone snapshot are committed to canonical data. Existing `verify:public-surface` continues to own public release-reference drift.

## Integration

`package.json` gains render and check scripts. The check command is added to the existing `verify` chain, so `task verify` exercises W00 without a separate workflow. `mkdocs.yml` keeps the existing ledger navigation entry.

No new dependency is required. Implementation uses Node.js standard library and existing Vitest infrastructure.

## Testing

TDD sequence:

1. Parser rejects missing or duplicate workstreams.
2. Parser rejects invalid statuses and dependency cycles.
3. Implemented status rejects incomplete evidence.
4. Renderer produces stable Markdown in canonical order.
5. Check mode reports generated-document drift.
6. Repository contract verifies all W00-W36 entries, phases 0-8, issue #191 authority, and MkDocs registration.

Tests use temporary directories and real files. No network mocks are needed for offline validation.

## Phase 0 Completion Flow

1. Reconcile current uncommitted ledger work into canonical data.
2. Add failing tests for validator and renderer behavior.
3. Implement minimum validator and renderer.
4. Render and validate the committed ledger.
5. Map current repository evidence, issues, milestones, ADRs, schemas, and tests.
6. Run targeted tests, then `task verify`.
7. Record baseline failures as blockers rather than hiding or fixing unrelated work.
8. Mark W00 implemented only after code, tests, docs, and verification evidence pass.

## Safety and Change Isolation

Current workspace contains unrelated in-progress edits. W00 work will preserve them, avoid broad formatting, and stage or commit only files directly owned by this slice. Generated bundles are changed only if an existing repository build step requires them for W00, which is not expected.

## Success Criteria

- Ledger matches current repository reality and is generated or validated deterministically.
- No capability is planned in two milestones.
- New sessions can identify current work, dependencies, evidence, blockers, and next action without re-auditing the repository.
- `task verify` includes execution-ledger drift validation.
- Phase 0 records a reproducible baseline and proves which work is genuinely missing.
