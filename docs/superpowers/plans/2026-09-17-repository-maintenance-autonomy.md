# Repository Maintenance Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a conservative shared Renovate preset in `oaslananka/.github`, then migrate BoardReadyOps so routine low-risk maintenance completes through its existing Ruleset/Mergify path while true exceptions remain manual.

**Architecture:** The shared `.github` repository owns only cross-repository defaults: release quarantine, dashboard, rate/concurrency bounds, digest pinning, weekly lockfile maintenance, and major-update approval. BoardReadyOps extends that preset and keeps product-specific managers, schedules, generated-artifact tasks, security-update ownership, protected dependency groups, and merge routing local. No new merge authority is introduced: GitHub Rulesets remain authoritative and Mergify continues to admit any PR that does not carry `manual-review` or `do-not-merge`.

**Tech Stack:** Renovate 43.272.4-compatible JSON, Node.js 24 built-in test runner, GitHub Actions, TypeScript/Vitest, Mergify, GitHub Rulesets.

**Spec:** `docs/superpowers/specs/2026-09-17-repository-maintenance-autonomy-design.md`

## Global Constraints

- The shared preset identifier remains exactly `github>oaslananka/.github:renovate-config`.
- The shared preset file is `renovate-config.json` at the root of the public `oaslananka/.github` repository.
- Routine releases remain quarantined for seven days.
- Use `internalChecksFilter: "strict"`; do not centralize `prCreation`, because repository CI trigger models differ and `prCreation: "not-pending"` can stall repositories whose checks start only on `pull_request`.
- Shared default PR creation rate is `prHourlyLimit: 2` and default concurrent PR limit is `prConcurrentLimit: 5`.
- The initial shared preset contains no `automerge: true` rule and does not assign an `automerge` label.
- All major updates require Dependency Dashboard approval and never automerge.
- Security vulnerability remediation may bypass the seven-day schedule only through repository-local policy; the shared preset does not choose a security-PR owner.
- BoardReadyOps keeps `vulnerabilityAlerts.automerge: false` and the `manual-review` label for vulnerability PRs.
- BoardReadyOps keeps TypeScript, core runtime/GitHub integration dependencies, protected workflow Actions, Dockerfile/Docker Compose updates, and majors in the manual exception path.
- BoardReadyOps may auto-complete only through its existing Ruleset + Mergify path; do not enable Renovate `automerge: true` in BoardReadyOps during this rollout.
- Required CI/security checks, signed-commit policy, squash-only policy, and protected-main enforcement must not be weakened.
- The connected GitHub tool cannot create a new repository. Before Task 1 execution, the maintainer must create an empty public repository named exactly `oaslananka/.github` with default branch `main`. Do not add a generated license, `.gitignore`, or starter workflow; Task 1 supplies the initial files.

---

### Task 1: Bootstrap the shared `.github` Renovate preset with executable policy tests

**Repository:** `oaslananka/.github`

**Files:**
- Create: `renovate-config.json`
- Create: `tests/renovate-preset.test.mjs`
- Create: `.github/workflows/validate-renovate-preset.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: Renovate shareable-preset contract `github>oaslananka/.github:renovate-config`.
- Produces: root-level `renovate-config.json` usable by `fovux-kit`, `airsim101-yolov10-cv`, `basic-visual-synthesis`, and later BoardReadyOps.
- Produces: a zero-dependency Node test that fails if the shared preset becomes aggressive or loses the agreed queue bounds.

- [ ] **Step 1: Write the failing shared-preset policy test**

Create `tests/renovate-preset.test.mjs` before creating the preset:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../renovate-config.json", import.meta.url), "utf8"));
const rules = config.packageRules ?? [];

const majorRule = rules.find((rule) => rule.matchUpdateTypes?.includes("major"));
const npmQuarantineRule = rules.find((rule) => rule.matchDatasources?.includes("npm"));

test("keeps the shared preset conservative", () => {
  assert.deepEqual(config.extends, [
    "config:best-practices",
    ":dependencyDashboard",
    ":semanticCommits",
  ]);
  assert.equal(config.timezone, "Europe/Istanbul");
  assert.equal(config.minimumReleaseAge, "7 days");
  assert.equal(config.internalChecksFilter, "strict");
  assert.equal(config.prHourlyLimit, 2);
  assert.equal(config.prConcurrentLimit, 5);
  assert.equal(config.pinDigests, true);
  assert.equal(config.prCreation, undefined);
  assert.equal(config.lockFileMaintenance?.enabled, true);
  assert.equal(config.lockFileMaintenance?.automerge, false);
  assert.ok(!rules.some((rule) => rule.automerge === true));
});

test("keeps npm on the seven-day quarantine despite best-practices defaults", () => {
  assert.equal(npmQuarantineRule?.minimumReleaseAge, "7 days");
});

test("requires dashboard approval for majors", () => {
  assert.equal(majorRule?.dependencyDashboardApproval, true);
  assert.equal(majorRule?.automerge, false);
  assert.equal(majorRule?.prPriority, -5);
});
```

