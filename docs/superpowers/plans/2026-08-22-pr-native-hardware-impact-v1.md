# PR-Native Hardware Impact V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic PR-native hardware impact summary that compares the exact pull-request base SHA to the exact analyzed head SHA, keeps detailed baseline evidence inside the target repository, and publishes only a bounded structured impact model to BoardReadyOps Cloud.

**Architecture:** Reuse `diffRuns` and the existing fabrication/readiness/finding primitives to build a pure `HardwareImpactV1` model in the Action. Resolve historical evidence only from the same target-repository workflow identity at the exact base SHA; never fall back to “latest” or a branch approximation. Add `hardwareImpact` as an optional field to repository-owned `RunResult` JSON and the hosted terminal-result contract; Cloud persists it inside the existing tenant-scoped `release_run_results.payload` JSONB and renders the same facts/assessment semantics in Check Runs and optional PR comments.

**Tech Stack:** TypeScript 6, Node.js 22/24, Vitest 4, GitHub Actions/Octokit, Zod 4, Next.js control plane, PostgreSQL existing JSONB result persistence, Biome, CodeQL/Semgrep/Sonar/Codecov CI.

**Spec:** `docs/superpowers/specs/2026-08-22-pr-native-hardware-impact-v1-design.md`

## Global Constraints

- Baseline semantics are exact PR base SHA → exact trusted PR head SHA; there is no branch/latest-run fallback.
- If the analyzed checkout is not the trusted PR head SHA, emit `candidate-mismatch` and do not claim an authoritative comparison.
- `facts` contain observed deltas only; `assessment` is deterministic interpretation only.
- V1 domains are exactly `readiness`, `findings`, `bom`, and `manufacturing` in that fixed order.
- `hardwareImpact` is additive and optional; old `RunResult` readers and old terminal-result producers remain valid.
- Evidence references are capped at 12; `label`, `path`, and `ruleId` are capped at 256 characters.
- Raw previous/current artifacts and source remain inside the target repository. Cloud receives only the bounded impact object.
- No new GitHub App permission is added. The canonical target workflow may add only repository-scoped `actions: read` and `checks: read` to its short-lived `GITHUB_TOKEN`: artifact lookup needs Actions read access and hosted exact-base binding reads the already-created BoardReadyOps Check Run.
- Existing fork/private safe-mode decisions remain authoritative and must not be weakened.
- No new external dependency is required.
- No database migration is planned: the existing `release_run_results.payload` JSONB already persists the accepted normalized result. If implementation proves this assumption false, stop and re-review the design before adding a migration.
- Never log raw GitHub response bodies, downloaded artifact content, source text, credentials, tokens, OIDC claims, or private evidence values.

---

### Task 1: Build the deterministic `HardwareImpactV1` core model

**Files:**
- Create: `src/core/diff/hardware-impact.ts`
- Modify: `src/core/result.ts`
- Test: `tests/unit/core/hardware-impact.test.ts`
- Reuse: `src/core/diff/run.ts`
- Reuse: `src/core/diff/fabrication.ts`

**Interfaces:**
- Consumes: `diffRuns(previous: RunResult, current: RunResult): RunDiff`.
- Produces: `HardwareImpactV1`, `HardwareImpactBaselineReason`, and `buildHardwareImpact(input)`.
- Produces: optional `RunResult.hardwareImpact?: HardwareImpactV1` for repository-owned JSON output and later hosted forwarding.

- [ ] **Step 1: Write failing tests for available-baseline facts and stable ordering**

Create `tests/unit/core/hardware-impact.test.ts` with fixtures that construct two `RunResult` values and assert exact normalized facts:

```ts
import { describe, expect, it } from "vitest";
import { buildHardwareImpact } from "../../../src/core/diff/hardware-impact.js";
import type { RunResult } from "../../../src/core/result.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

it("separates exact-base changed facts from deterministic assessment", () => {
  const impact = buildHardwareImpact({
    baseline: { status: "available", sha: baseSha, result: previousRun() },
    candidate: { sha: headSha, result: currentRun() },
  });

  expect(impact).toMatchObject({
    version: 1,
    baseline: { status: "available", sha: baseSha },
    candidate: { sha: headSha },
    facts: {
      readiness: { previousScore: 82, currentScore: 71, scoreDelta: -11 },
      findings: { added: 2, resolved: 1, addedBlocking: 1, resolvedBlocking: 0 },
      bom: { added: 1, removed: 0, changed: 2 },
      manufacturing: { outputsAdded: 0, outputsRemoved: 0, outputsChanged: 1 },
    },
    assessment: {
      materialChange: true,
      riskDirection: "increased",
      affectedDomains: ["readiness", "findings", "bom", "manufacturing"],
    },
  });
  expect(impact.evidence.length).toBeLessThanOrEqual(12);
});
```

Add a second test that passes semantically identical inputs in different finding/output order and expects `buildHardwareImpact(...)` to return `toEqual(...)` identical output.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
corepack pnpm vitest run tests/unit/core/hardware-impact.test.ts
```

Expected: FAIL because `src/core/diff/hardware-impact.ts` and `buildHardwareImpact` do not exist.

- [ ] **Step 3: Implement the model and bounded evidence selection**

Create `src/core/diff/hardware-impact.ts` with these public shapes:

```ts
export type HardwareImpactDomain = "readiness" | "findings" | "bom" | "manufacturing";
export type HardwareImpactRiskDirection = "increased" | "decreased" | "unchanged" | "unknown";
export type HardwareImpactBaselineReason =
  | "not-found"
  | "invalid-artifact"
  | "unsupported-result"
  | "candidate-mismatch";

