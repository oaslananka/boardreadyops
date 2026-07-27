# Synthetic Target-Repository Canaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public/private target-repository synthetic canary automation that exercises the production pull-request webhook, target-repository workflow dispatch, OIDC callback, and Check Run publication path while preventing tests from mutating tracked KiCad fixtures.

**Architecture:** First make `runFixture()` execute against disposable copies so real KiCad side effects never dirty tracked fixtures. Then add a dependency-injected Node.js canary library and CLI that uses the caller repository's short-lived `GITHUB_TOKEN` to update a persistent PR and verify exact-SHA Check Run and workflow convergence. A reusable GitHub Actions workflow checks out the implementation commit by `github.workflow_sha`, invokes the CLI, and leaves scheduling to thin public/private repository wrappers.

**Tech Stack:** Node.js 22 ESM, TypeScript declaration files, Vitest 4, GitHub REST API, GitHub Actions reusable workflows, KiCad 10, MkDocs Material.

## Global Constraints

- Work only on `feat/190-synthetic-canaries` in the isolated worktree.
- Do not grant the production BoardReadyOps GitHub App new permissions.
- Use only the caller repository's short-lived `GITHUB_TOKEN` for canary mutations and observations.
- Keep private source, workflow logs, artifacts, findings, credentials, OIDC claims, and raw GitHub response bodies out of canary output.
- Use exact repository, SHA, Check Run name, workflow ID, workflow event, and HTTPS origin comparisons.
- Bound polling by both elapsed duration and request count.
- Keep the reusable workflow callable only through `workflow_call`; schedules remain in the dedicated canary repositories.
- Keep known 12 PostgreSQL integration-test lint warnings unchanged.
- Use TDD for every behavior change: write the failing test, observe the intended failure, implement minimally, and rerun.

---

### Task 1: Make rule fixtures immutable during tests

**Files:**
- Modify: `tests/unit/rules/helpers.ts`
- Create: `tests/unit/rules/helpers.test.ts`

**Interfaces:**
- Consumes: existing `copyFixture(fixture: string, removeConfig?: boolean): Promise<string>` and `runPipeline()`.
- Produces: `runFixture(fixture, options)` with the same result contract, but always executing on a disposable recursive copy and removing that copy after execution.

- [ ] **Step 1: Write the failing source-fixture immutability test**

Create `tests/unit/rules/helpers.test.ts` with a test that snapshots the two package-completeness source directories before and after real fixture execution:

```ts
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFixture } from "./helpers.js";

const fixtureRoot = path.resolve("tests/fixtures/projects");
const fixtureNames = ["package-completeness-missing", "package-completeness-pass"] as const;

async function snapshotFixture(name: string): Promise<Record<string, string>> {
  const root = path.join(fixtureRoot, name);
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => {
        const content = await fs.readFile(path.join(root, file));
        return [file, createHash("sha256").update(content).digest("hex")] as const;
      }),
    ),
  );
}

describe("rule fixture isolation", () => {
  it("does not create or modify files in tracked package-completeness fixtures", async () => {
    const before = Object.fromEntries(
      await Promise.all(fixtureNames.map(async (name) => [name, await snapshotFixture(name)] as const)),
    );

    await runFixture("package-completeness-missing");
    await runFixture("package-completeness-pass");

    const after = Object.fromEntries(
      await Promise.all(fixtureNames.map(async (name) => [name, await snapshotFixture(name)] as const)),
    );
    expect(after).toEqual(before);
    expect(Object.keys(after["package-completeness-missing"])).not.toContain(
      "package-completeness-missing.kicad_prl",
    );
    expect(Object.keys(after["package-completeness-pass"])).not.toContain(
      "package-completeness-pass.kicad_prl",
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
rm -f tests/fixtures/projects/package-completeness-{missing,pass}/package-completeness-*.kicad_prl
pnpm exec vitest run tests/unit/rules/helpers.test.ts
```

Expected: FAIL because the current `runFixture()` invokes KiCad inside the tracked fixture directories and creates `.kicad_prl` files.

- [ ] **Step 3: Implement disposable fixture execution**

Change `runFixture()` in `tests/unit/rules/helpers.ts` to copy the fixture, force the copied path into the pipeline input, preserve the caller's `failOn` override, and clean up without masking a pipeline failure:

```ts
export async function runFixture(
  fixture: string,
  options: Omit<Partial<Parameters<typeof runPipeline>[0]>, "path"> = {},
): Promise<RunResult> {
  const temp = await copyFixture(fixture);
  let pipelineFailed = false;
  try {
    return await runPipeline({ ...options, path: temp, failOn: options.failOn ?? "never" });
  } catch (error) {
    pipelineFailed = true;
    throw error;
  } finally {
    try {
      await fs.rm(temp, { recursive: true, force: true });
    } catch (error) {
      if (!pipelineFailed) throw error;
    }
  }
}
```