- [ ] **Step 2: Run the test and preserve RED**

Run:

```bash
node --test tests/renovate-preset.test.mjs
```

Expected: FAIL with `ENOENT` for `renovate-config.json`.

- [ ] **Step 3: Add the minimal conservative shared preset**

Create `renovate-config.json` exactly with the common contract; keep labels and security-PR ownership repository-local during bootstrap:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "description": "Conservative shared dependency-maintenance baseline for oaslananka repositories.",
  "extends": [
    "config:best-practices",
    ":dependencyDashboard",
    ":semanticCommits"
  ],
  "timezone": "Europe/Istanbul",
  "minimumReleaseAge": "7 days",
  "internalChecksFilter": "strict",
  "prHourlyLimit": 2,
  "prConcurrentLimit": 5,
  "pinDigests": true,
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 6am on monday"],
    "automerge": false
  },
  "packageRules": [
    {
      "description": "Enforce the seven-day quarantine for npm even though config:best-practices includes a shorter npm minimum age.",
      "matchDatasources": ["npm"],
      "minimumReleaseAge": "7 days"
    },
    {
      "description": "Require an explicit Dependency Dashboard decision for all major upgrades.",
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true,
      "automerge": false,
      "prPriority": -5
    }
  ]
}
```

- [ ] **Step 4: Run the Node policy test and Renovate schema validator**

Run:

```bash
node --test tests/renovate-preset.test.mjs

docker run --rm \
  --network=none \
  --volume "$PWD:/workspace:ro" \
  --workdir /workspace \
  --entrypoint renovate-config-validator \
  renovate/renovate@sha256:62a5af4b26c18336b0ff5bc69f2e956337b6696e493b0de57a0d71c9d637da20 \
  renovate-config.json
```

Expected: Node tests PASS; Renovate 43.272.4-compatible validator exits 0.

- [ ] **Step 5: Add CI that enforces both checks**

Create `.github/workflows/validate-renovate-preset.yml`:

```yaml
name: validate-renovate-preset

on:
  pull_request:
    paths:
      - renovate-config.json
      - tests/renovate-preset.test.mjs
      - .github/workflows/validate-renovate-preset.yml
  push:
    branches:
      - main
    paths:
      - renovate-config.json
      - tests/renovate-preset.test.mjs
      - .github/workflows/validate-renovate-preset.yml
  workflow_dispatch:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: "24"
      - name: Test shared policy
        run: node --test tests/renovate-preset.test.mjs
      - name: Validate Renovate syntax
        run: |
          docker run --rm \
            --network=none \
            --volume "$PWD:/workspace:ro" \
            --workdir /workspace \
            --entrypoint renovate-config-validator \
            renovate/renovate@sha256:62a5af4b26c18336b0ff5bc69f2e956337b6696e493b0de57a0d71c9d637da20 \
            renovate-config.json
```

- [ ] **Step 6: Document the preset contract**

Create `README.md` with these concrete statements:

```markdown
# oaslananka shared GitHub policy

`renovate-config.json` is the shared Renovate baseline consumed as:

`github>oaslananka/.github:renovate-config`

The shared layer is intentionally conservative: seven-day routine release quarantine, two new PRs per hour, five concurrent PRs, digest pinning, weekly lockfile maintenance, and Dependency Dashboard approval for majors. It does not enable automerge and it does not choose between Dependabot and Renovate for vulnerability PR ownership.