export type HardwareImpactBaseline =
  | { status: "available"; sha: string }
  | { status: "unavailable"; sha: string; reason: HardwareImpactBaselineReason };

export interface HardwareImpactEvidenceRef {
  domain: HardwareImpactDomain;
  kind: "finding" | "bom-row" | "output" | "readiness";
  label: string;
  path?: string;
  ruleId?: string;
  severity?: string;
}

export interface HardwareImpactV1 {
  version: 1;
  baseline: HardwareImpactBaseline;
  candidate: { sha: string };
  facts: {
    readiness: {
      previousScore: number | null;
      currentScore: number | null;
      scoreDelta: number | null;
      previousStatus: "ready" | "at-risk" | "blocked" | null;
      currentStatus: "ready" | "at-risk" | "blocked" | null;
      statusChanged: boolean;
    };
    findings: { added: number; resolved: number; addedBlocking: number; resolvedBlocking: number };
    bom: { added: number; removed: number; changed: number; truncated: boolean };
    manufacturing: { outputsAdded: number; outputsRemoved: number; outputsChanged: number };
  };
  assessment: {
    materialChange: boolean;
    riskDirection: HardwareImpactRiskDirection;
    affectedDomains: HardwareImpactDomain[];
  };
  evidence: HardwareImpactEvidenceRef[];
}

export function buildHardwareImpact(input:
  | {
      baseline: { status: "available"; sha: string; result: RunResult };
      candidate: { sha: string; result: RunResult };
    }
  | {
      baseline: { status: "unavailable"; sha: string; reason: HardwareImpactBaselineReason };
      candidate: { sha: string; result: RunResult };
    },
): HardwareImpactV1;
```

Implementation rules:

- available baseline: call `diffRuns` once, then map the reused diff into facts;
- blocking finding severities are `critical` and `high`;
- BOM counters come from fabrication rows by status;
- manufacturing counters come from fabrication output status;
- domain order is the fixed v1 order;
- risk precedence is increase → decrease → unknown → unchanged exactly as specified;
- unavailable baseline returns current readiness values where known, null previous values/delta, zero comparison counters, `materialChange:false`, `riskDirection:"unknown"`, empty domains/evidence;
- evidence labels are derived only from normalized finding/BOM/output/readiness values, sanitized by truncation to 256, sorted before `slice(0, 12)`;
- never use `generatedAt` or wall-clock time for assessment/order.

Modify `src/core/result.ts` only additively:

```ts
import type { HardwareImpactV1 } from "./diff/hardware-impact.js";

export interface RunResult {
  // existing fields unchanged
  hardwareImpact?: HardwareImpactV1 | undefined;
}
```

- [ ] **Step 4: Add RED/GREEN cases for risk direction and unavailable baseline**

Add tests for:

```ts
expect(improved.assessment.riskDirection).toBe("decreased");
expect(noChange.assessment).toEqual({
  materialChange: false,
  riskDirection: "unchanged",
  affectedDomains: [],
});
expect(unclassifiedChange.assessment.riskDirection).toBe("unknown");
expect(unavailable).toMatchObject({
  baseline: { status: "unavailable", reason: "not-found" },
  assessment: { materialChange: false, riskDirection: "unknown", affectedDomains: [] },
  evidence: [],
});
```

Run:

```bash
corepack pnpm vitest run tests/unit/core/run-diff.test.ts tests/unit/core/hardware-impact.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the core model**

```bash
git add src/core/diff/hardware-impact.ts src/core/result.ts tests/unit/core/hardware-impact.test.ts
git commit -S -m "feat(core): add deterministic hardware impact model"
```

---

### Task 2: Add exact-base workflow-bound resolution without breaking the legacy full-report lookup

**Files:**
- Modify: `src/action/previous-result.ts`
- Test: `tests/unit/action/previous-result.test.ts`

**Interfaces:**
- Consumes: repository-scoped token, owner/repo, artifact name, exact base/head/analyzed SHA, current GitHub run ID.
- Produces: `loadExactBaseRunResult(input): Promise<ExactBaseRunResultLookup>`.
- Preserves the existing `loadPreviousRunResult(...)` API for the legacy full-report fabrication-diff path; #447 review impact does not silently change that unrelated behavior.
- Produces bounded unavailable reasons only; no raw GitHub/API/parser errors escape into `HardwareImpactV1`.

- [ ] **Step 1: Write failing exact-base resolver tests**

Keep the existing legacy lookup tests and add a separate exact-base test block for the new contract:

```ts
it("selects only the same workflow identity at the exact base SHA", async () => {
  const result = await loadExactBaseRunResult({
    token: "token",
    owner: "octo",
    repo: "board",
    artifactName: "boardreadyops",
    baseSha: "a".repeat(40),
    candidateSha: "b".repeat(40),
    analyzedSha: "b".repeat(40),
    currentRunId: 900,
  });

  expect(result).toMatchObject({ status: "available", baseSha: "a".repeat(40) });
});
```

Add tests proving:

- a newer run on the base branch with the wrong `head_sha` is ignored;
- another workflow with the same `head_sha` is ignored;
- several eligible exact-base runs are sorted by numeric run ID descending independent of API order;
- `candidateSha !== analyzedSha` returns `candidate-mismatch` before artifact/API discovery;
- no matching named artifact returns `not-found`;
- named artifact with malformed/non-BoardReadyOps JSON returns `invalid-artifact`;
- BoardReadyOps JSON lacking the v1 comparison shape returns `unsupported-result`;
- the current run ID is never considered as baseline.

- [ ] **Step 2: Run resolver tests and verify RED**

```bash
corepack pnpm vitest run tests/unit/action/previous-result.test.ts
```

Expected: FAIL on the new `loadExactBaseRunResult` API and exact-SHA expectations.

- [ ] **Step 3: Implement exact workflow identity resolution**

Use the current workflow run as the identity anchor:

```ts
export type ExactBaseRunResultLookup =
  | { status: "available"; baseSha: string; runId: number; result: RunResult }
  | { status: "unavailable"; baseSha: string; reason: HardwareImpactBaselineReason };
```

Implementation order:

1. validate lowercase 40-char base/candidate/analyzed SHA and candidate binding;
2. call `actions.getWorkflowRun({ owner, repo, run_id: currentRunId })` and read its numeric `workflow_id`;
3. list completed runs for that exact workflow identity and exact `head_sha=baseSha` (paginate rather than relying on the first repository page);
4. remove current run ID, sort eligible run IDs descending;
5. for each run, use `DefaultArtifactClient` with `findBy.workflowRunId` and the exact configured artifact name;
6. download into a temporary directory and always remove it in `finally`;
7. classify discovered payloads as supported / invalid / unsupported without copying parse text to returned errors.

Add a stronger comparison parser (do not weaken `findRunResultArtifact` for legacy callers). The comparison parser must validate all fields consumed by `diffRuns`: `schemaVersion`, BoardReadyOps tool identity, `generatedAt`, findings, fabrication BOM/outputs, and optional readiness/status/release mode. Do not cast arbitrary JSON directly to `RunResult` before structural validation.

- [ ] **Step 4: Verify resolver determinism and cleanup**

Run:

```bash
corepack pnpm vitest run tests/unit/action/previous-result.test.ts tests/unit/core/hardware-impact.test.ts
```

Expected: PASS, including shuffled API response order and temp-directory cleanup cases.

- [ ] **Step 5: Commit the resolver**

```bash
git add src/action/previous-result.ts tests/unit/action/previous-result.test.ts
git commit -S -m "feat(action): resolve exact PR base evidence"
```

---

### Task 3: Compose impact in the Action and render it in the repository-owned review output

**Files:**
- Create: `src/action/hardware-impact.ts`
- Modify: `src/action/index.ts`
- Modify: `src/report/review-comment.ts`
- Modify: `src/action/comment.ts`
- Test: `tests/unit/action/hardware-impact.test.ts`
- Test: `tests/unit/report/review-comment.test.ts`
- Test: `tests/action/action.test.ts`

**Interfaces:**
- Consumes: `loadExactBaseRunResult`, `buildHardwareImpact`, GitHub PR context or the canonical hosted workflow env bindings.
- Produces: `buildActionHardwareImpact(result, context): Promise<HardwareImpactV1 | undefined>`.
- Produces: repository JSON artifact containing `RunResult.hardwareImpact` automatically through existing `formatJson`.

- [ ] **Step 1: Write failing context/binding tests**

Create `tests/unit/action/hardware-impact.test.ts` covering both supported invocation forms:

```ts
it("uses trusted pull_request base/head SHAs", async () => {
  // payload.pull_request.base.sha and payload.pull_request.head.sha
});

it("uses the hosted BoardReadyOps Check Run as the trusted base binding", async () => {
  process.env.BOARDREADYOPS_PR_HEAD_SHA = "b".repeat(40);
  process.env.BOARDREADYOPS_CLOUD_RUN_ID = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
  // Mock the matching Check Run: exact head SHA + external_id run ID + bounded base-SHA marker.
});
```

Also assert that no PR context/bindings or no repository-scoped token makes impact generation non-applicable rather than inventing a baseline reason.

- [ ] **Step 2: Implement Action impact composition**

`src/action/hardware-impact.ts` should:

- resolve trusted base/head from `github.context.payload.pull_request` first; for hosted `workflow_dispatch`, require `BOARDREADYOPS_PR_HEAD_SHA` plus `BOARDREADYOPS_CLOUD_RUN_ID`, read the matching BoardReadyOps Check Run at that exact head SHA, require `external_id === BOARDREADYOPS_CLOUD_RUN_ID`, and parse only the bounded `Impact base SHA: <40hex>` marker;
- read actual checkout SHA with `execFile("git", ["rev-parse", "HEAD"], { cwd: workspace })`, never with a shell string;
- require `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and numeric `GITHUB_RUN_ID` before repository API discovery;
- call `loadExactBaseRunResult`;
- pass either the available baseline result or bounded unavailable reason into `buildHardwareImpact`;
- return `undefined` when the current run is not a PR comparison context at all.

In `src/action/index.ts`, compute impact immediately after `runPipeline` and before JSON/Markdown/output generation:

```ts
const pipelineResult = await runPipeline(...);
const hardwareImpact = await buildActionHardwareImpact(pipelineResult, { workspace });
const result: RunResult = hardwareImpact ? { ...pipelineResult, hardwareImpact } : pipelineResult;
```

All existing output/render/upload calls then consume the enriched `result`, so `formatJson(result)` carries the structured model without a second artifact format.

- [ ] **Step 3: Write failing review renderer tests**

Add a test to `tests/unit/report/review-comment.test.ts` expecting distinct sections:

```ts
expect(body).toContain("### Hardware impact");
expect(body).toContain("Material change · risk increased · 3 affected domains");
expect(body).toContain("#### Changed facts");
expect(body).toContain("Readiness: 82 → 71 (-11)");
expect(body).toContain("#### Impact assessment");
```

Add unavailable-baseline coverage expecting the exact user-facing meaning:

```ts
expect(body).toContain(
  "Exact base SHA evidence unavailable; the current run result is still valid, but no authoritative PR change comparison was produced.",
);
```

Do not render raw unavailable parser/API error text.

- [ ] **Step 4: Render `RunResult.hardwareImpact` in review comments**

Extend `formatReviewComment` to read the optional structured object from the `RunResult`; keep current decision/severity/top-finding behavior unchanged. Use helper functions in the same file for:

- compact summary;
- zero-omitting `Changed facts` lines;
- explicit `Impact assessment` lines;
- baseline-unavailable message.

Do not interpolate JSON. Existing finding/location escaping remains unchanged.

`src/action/comment.ts` must stop doing an independent historical lookup for `format === "review"`; it simply renders the impact already attached to `result`. Keep the existing full-report fabrication-diff path unchanged to avoid unrelated behavior changes.

- [ ] **Step 5: Prove Action JSON and review output use the same object**

Add/extend `tests/action/action.test.ts` so the Action fixture writes JSON with:

```ts
expect(JSON.parse(json).hardwareImpact).toEqual(expectedImpact);
```

and the review-comment mock receives text derived from the same facts/assessment. Include a candidate-mismatch fixture and verify the overall Action conclusion still follows the current run result, not impact availability.

Run:

```bash
corepack pnpm vitest run \
  tests/unit/action/hardware-impact.test.ts \
  tests/unit/action/previous-result.test.ts \
  tests/unit/report/review-comment.test.ts \
  tests/action/action.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Action integration**

```bash
git add src/action/hardware-impact.ts src/action/index.ts src/action/comment.ts src/report/review-comment.ts \
  tests/unit/action/hardware-impact.test.ts tests/unit/report/review-comment.test.ts tests/action/action.test.ts
git commit -S -m "feat(action): publish PR hardware impact"
```

---

### Task 4: Carry the exact base SHA through the existing Check Run without changing workflow-dispatch inputs

**Files:**
- Modify: `packages/cloud-core/src/lifecycle.ts`
- Modify: `apps/web/lib/github-app-check-run-client.js`
- Modify: `.github/workflows/readiness-runner.yml`
- Test: `tests/unit/cloud-core/webhook.test.ts`
- Test: `tests/unit/db/transactional-release-run-store.test.ts`
- Test: `tests/unit/web/github-app-check-run-client.test.ts`
- Test: `tests/unit/scripts/readiness-runner-workflow.test.ts`
- Test: `tests/unit/action/hardware-impact.test.ts`

**Interfaces:**
- New PR webhook actions carry optional `baseCommitSha?: string`; new normalized PR events always populate it, while optional typing keeps already-persisted pre-feature outbox effects readable during rolling deployment.
- The queued BoardReadyOps Check Run exposes a bounded machine-readable line `Impact base SHA: <40hex>` alongside the existing trust summary.
- Hosted Action execution receives the already-existing `run_id` and `head_sha` as environment bindings and reads the matching Check Run with the repository-scoped job token.
- Workflow-dispatch input names do not change, so repositories still running the old canonical workflow are not broken by an unexpected new input.
- No database column is added: the durable outbox already persists the complete enqueue action JSON.

- [ ] **Step 1: Write RED tests for webhook base SHA normalization and rolling compatibility**

In `tests/unit/cloud-core/webhook.test.ts`, expect normalized new PR action to contain both SHAs:

```ts
expect(enqueue).toMatchObject({
  type: "release_run.enqueue",
  baseCommitSha: "a".repeat(40),
  commitSha: "b".repeat(40),
});
```

Add a malformed/missing `pull_request.base.sha` case that is rejected as unsupported rather than creating a falsely bound new action.

Define the action property as optional at the durable type boundary:

```ts
baseCommitSha?: string;
```

This is deliberate rolling-upgrade compatibility for old outbox JSON. New webhook normalization must still populate it for every accepted PR enqueue action.

- [ ] **Step 2: Preserve `baseCommitSha` in the existing durable outbox payload**

Update `tests/unit/db/transactional-release-run-store.test.ts` fixture action with `baseCommitSha` and assert the `$11::jsonb` payload contains:

```ts
expect(JSON.parse(String(params[10]))).toMatchObject({
  type: "github.check_run.create",
  action: {
    baseCommitSha: "a".repeat(40),
    commitSha: "b".repeat(40),
  },
});
```

No SQL function signature, release-run column, or migration changes are needed because the action already lives in outbox JSON.

- [ ] **Step 3: Add the bounded base-SHA marker to the queued Check Run**

In `apps/web/lib/github-app-check-run-client.js`, extend `queuedTrustSummary(action)` only when a valid `action.baseCommitSha` is present:

```js
if (typeof action.baseCommitSha === "string" && /^[0-9a-f]{40}$/u.test(action.baseCommitSha)) {
  lines.push(`Impact base SHA: ${action.baseCommitSha}`);
}
```

Do not change `external_id`; it remains the BoardReadyOps release run ID and is the binding the hosted Action uses to select its own Check Run.

In `tests/unit/web/github-app-check-run-client.test.ts`, assert:

- new PR action → queued summary contains one exact base-SHA marker;
- legacy action without `baseCommitSha` → Check Run creation still succeeds and has no marker;
- marker contains no webhook payload, installation token, or other repository metadata.

- [ ] **Step 4: Let the hosted Action read only its matching Check Run**

Extend `src/action/hardware-impact.ts` tests from Task 3 so hosted binding logic queries the exact candidate commit's Check Runs and accepts a base SHA only when all of these match:

```ts
check.name === "BoardReadyOps / release readiness";
check.external_id === process.env.BOARDREADYOPS_CLOUD_RUN_ID;
check.head_sha === process.env.BOARDREADYOPS_PR_HEAD_SHA;
/^Impact base SHA: ([0-9a-f]{40})$/mu.test(check.output.summary);
```

For hosted `workflow_dispatch`, missing marker, wrong external ID, wrong head SHA, duplicate matching Check Runs, or malformed marker means the PR comparison context is not established, so `buildActionHardwareImpact` returns `undefined` and logs only a bounded category; it does not invent a baseline reason without a trusted base SHA. Once a valid base marker is established, missing/invalid historical artifacts use the approved bounded unavailable reasons. Never take a base SHA from another Check Run on the same commit.

- [ ] **Step 5: Add only repository-scoped read permissions/env to the canonical workflow**

Do **not** add `base_sha` or any other new `workflow_dispatch` input.

Update the readiness job permissions to:

```yaml
permissions:
  actions: read
  checks: read
  contents: read
  id-token: write
```

On the `Run BoardReadyOps` step expose only existing dispatch bindings plus the job-scoped token:

```yaml
env:
  GITHUB_TOKEN: ${{ github.token }}
  BOARDREADYOPS_PR_HEAD_SHA: ${{ inputs.head_sha }}
  BOARDREADYOPS_CLOUD_RUN_ID: ${{ inputs.run_id }}
```

`actions: read` is used for historical artifact lookup. `checks: read` is used only to read the already-created BoardReadyOps Check Run carrying the base-SHA marker. Neither is a GitHub App permission increase.

- [ ] **Step 6: Strengthen workflow security regression tests**

In `tests/unit/scripts/readiness-runner-workflow.test.ts`, assert:

- the workflow-dispatch input set is unchanged (no `base_sha` input);
- checkout remains pinned to `inputs.head_sha`;
- readiness job permissions are exactly `actions: read`, `checks: read`, `contents: read`, `id-token: write`;
- no `pull-requests: write`, `contents: write`, PAT, App private key, or long-lived callback secret is introduced;
- head/run env is passed only to the BoardReadyOps Action step.

Run:

```bash
corepack pnpm vitest run \
  tests/unit/cloud-core/webhook.test.ts \
  tests/unit/db/transactional-release-run-store.test.ts \
  tests/unit/web/github-app-check-run-client.test.ts \
  tests/unit/action/hardware-impact.test.ts \
  tests/unit/scripts/readiness-runner-workflow.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit exact-base transport**

```bash
git add packages/cloud-core/src/lifecycle.ts apps/web/lib/github-app-check-run-client.js \
  .github/workflows/readiness-runner.yml tests/unit/cloud-core/webhook.test.ts \
  tests/unit/db/transactional-release-run-store.test.ts tests/unit/web/github-app-check-run-client.test.ts \
  tests/unit/action/hardware-impact.test.ts tests/unit/scripts/readiness-runner-workflow.test.ts
git commit -S -m "feat(cloud): bind PR impact through Check Run metadata"
```

---

### Task 5: Add the bounded optional hosted terminal-result contract and preserve result identity

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `src/runner/worker.ts`
- Modify: `.github/workflows/readiness-runner.yml`
- Modify: `apps/web/app/api/v1/runs/result/route.ts`
- Test: `tests/unit/contracts/release-run-result.test.ts`
- Test: `tests/unit/runner/worker.test.ts`
- Test: `tests/unit/web/readiness-result-route.test.ts`
- Test: `tests/unit/scripts/readiness-runner-workflow.test.ts`

**Interfaces:**
- Produces optional `ReleaseRunResult.hardwareImpact` with strict nested Zod validation.
- Persists the object through existing `release_run_results.payload`; no schema migration.
- Includes the object in canonical result digest normalization so impact-changing payloads are not considered identical.

- [ ] **Step 1: Write RED contract tests for valid, absent, and malformed impact**

Add to `tests/unit/contracts/release-run-result.test.ts`:

```ts
it("accepts bounded hardware impact while keeping old payloads valid", () => {
  expect(releaseRunResultSchema.parse({ status: "completed", decision: "pass", findings: [] }).hardwareImpact)
    .toBeUndefined();

  const parsed = releaseRunResultSchema.parse({
    status: "completed",
    decision: "pass",
    findings: [],
    hardwareImpact: validHardwareImpact(),
  });
  expect(parsed.hardwareImpact?.version).toBe(1);
});
```

Add rejection tests for:

- uppercase/short/long SHA;
- unknown baseline reason/domain/risk direction/kind;
- evidence length 13;
- `label/path/ruleId` length 257;
- unexpected nested keys;
- non-finite/out-of-range numeric values where applicable.

- [ ] **Step 2: Implement strict nested Zod schemas**

Add named schemas in `packages/contracts/src/index.ts` mirroring the approved v1 model. Every nested object must use `.strict()`. Use lowercase 40-char SHA regex and evidence `.max(12)`.

Extend only the base release result object:

```ts
const releaseRunResultBaseSchema = z.object({
  // existing fields
  hardwareImpact: hardwareImpactV1Schema.optional(),
}).strict();
```

Do not change `version: 1` compatibility or any existing default.

- [ ] **Step 3: Forward Action-produced impact from both hosted producers**

In `src/runner/worker.ts`, include the report model only when present:

```ts
...(execution.report?.hardwareImpact ? { hardwareImpact: execution.report.hardwareImpact } : {}),
```

In `.github/workflows/readiness-runner.yml`, after validating `reportAvailable`, forward `report.hardwareImpact` only as JSON data:

```js
const hardwareImpact = reportAvailable && report.hardwareImpact && typeof report.hardwareImpact === "object"
  ? report.hardwareImpact
  : undefined;