- [ ] **Step 4: Run focused and neighboring tests**

Run:

```bash
pnpm exec vitest run tests/unit/rules/helpers.test.ts tests/unit/rules/manufacturing/package-completeness.test.ts tests/unit/rules/bom/risk-score.test.ts
```

Expected: all tests PASS and `git status --short` contains no `.kicad_prl` files.

- [ ] **Step 5: Commit fixture isolation**

```bash
git add tests/unit/rules/helpers.ts tests/unit/rules/helpers.test.ts
git commit -m "test(core): isolate rule fixtures"
```

---

### Task 2: Add the synthetic canary mutation and verification engine

**Files:**
- Create: `scripts/synthetic-target-repository-canary.mjs`
- Create: `scripts/synthetic-target-repository-canary.d.mts`
- Create: `scripts/run-synthetic-target-repository-canary.mjs`
- Create: `tests/unit/scripts/synthetic-target-repository-canary.test.ts`

**Interfaces:**
- Produces `readSyntheticCanaryOptions(env)`, `updateSyntheticCanaryPullRequest(options, dependencies)`, `verifySyntheticCanary(options, expectedSha, dependencies)`, and `runSyntheticCanary(options, dependencies)`.
- `SyntheticCanaryOptions` contains repository, token, expected visibility, branch, PR title, nonce path, Check Run name, readiness workflow filename, public origin, timeout milliseconds, polling interval milliseconds, and maximum requests.
- Dependency injection accepts `request`, `sleep`, `now`, and `log`; tests never contact GitHub.
- The CLI reads environment variables, writes a privacy-safe GitHub step summary when `GITHUB_STEP_SUMMARY` exists, prints one bounded JSON result, and exits nonzero with a stable reason code on failure.

- [ ] **Step 1: Write failing option-validation tests**

Add tests for:

```ts
expect(() => readSyntheticCanaryOptions({})).toThrow("GITHUB_REPOSITORY is required");
expect(() =>
  readSyntheticCanaryOptions({
    GITHUB_REPOSITORY: "oaslananka/boardreadyops-canary-public",
    GITHUB_TOKEN: "token",
    BOARDREADYOPS_CANARY_VISIBILITY: "internal",
  }),
).toThrow("BOARDREADYOPS_CANARY_VISIBILITY must be public or private");
```

Also assert defaults: branch `boardreadyops-canary`, PR title `chore: BoardReadyOps synthetic canary`, nonce path `canary/nonce.txt`, Check Run name `BoardReadyOps / release readiness`, readiness workflow `readiness-runner.yml`, origin `https://boardreadyops.oaslananka.dev`, timeout 20 minutes, interval 15 seconds, and a finite request cap.

- [ ] **Step 2: Run the new test and verify RED**