Repository configs own product-specific schedules, protected packages, security-update ownership, labels, generated-artifact tasks, and merge routing.
```

- [ ] **Step 7: Commit and open the central preset PR**

Run:

```bash
git add renovate-config.json tests/renovate-preset.test.mjs .github/workflows/validate-renovate-preset.yml README.md
git commit -m "chore(deps): restore shared Renovate baseline"
```

Open a PR against `.github/main`. Do not merge it until the Node test and validator workflow are green.

### Task 2: Write BoardReadyOps policy tests for inherited defaults and exception routing

**Repository:** `oaslananka/boardreadyops`

**Files:**
- Modify: `tests/unit/scripts/security-automation-config.test.ts:135-330`
- Read-only verification: `tests/unit/scripts/mergify-integration.test.ts`

**Interfaces:**
- Consumes: `renovate.json`, `.mergify.yml`, shared preset identifier.
- Produces: executable tests proving BoardReadyOps inherits common limits, retains local security ownership, and blocks protected maintenance classes with `manual-review`.

- [ ] **Step 1: Add failing assertions for the shared preset and removed duplicated defaults**

In `keeps Renovate project-scoped, scheduled, and supply-chain hardened`, replace the old preset expectation with:

```ts
expect(renovate.extends).toEqual(
  expect.arrayContaining([
    "github>oaslananka/.github:renovate-config",
    "security:openssf-scorecard",
    ":separatePatchReleases",
  ]),
);
expect(renovate.extends).not.toEqual(expect.arrayContaining(["config:best-practices"]));
expect(renovate.prHourlyLimit).toBeUndefined();
expect(renovate.prConcurrentLimit).toBeUndefined();
expect(renovate.branchConcurrentLimit).toBeUndefined();
expect(renovate.minimumReleaseAge).toBeUndefined();
expect(renovate.internalChecksFilter).toBeUndefined();
expect(renovate.prCreation).toBeUndefined();
```

Keep the existing assertions for managers, BoardReadyOps weekday schedule, post-upgrade tasks, ignored paths, and pinned runner behavior.

- [ ] **Step 2: Add failing routing assertions for GitHub Actions and containers**

Type the local rules narrowly enough to inspect descriptions and matchers:

```ts
type RenovateRule = {
  description?: string;
  matchManagers?: string[];
  matchUpdateTypes?: string[];
  matchFileNames?: string[];
  addLabels?: string[];
  automerge?: boolean;
  dependencyDashboardApproval?: boolean;
  minimumReleaseAge?: string | false;
};
```

Then add assertions:

```ts
const rules = (renovate.packageRules ?? []) as RenovateRule[];
const byDescription = (description: string) => rules.find((rule) => rule.description === description);

expect(byDescription("Allow same-version GitHub Action digest refreshes outside protected workflows after required checks pass.")).toMatchObject({
  matchManagers: ["github-actions"],
  matchUpdateTypes: ["digest"],
  automerge: false,
});
expect(
  byDescription("Allow same-version GitHub Action digest refreshes outside protected workflows after required checks pass.")?.addLabels,
).not.toContain("manual-review");

expect(byDescription("Require manual review for non-digest GitHub Action updates.")?.addLabels).toContain("manual-review");
expect(byDescription("Require manual review for Actions changes in security, release, provenance, and publication workflows.")?.addLabels).toContain("manual-review");
expect(byDescription("Keep container base-image updates in the manual exception path.")?.addLabels).toContain("manual-review");
```

Retain the existing vulnerability assertion requiring `security`, `dependencies`, and `manual-review` and `automerge: false`.

- [ ] **Step 3: Stop asserting seven days on every local package rule**

Replace:

```ts
for (const rule of renovate.packageRules ?? []) {
  expect(rule.minimumReleaseAge).toBe("7 days");
}
```

with:

```ts
for (const rule of rules) {
  expect(rule.minimumReleaseAge).toBeUndefined();
}
```

The seven-day invariant now belongs to the shared preset test from Task 1; BoardReadyOps must not silently override it locally.

- [ ] **Step 4: Run focused tests and preserve RED**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/scripts/security-automation-config.test.ts \
  tests/unit/scripts/mergify-integration.test.ts
```

Expected: `security-automation-config.test.ts` FAILS because `renovate.json` still contains duplicated defaults and the blanket GitHub Actions/manual-review rule. `mergify-integration.test.ts` remains PASS, proving merge authority itself is unchanged.

- [ ] **Step 5: Commit the failing contract tests**

```bash
git add tests/unit/scripts/security-automation-config.test.ts
git commit -m "test(deps): define autonomous maintenance routing"
```

### Task 3: Migrate BoardReadyOps Renovate configuration to the shared baseline

**Repository:** `oaslananka/boardreadyops`

**Files:**
- Modify: `renovate.json`