const payload = {
  // existing bounded fields
  ...(hardwareImpact ? { hardwareImpact } : {}),
};
```

Do not independently reconstruct impact in the workflow script. The cloud contract is the fail-closed validator.

- [ ] **Step 4: Include `hardwareImpact` in terminal result digest normalization**

In `normalizedResultForDigest(result)`, add canonical impact content when present:

```ts
if (result.hardwareImpact) normalized.hardwareImpact = result.hardwareImpact;
```

Because the core builder already emits stable array ordering and the contract is structured, no timestamp is introduced. Add route tests proving two otherwise identical terminal payloads with different hardware impact do not share a result digest/conflicting-terminal-result identity.

- [ ] **Step 5: Prove existing JSONB persistence needs no migration**

Extend `tests/unit/web/readiness-result-route.test.ts` and inspect the `$12::jsonb` persisted payload argument:

```ts
expect(JSON.parse(params[payloadIndex] as string).hardwareImpact).toEqual(validHardwareImpact());
```

Also assert audit metadata contains only safe aggregates if added, for example:

```ts
expect(JSON.parse(params[auditMetadataIndex] as string)).toMatchObject({
  hardwareImpactReported: true,
  hardwareImpactBaselineStatus: "available",
  hardwareImpactRiskDirection: "increased",
});
```

Do not copy evidence `label`, `path`, or `ruleId` into audit metadata.

Run:

```bash
corepack pnpm vitest run \
  tests/unit/contracts/release-run-result.test.ts \
  tests/unit/web/readiness-result-route.test.ts \
  tests/unit/scripts/readiness-runner-workflow.test.ts
```

and:

```bash
corepack pnpm vitest run tests/unit/runner/worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit contract and persistence support**

```bash
git add packages/contracts/src/index.ts src/runner/worker.ts .github/workflows/readiness-runner.yml \
  apps/web/app/api/v1/runs/result/route.ts tests/unit/contracts/release-run-result.test.ts \
  tests/unit/web/readiness-result-route.test.ts tests/unit/scripts/readiness-runner-workflow.test.ts
git add tests/unit/runner/worker.test.ts
git commit -S -m "feat(cloud): accept bounded hardware impact results"
```

---

### Task 6: Render the same structured impact semantics in hosted Check Runs and optional PR comments

**Files:**
- Modify: `apps/web/lib/readiness-result-format.js`
- Modify: `apps/web/lib/readiness-result-format.d.ts`
- Test: `tests/unit/web/readiness-result-format.test.ts`
- Test: `tests/unit/web/readiness-result-route.test.ts`

**Interfaces:**
- Consumes: validated optional `ReleaseRunResult.hardwareImpact` plus existing details/report links.
- Produces: bounded Markdown text for Check Run summary and optional sticky PR comment.
- Does not recompute risk or facts from findings in Cloud.

- [ ] **Step 1: Write RED formatter tests using one shared structured fixture**

Add a `hardwareImpact` fixture to `tests/unit/web/readiness-result-format.test.ts` and assert both formatters contain semantically identical sections:

```ts
const check = buildReadinessCheckOutput({ ...baseResult, hardwareImpact });
const comment = buildReadinessPrComment({ ...baseResult, hardwareImpact });

for (const output of [check.summary, comment]) {
  expect(output).toContain("Hardware impact");
  expect(output).toContain("Material change · risk increased · 3 affected domains");
  expect(output).toContain("Changed facts");
  expect(output).toContain("Impact assessment");
}
```

Add unavailable-baseline coverage and evidence strings containing Markdown metacharacters/newlines; assert existing sanitizers prevent structure injection.

- [ ] **Step 2: Add impact formatting helpers without duplicating assessment logic**

In `apps/web/lib/readiness-result-format.js`, implement helpers that only read the supplied model:

```js
function appendHardwareImpact(lines, impact) {
  if (!impact) return;
  lines.push("", "### Hardware impact", "");
  if (impact.baseline.status === "unavailable") {
    lines.push("Exact base SHA evidence unavailable; the current run result is still valid, but no authoritative PR change comparison was produced.");
    return;
  }
  // summary, changed facts, assessment, bounded evidence refs
}
```