```bash
pnpm exec vitest run tests/unit/scripts/synthetic-target-repository-canary.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement options and safe GitHub request handling**

Implement strict owner/repository, branch, path, workflow filename, URL origin, positive integer, and visibility parsing. Add a `SyntheticCanaryError` with `reason`, `message`, and bounded safe details. Implement `githubJson()` so errors include only HTTP status and operation name, never the response body.

- [ ] **Step 4: Write failing mutation-flow tests**

Use a deterministic request queue and assert the engine:

1. reads repository metadata and verifies visibility/default branch;
2. reads `refs/heads/main` and its commit tree;
3. creates a nonce blob containing timestamp, workflow run ID, and run attempt;
4. creates a tree and commit with the current default-branch commit as parent;
5. creates `refs/heads/boardreadyops-canary` when absent or force-updates it when present;
6. reuses an open persistent PR or creates it when absent; and
7. returns the exact created commit SHA.

The test must assert exact REST paths and payloads, including `force: true` only for branch update.

- [ ] **Step 5: Run mutation tests and verify RED**

Run the focused test file. Expected: FAIL on the first unimplemented mutation function.

- [ ] **Step 6: Implement the minimal mutation flow**

Use only GitHub REST endpoints under the caller repository. Encode the nonce blob as UTF-8, use mode `100644`, type `blob`, one parent commit, and fixed branch/PR names from options. Treat ref lookup `404` as branch creation; all other non-success responses use `canary_github_api_unavailable`.

- [ ] **Step 7: Run mutation tests and verify GREEN**

Expected: all mutation tests PASS.

- [ ] **Step 8: Write failing convergence-verification tests**

Add tests that prove the verifier:

- polls Check Runs for the exact expected SHA and name;
- fetches the matched Check Run by ID;
- requires `completed/success`;
- requires lowercase UUID `external_id`;
- requires `details_url` to use the configured HTTPS origin;
- extracts exactly one same-repository `/actions/runs/<id>` URL from the Reports section;
- resolves `readiness-runner.yml` to a workflow ID;
- requires the referenced run to belong to the same repository, use `workflow_dispatch`, match the workflow ID, and finish successfully;
- returns `canary_check_run_failed`, `canary_check_run_binding_invalid`, `canary_workflow_missing`, `canary_workflow_failed`, or the appropriate timeout code without exposing response bodies; and
- stops when either timeout or request cap is reached.

- [ ] **Step 9: Run verification tests and verify RED**

Expected: FAIL because verification is not implemented.

- [ ] **Step 10: Implement bounded verification**

Track whether a matching Check Run or workflow run has ever been observed. Use that state to distinguish missing from timeout. Poll with the injected clock/sleep and increment a single request counter for every REST call. Parse only the fixed Reports section and same-repository Actions run URL.

- [ ] **Step 11: Add CLI tests and implementation**

Test `runSyntheticCanary()` success and failure result shapes. Implement the CLI with:

```js
const result = await runSyntheticCanary(readSyntheticCanaryOptions(process.env));
process.stdout.write(`${JSON.stringify(result)}\n`);
```

On `SyntheticCanaryError`, print only `{ ok: false, reason, repository, visibility, expectedSha, elapsedMs, checkRunUrl?, workflowUrl? }`, append the same safe fields to `GITHUB_STEP_SUMMARY`, and set `process.exitCode = 1`.

- [ ] **Step 12: Run focused tests, typecheck, and lint**

```bash
pnpm exec vitest run tests/unit/scripts/synthetic-target-repository-canary.test.ts
pnpm run typecheck
pnpm run lint
```

Expected: tests and typecheck PASS; lint has only the existing 12 warnings.

- [ ] **Step 13: Commit the canary engine**

```bash
git add scripts/synthetic-target-repository-canary.mjs scripts/synthetic-target-repository-canary.d.mts scripts/run-synthetic-target-repository-canary.mjs tests/unit/scripts/synthetic-target-repository-canary.test.ts
git commit -m "feat(ci): add target-repository canary engine"
```

---

### Task 3: Add the pinned reusable canary workflow

**Files:**
- Create: `.github/workflows/synthetic-target-repository-canary.yml`
- Create: `tests/unit/scripts/synthetic-target-repository-canary-workflow.test.ts`

**Interfaces:**
- `workflow_call` inputs: `visibility` (required), `timeout-seconds` (default `1200`), `poll-interval-seconds` (default `15`), `public-origin` (default production origin), and `readiness-workflow` (default `readiness-runner.yml`).
- Uses caller `github.token`; no custom secret input.
- Checks out `oaslananka/boardreadyops` at `${{ github.workflow_sha }}` into `_boardreadyops-canary` with persisted credentials disabled, then runs the CLI with caller repository context.

- [ ] **Step 1: Write the failing static workflow contract test**

Assert the workflow contains:

```ts
expect(workflow).toContain("workflow_call:");
expect(workflow).toContain("actions: read");
expect(workflow).toContain("checks: read");
expect(workflow).toContain("contents: write");
expect(workflow).toContain("pull-requests: write");
expect(workflow).toContain("repository: oaslananka/boardreadyops");
expect(workflow).toContain("ref: $" + "{{ github.workflow_sha }}");
expect(workflow).toContain("persist-credentials: false");
expect(workflow).toContain("node _boardreadyops-canary/scripts/run-synthetic-target-repository-canary.mjs");
expect(workflow).toContain("GITHUB_TOKEN: $" + "{{ github.token }}");
expect(workflow).not.toContain("pull_request_target");
expect(workflow).not.toContain("secrets:");
```

Also parse YAML and assert one job, `ubuntu-latest`, `timeout-minutes: 30`, and a concurrency group scoped to the caller repository with `cancel-in-progress: false`.

- [ ] **Step 2: Run the workflow test and verify RED**

Expected: FAIL because the workflow file is absent.

- [ ] **Step 3: Implement the reusable workflow**

Create a `workflow_call`-only workflow with minimal permissions. Validate `visibility` in a shell step before invoking the CLI. Pass inputs through environment variables and use `github.repository`, `github.run_id`, and `github.run_attempt` from the caller context.

- [ ] **Step 4: Run workflow tests and security linters**

```bash
pnpm exec vitest run tests/unit/scripts/synthetic-target-repository-canary-workflow.test.ts
pnpm run workflow:lint
```

Expected: Vitest, actionlint, and zizmor PASS.

- [ ] **Step 5: Commit the reusable workflow**

```bash
git add .github/workflows/synthetic-target-repository-canary.yml tests/unit/scripts/synthetic-target-repository-canary-workflow.test.ts
git commit -m "feat(ci): add reusable target canary workflow"
```

---

### Task 4: Document provisioning, schedules, diagnosis, and recovery

**Files:**
- Create: `docs/operations/synthetic-target-repository-canaries.md`
- Modify: `docs/deployment/github-actions-execution.md`
- Modify: `docs/operations/control-plane-reconciliation.md`
- Modify: `mkdocs.yml`
- Modify: `tests/unit/docs/control-plane-operations-docs.test.ts`

**Interfaces:**
- Public repository wrapper calls the reusable workflow every six hours at minute 17.
- Private repository wrapper calls it every six hours at minute 47.
- Both wrappers pin `oaslananka/boardreadyops/.github/workflows/synthetic-target-repository-canary.yml@<full-commit-sha>` and support manual dispatch.
- Runbook defines provisioning, GitHub App installation, Actions setting that permits PR creation, commissioning, stable reason codes, diagnosis, recovery, and retirement.

- [ ] **Step 1: Write failing documentation contract tests**

Extend `control-plane-operations-docs.test.ts` to require:

- the new runbook file and MkDocs navigation entry;
- both exact repository names;
- schedules `17 */6 * * *` and `47 */6 * * *`;
- `workflow_dispatch` and a reusable workflow pin using the actual full workflow commit SHA;
- all stable reason codes;
- no long-lived PAT requirement;
- no new BoardReadyOps App permission;
- public/private visibility verification;
- Check Run exact-SHA and workflow-dispatch verification;
- incident correlation with SLI, readiness, reconciliation events, and GitHub status; and
- links from GitHub Actions execution and reconciliation docs.

- [ ] **Step 2: Run docs tests and verify RED**

```bash
pnpm exec vitest run tests/unit/docs/control-plane-operations-docs.test.ts
```

Expected: FAIL because the runbook and links are absent.

- [ ] **Step 3: Write the operations runbook and wrapper examples**

Document exact thin wrapper YAML for each repository. After Task 3 is committed, read its full SHA with `git rev-parse HEAD` and use that exact 40-character value in both wrapper examples. The examples declare the four permissions, schedule/manual triggers, and concurrency with `cancel-in-progress: false`.

- [ ] **Step 4: Link navigation and related docs**

Add `Synthetic Target Canaries: operations/synthetic-target-repository-canaries.md` beside control-plane reconciliation in `mkdocs.yml`. Add concise links from the execution commissioning checklist and the reconciliation incident-response section.

- [ ] **Step 5: Run focused docs tests and strict docs build**

```bash
pnpm exec vitest run tests/unit/docs/control-plane-operations-docs.test.ts
PATH="/tmp/boardreadyops-docs-venv-feat190/bin:$PATH" pnpm run docs
```

Expected: tests and strict MkDocs build PASS.

- [ ] **Step 6: Run full verification for changed surfaces**

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run workflow:lint
PATH="/tmp/boardreadyops-docs-venv-feat190/bin:$PATH" pnpm run docs
```