**Interfaces:**
- Consumes: Task 1 shared preset; Task 2 policy tests.
- Produces: repository-local Renovate policy that inherits common queue controls and routes low-risk Action digests through normal Mergify admission while protecting sensitive workflows.

- [ ] **Step 1: Replace duplicated common preset/default configuration**

Change the top of `renovate.json` to:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>oaslananka/.github:renovate-config",
    "security:openssf-scorecard",
    ":separatePatchReleases"
  ],
  "enabledManagers": ["npm", "github-actions", "dockerfile", "docker-compose"],
  "schedule": ["after 5am and before 8am every weekday"],
  "ignorePaths": ["**/.next/**", "**/node_modules/**", "**/dist/**", "**/coverage/**", "tests/fixtures/**", "tmp/**"],
  "labels": ["dependencies"],
  "rangeStrategy": "replace",
  "rebaseWhen": "conflicted"
}
```

Use that snippet as the common-property shape, then retain the existing post-update/post-upgrade, lockfile, packageRules, vulnerability-alert, and OSV objects described below. Remove local `timezone`, `minimumReleaseAge`, `dependencyDashboardTitle`, `pinDigests`, `prCreation`, `internalChecksFilter`, `prHourlyLimit`, `prConcurrentLimit`, and `branchConcurrentLimit`. Their shared behavior comes from Task 1 except `prCreation`, which intentionally returns to Renovate's normal immediate PR creation after strict minimum-age filtering.

- [ ] **Step 2: Keep BoardReadyOps lockfile behavior explicit but non-automerge**

Use:

```json
"lockFileMaintenance": {
  "enabled": true,
  "schedule": ["before 6am on monday"],
  "automerge": false,
  "addLabels": ["lockfile-maintenance"]
}
```

This keeps the BoardReadyOps-specific label while remaining compatible with the shared baseline.

- [ ] **Step 3: Remove duplicated `minimumReleaseAge` fields from local package rules**

Keep the existing low-risk developer-tooling, `@types/*`, TypeScript, core runtime/GitHub integration, and major rules, but delete their local `minimumReleaseAge: "7 days"` properties. Preserve:

```json
{
  "description": "Allow Mergify to auto-merge low-risk development dependency updates after required checks pass.",
  "matchDepTypes": ["devDependencies"],
  "matchUpdateTypes": ["minor", "patch", "pin", "digest"],
  "groupName": "developer tooling (non-major)",
  "addLabels": ["automerge"]
}
```

and the existing TypeScript/core-runtime/major `manual-review` routing.

- [ ] **Step 4: Split the blanket Actions/container rule into risk-specific rules**

Delete the current combined rule matching `github-actions`, `dockerfile`, and `docker-compose`. Add these four rules in this order:

```json
{
  "description": "Allow same-version GitHub Action digest refreshes outside protected workflows after required checks pass.",
  "matchManagers": ["github-actions"],
  "matchUpdateTypes": ["digest"],
  "automerge": false,
  "addLabels": ["supply-chain"]
},
{
  "description": "Require manual review for non-digest GitHub Action updates.",
  "matchManagers": ["github-actions"],
  "matchUpdateTypes": ["major", "minor", "patch", "pin", "pinDigest", "rollback", "bump", "replacement"],
  "automerge": false,
  "addLabels": ["supply-chain", "manual-review"]
},
{
  "description": "Require manual review for Actions changes in security, release, provenance, and publication workflows.",
  "matchManagers": ["github-actions"],
  "matchFileNames": [
    ".github/workflows/security.yml",
    ".github/workflows/osv.yml",
    ".github/workflows/trivy.yml",
    ".github/workflows/release-please.yml",
    ".github/workflows/provenance.yml",
    ".github/workflows/container-build.yml",
    ".github/workflows/publish-npm.yml",
    ".github/workflows/binary-build.yml"
  ],
  "automerge": false,
  "addLabels": ["supply-chain", "manual-review"]
},
{
  "description": "Keep container base-image updates in the manual exception path.",
  "matchManagers": ["dockerfile", "docker-compose"],
  "pinDigests": true,
  "automerge": false,
  "addLabels": ["supply-chain", "manual-review"]
}
```

Because Renovate merges all matching package rules, an Action digest touching a protected workflow receives `manual-review` from the later protected-workflow rule and remains outside Mergify. A digest that touches only non-protected workflows receives no blocking label and can enter the normal queue after Ruleset checks pass.

- [ ] **Step 5: Keep security vulnerability remediation repository-local and manual**

Do not change this behavior:

```json
"vulnerabilityAlerts": {
  "enabled": true,
  "labels": ["security", "dependencies", "manual-review"],
  "minimumReleaseAge": null,
  "schedule": [],
  "prCreation": "immediate",
  "automerge": false,
  "vulnerabilityFixStrategy": "lowest"
},
"osvVulnerabilityAlerts": true
```

- [ ] **Step 6: Run focused tests and Renovate validation**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/scripts/security-automation-config.test.ts \
  tests/unit/scripts/mergify-integration.test.ts
corepack pnpm run renovate:validate
```

Expected: all PASS; Renovate validator exits 0.

- [ ] **Step 7: Commit the configuration migration**

```bash
git add renovate.json
git commit -m "chore(deps): adopt shared maintenance policy"
```

### Task 4: Update BoardReadyOps dependency-automation documentation to describe human-on-exception behavior

**Repository:** `oaslananka/boardreadyops`

**Files:**
- Modify: `docs/dependency-automation.md`

**Interfaces:**
- Consumes: final `renovate.json`, existing Ruleset/Mergify behavior.
- Produces: operator documentation that distinguishes shared defaults, local exceptions, and merge authority.

- [ ] **Step 1: Replace the policy section with the effective ownership model**

Document these exact behaviors:

```markdown
## Policy layers

`renovate.json` extends `github>oaslananka/.github:renovate-config`.
The shared preset owns the seven-day routine release quarantine, strict internal age filtering,
two new PRs per hour, five concurrent PRs, digest pinning, weekly lockfile maintenance defaults,
and Dependency Dashboard approval for major upgrades.

BoardReadyOps owns its weekday schedule, managed package managers, generated NOTICE/dist refresh,
protected package groups, vulnerability-PR policy, and merge routing.

## Automatic path

Low-risk development dependency and `@types/*` non-major updates remain eligible for the normal
Mergify queue. Same-version GitHub Action digest refreshes are also eligible when they do not touch
security, release, provenance, publication, container-release, or binary-release workflows.
Eligibility never bypasses GitHub Rulesets: required checks must pass before queue admission and
again before merge.

## Exception path

Major updates, TypeScript, core runtime/GitHub integration dependencies, vulnerability-remediation
PRs, non-digest GitHub Action updates, Actions changes in protected workflows, and Dockerfile/Docker
Compose updates carry `manual-review` and remain outside the automatic queue until a maintainer
clears the exception.
```

- [ ] **Step 2: Explain why `prCreation: not-pending` is removed**

Add an operations note:

```markdown
Routine minimum-age waiting is enforced by Renovate's strict internal checks before branch creation.
BoardReadyOps CI begins on `pull_request`, not on bare Renovate branches, so the repository does not
use `prCreation: not-pending`; otherwise a dependency branch can wait for checks that cannot start
until the pull request exists.
```

- [ ] **Step 3: Update the operations checklist**

The checklist must require:

```markdown
1. Confirm the shared preset resolves successfully.
2. Run `corepack pnpm run renovate:validate` after policy changes.
3. Confirm `security-automation-config.test.ts` and `mergify-integration.test.ts` pass.
4. Confirm `manual-review` is present on protected updates and absent from an eligible low-risk update.
5. Confirm the PR receives the repository's required Ruleset checks before Mergify admits it.
6. Treat any low-risk PR that stays open after green required checks as an automation defect.
```

- [ ] **Step 4: Run documentation and focused repository checks**

Run:

```bash
corepack pnpm exec vitest run \
  tests/unit/scripts/security-automation-config.test.ts \
  tests/unit/scripts/mergify-integration.test.ts
corepack pnpm run renovate:validate
task docs
git diff --check
```

Expected: all PASS and `git diff --check` produces no output.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/dependency-automation.md
git commit -m "docs(deps): document exception-based maintenance"
```

### Task 5: Verify the complete BoardReadyOps migration and open the protected implementation PR

**Repository:** `oaslananka/boardreadyops`

**Files:**
- Verify only: `renovate.json`
- Verify only: `tests/unit/scripts/security-automation-config.test.ts`
- Verify only: `tests/unit/scripts/mergify-integration.test.ts`
- Verify only: `.mergify.yml`
- Verify only: `.github/rulesets/main.json`
- Verify only: `docs/dependency-automation.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: one protected BoardReadyOps implementation PR ready for normal Ruleset/Mergify handling.

- [ ] **Step 1: Verify the central preset exists on `.github/main` before enabling the BoardReadyOps reference**

Run:

```bash
gh api repos/oaslananka/.github/contents/renovate-config.json --jq '.path + " " + .sha'
```

Expected: `renovate-config.json <sha>`; a 404 blocks this task because BoardReadyOps must not merge a dangling preset reference.

- [ ] **Step 2: Run focused policy tests and validator**

```bash
corepack pnpm exec vitest run \
  tests/unit/scripts/security-automation-config.test.ts \
  tests/unit/scripts/mergify-integration.test.ts
corepack pnpm run renovate:validate
```

Expected: PASS.

- [ ] **Step 3: Run the repository verification gate**

```bash
task verify
git diff --check
```

Expected: PASS; no uncommitted generated drift remains.

- [ ] **Step 4: Inspect the final policy diff before PR creation**

Run:

```bash
git diff main...HEAD -- renovate.json docs/dependency-automation.md tests/unit/scripts/security-automation-config.test.ts
```

Verify from the diff that:

```text
shared preset reference added
prHourlyLimit 3 removed locally -> shared value 2
prConcurrentLimit 8 removed locally -> shared value 5
branchConcurrentLimit 10 removed locally -> inherits shared PR concurrency bound
prCreation not-pending removed
vulnerabilityAlerts remains immediate + manual-review + automerge false
GitHub Action digest rule has no manual-review
protected workflow rule adds manual-review
non-digest Action rule adds manual-review
Docker/Docker Compose rule adds manual-review
no Renovate automerge:true introduced
```

- [ ] **Step 5: Open the BoardReadyOps implementation PR without bypass**

Use a conventional title:

```text
chore(deps): adopt exception-based maintenance policy
```

The PR body must state that GitHub Rulesets and Mergify are unchanged, list the inherited limits (`2/hour`, `5 concurrent`), and call out the one newly autonomous class: non-protected GitHub Action digest refreshes.

Do not apply `manual-review` to the implementation PR solely to test the label; let normal governance classify it based on the actual change. Do not use an administrator bypass.

- [ ] **Step 6: Verify PR checks and merge-queue behavior**

After the PR exists, confirm:

```text
all required Ruleset checks are present
security / gate reaches success
CI aggregate checks reach success
Mergify does not report a missing injected Ruleset requirement
no direct-push or bypass path is used
```

If any required check is absent, stop the rollout and fix the check-triggering problem instead of weakening the Ruleset.

- [ ] **Step 7: Post-merge operational acceptance**

Manually dispatch the existing `renovate` workflow once after the BoardReadyOps migration reaches `main`. Inspect the updated Dependency Dashboard and the next naturally available low-risk update.

Acceptance is:

```text
routine PR creation is bounded by shared 2/hour and 5-concurrent policy
major/security/protected updates remain in the manual exception path
an eligible low-risk PR receives required checks and enters Mergify without maintainer approval
failed checks prevent merge
```

If no eligible low-risk update exists on that run, do not manufacture a dependency change; the static policy tests and merge integration remain the release gate, and the next natural low-risk Renovate PR supplies the live acceptance evidence.

### Task 6: Record rollout evidence and stop before migrating other repositories

**Repository:** `oaslananka/boardreadyops`

**Files:**
- Modify only if evidence is available after Task 5: `docs/dependency-automation.md`

**Interfaces:**
- Consumes: merged `.github` preset PR, merged BoardReadyOps migration PR, Renovate workflow result.
- Produces: dated operational evidence for the first repository and a clean boundary before the next repository-specific plan.

- [ ] **Step 1: Record the verified shared preset and BoardReadyOps run**

Under `## Last verification`, update only facts that were actually observed: preset commit SHA, BoardReadyOps implementation PR number, Renovate workflow run ID, and whether a representative low-risk PR auto-entered Mergify. Do not claim live automerge evidence if no eligible update existed.

- [ ] **Step 2: Run documentation checks if evidence text changed**

```bash
task docs
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Commit evidence separately**

If documentation changed:

```bash
git add docs/dependency-automation.md
git commit -m "docs(deps): record maintenance rollout evidence"
```

- [ ] **Step 4: Stop this plan**

Do not modify `debug-recorder-mcp`, `kicad-studio-kit`, or `kicad-mcp-pro` under this implementation plan. Each repository gets a separate plan after its current dependency-bot ownership, Ruleset/check topology, and protected dependency groups are re-read.