Rules:

- no Cloud-side risk recomputation;
- no raw JSON rendering;
- zero-change fact rows may be omitted;
- evidence strings pass `sanitizeInline`/`code`/Markdown link helpers already used by the formatter;
- keep current result decision/title unchanged when impact is unavailable.

Call the same helper from `checkSummary` and `buildReadinessPrComment`.

Update `.d.ts` input types to accept the optional structured field consistently with the contract.

- [ ] **Step 3: Prove route publication sends the formatted impact to GitHub client**

Extend `tests/unit/web/readiness-result-route.test.ts`:

```ts
expect(completeCheckRun).toHaveBeenCalledWith(
  expect.objectContaining({ summary: expect.stringContaining("### Hardware impact") }),
);
expect(createPullRequestComment).toHaveBeenCalledWith(
  expect.objectContaining({ body: expect.stringContaining("### Hardware impact") }),
);
```

Also prove no comment permission/configuration path becomes blocking: the existing non-blocking PR-comment warning behavior remains unchanged.

- [ ] **Step 4: Run formatter/publication tests**

```bash
corepack pnpm vitest run \
  tests/unit/web/readiness-result-format.test.ts \
  tests/unit/web/readiness-result-route.test.ts \
  tests/unit/web/github-app-check-run-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit hosted rendering**

```bash
git add apps/web/lib/readiness-result-format.js apps/web/lib/readiness-result-format.d.ts \
  tests/unit/web/readiness-result-format.test.ts tests/unit/web/readiness-result-route.test.ts
git commit -S -m "feat(web): render hardware impact in GitHub output"
```

---

### Task 7: Update product/security documentation and generated artifacts

**Files:**
- Modify: `docs/review-app.md`
- Modify: `docs/action.md`
- Modify: `docs/github-action.md`
- Modify: `docs/deployment/github-actions-execution.md`
- Modify: `docs/reports/json.md`
- Modify if generator requires: `action.yml`, `apps/container/action.yml`, generated dist files
- Test: `tests/unit/docs/control-plane-operations-docs.test.ts`
- Test: `tests/unit/scripts/readiness-runner-workflow.test.ts`

**Interfaces:**
- Documents the exact-base behavior users actually receive.
- Documents target workflow `actions: read` as short-lived `GITHUB_TOKEN` scope, not a GitHub App permission.

- [ ] **Step 1: Update review/action documentation with exact semantics**

Document these user-visible rules verbatim in meaning:

- hardware impact compares exact PR base SHA to exact analyzed PR head SHA;
- if exact base evidence is unavailable, BoardReadyOps does not silently substitute another run;
- the current run decision remains valid independently of impact availability;
- detailed previous/current report artifacts remain in the target repository;
- Cloud receives only the bounded structured impact summary/evidence references.

Update the review example to show separate `Changed facts` and `Impact assessment` sections.

- [ ] **Step 2: Update deployment/security boundary documentation**

In `docs/deployment/github-actions-execution.md`, update the canonical target workflow permission description from contents-only to the precise job-scoped set now required:

```text
actions: read     — read historical BoardReadyOps artifacts in this repository only
checks: read      — read the App-created Check Run that binds this release run to its exact PR base SHA
contents: read    — checkout the exact assigned commit
id-token: write   — obtain the short-lived OIDC result token
```

Explicitly state that this does not alter the production GitHub App permission profile.

- [ ] **Step 3: Update JSON report documentation**

Add the optional `hardwareImpact` section to `docs/reports/json.md`, including facts/assessment separation, evidence cap, and baseline-unavailable reason enum. Mark it additive/optional for readers.

- [ ] **Step 4: Regenerate repository-owned generated surfaces**

Run:

```bash
corepack pnpm run build
corepack pnpm run compatibility:docs
corepack pnpm run api:docs
node scripts/toolchain.mjs run node scripts/docs-build.mjs
```

Then inspect `git status --short` and keep only generator-expected files. Do not accept unrelated lockfile or formatting churn.

- [ ] **Step 5: Run documentation/security-focused tests**

```bash
corepack pnpm vitest run \
  tests/unit/docs/control-plane-operations-docs.test.ts \
  tests/unit/scripts/readiness-runner-workflow.test.ts \
  tests/unit/scripts/security-automation-config.test.ts
corepack pnpm run workflow:lint
```

Expected: PASS.

- [ ] **Step 6: Commit documentation/generated changes**

```bash
git add docs/review-app.md docs/action.md docs/github-action.md docs/deployment/github-actions-execution.md docs/reports/json.md \
  tests/unit/docs/control-plane-operations-docs.test.ts tests/unit/scripts/readiness-runner-workflow.test.ts