Expected: all commands PASS; lint reports only the existing 12 warnings; no `.kicad_prl` files appear.

- [ ] **Step 7: Commit documentation**

```bash
git add docs/operations/synthetic-target-repository-canaries.md docs/deployment/github-actions-execution.md docs/operations/control-plane-reconciliation.md mkdocs.yml tests/unit/docs/control-plane-operations-docs.test.ts
git commit -m "docs(ci): add synthetic canary runbook"
```

---

### Task 5: Prepare merge and commissioning handoff

**Files:**
- Modify only if required by review findings from Tasks 1-4.

**Interfaces:**
- Produces a pushable branch and PR for `oaslananka/boardreadyops`.
- Live creation of `oaslananka/boardreadyops-canary-public` and `oaslananka/boardreadyops-canary-private` is a separate commissioning operation because the current operations connector exposes no repository-creation mutation.

- [ ] **Step 1: Review the complete diff against the approved spec**

Check exact spec coverage, stable reason-code consistency, workflow permissions, privacy boundaries, and that wrapper examples use the exact Task 3 workflow commit SHA.

- [ ] **Step 2: Run final clean-tree verification**

```bash
git status --short
git diff --check
pnpm run verify:structure
```

Expected: clean status after commits, no whitespace errors, and structure verification PASS.

- [ ] **Step 3: Push the feature branch and open a PR**

Push `feat/190-synthetic-canaries` and create a PR targeting `main`, referencing `Part of #190`. Do not merge until CI completes.

- [ ] **Step 4: Record commissioning prerequisites**

PR description must state that dedicated public/private repositories still need to be created, the production GitHub App installed, Actions PR creation enabled, wrapper workflows added with the merged full SHA, and manual commissioning runs captured before closing #190.