git add dist/action/index.cjs dist/cli/index.cjs 2>/dev/null || true
git commit -S -m "docs: explain PR hardware impact evidence"
```

Before committing, remove any staged generated file that `git diff --cached` shows was not changed by the documented generator path.

---

### Task 8: Full verification, PR review, canary rollout, and post-merge evidence

**Files:**
- No planned product-code changes.
- Update issue #447 evidence/comment only after fresh verification.
- Canary repository changes are operational evidence and must use exact immutable release/branch SHAs; do not change production App permissions.

**Interfaces:**
- Consumes final feature branch head.
- Produces merge-ready PR evidence and, after merge/release pinning, public/private/baseline-unavailable commissioning evidence.

- [ ] **Step 1: Run focused feature regression suites on the final branch head**

```bash
corepack pnpm vitest run \
  tests/unit/core/run-diff.test.ts \
  tests/unit/core/hardware-impact.test.ts \
  tests/unit/action/previous-result.test.ts \
  tests/unit/action/hardware-impact.test.ts \
  tests/unit/report/review-comment.test.ts \
  tests/unit/contracts/release-run-result.test.ts \
  tests/unit/web/runner-client.test.ts \
  tests/unit/web/readiness-result-format.test.ts \
  tests/unit/web/readiness-result-route.test.ts \
  tests/unit/scripts/readiness-runner-workflow.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run the repository Definition-of-Done gates**

Use the repository-local toolchain/cache; do not change host privileges if cache ownership is wrong.

```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test:unit
corepack pnpm run test:int:monorepo
corepack pnpm run cloud:typecheck
corepack pnpm run cloud:build
corepack pnpm run build
corepack pnpm run verify:dist
corepack pnpm run workflow:lint
corepack pnpm run docs
```

Then run the canonical umbrella verification if the above is clean:

```bash
node scripts/toolchain.mjs run corepack pnpm run verify:all:inner
```

Do not claim a check passed unless its fresh terminal output is successful.

- [ ] **Step 3: Review the full diff as a reviewer before push**

```bash
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Explicitly verify:

- no new dependency/lockfile churn;
- no secret, token, raw artifact, debug output, temp file, generated site directory, or local config;
- no GitHub App permission increase;
- canonical workflow has only the intended job-token `actions: read` addition;
- no fallback to branch/latest baseline exists;
- no timestamp/API discovery order affects assessment;
- result digest includes `hardwareImpact`;
- old payload tests remain present.

- [ ] **Step 4: Push normally and open one focused PR referencing #447**

```bash
git push -u origin HEAD
gh pr create -R oaslananka/boardreadyops \
  --title "feat(product): add PR-native hardware impact v1" \
  --body "Closes #447. Implements exact-base PR hardware impact with deterministic facts/assessment, bounded hosted evidence, and no GitHub App permission expansion."
```

Never use `--no-verify`.

- [ ] **Step 5: Wait for and inspect every PR check/bot result**

Require terminal success/accepted state for the repository's applicable matrix, including:

- Linux/macOS/Windows Node 22 and 24;
- unit/integration/accessibility;
- lint/typecheck/build/verify-dist/coverage;
- Sonar Quality Gate and Sonar comments;
- Codecov patch/project status;
- CodeQL;
- Semgrep OSS/Cloud;
- Socket/dependency review/gitleaks/OSV/SBOM/security gate;
- Renovate config validation;
- Mergify/mergeability.

Read PR review comments and bot comments, fix root causes, rerun local focused/full verification after every code change, and do not merge with required/pending red state.

- [ ] **Step 6: Squash merge only after final-head verification**

Use the repository's normal squash merge policy. Record the exact merge SHA and immediately verify `main` CI/Security on that SHA. Fresh GitHub Security counts must be read; do not infer them from PR success.

- [ ] **Step 7: Commission public and private target-repository canaries on the merged immutable SHA**

Follow the existing public → private order in `docs/operations/synthetic-target-repository-canaries.md`:

1. update public canary reusable workflow and Action pins to the exact merged/released SHA;
2. run manual commissioning;
3. verify exact nonce SHA, target workflow, `Run BoardReadyOps`, OIDC publication, and BoardReadyOps Check Run terminal success;
4. only then update private canary and repeat under current safe-mode policy.

For the public synthetic repository, deliberately create an exact-base history: take a previously successful public canary PR head that has a `readiness-runner.yml` BoardReadyOps JSON artifact, merge that synthetic-only head into the canary `main`, then create the next nonce PR from that new `main`. The next run must therefore have `base.sha === prior successful head SHA` under the same workflow identity, and `baseline.status=available` must be visible in the PR/Check Run impact output. Do not perform this pattern on customer repositories.

- [ ] **Step 8: Run a deliberate baseline-unavailable commissioning path**

Use the private safe-mode canary (where managed artifact upload remains disabled) or a fresh synthetic public base SHA with no eligible artifact; do not delete production/customer evidence to manufacture the condition. Verify:

- current run decision remains correct;
- `hardwareImpact.baseline.status === "unavailable"`;
- the user-facing message says exact base SHA evidence is unavailable;
- no other run/branch becomes a substitute;
- GitHub App permissions remain unchanged.

- [ ] **Step 9: Close #447 only after all acceptance evidence is fresh**

Post issue evidence containing exact commit/run/check IDs and the acceptance mapping. Close #447 only if:

- reviewer-facing facts + assessment are present;
- exact-base determinism is demonstrated;
- evidence links are present;
- public/private canaries pass;
- baseline-unavailable behavior is proven;
- post-merge main CI/Security is green;
- GitHub Security open counts are fresh and zero or every non-zero alert is explicitly resolved/accepted per repository policy.

---

## Plan self-review checklist

Before execution, the implementer must re-read the approved spec and this plan together. This plan intentionally uses existing `release_run_results.payload` persistence, the existing transactional outbox action payload, existing `diffRuns`, and existing report/upload paths; it does not introduce a second comparison engine, a new storage table, a new App permission, or a new dependency.
