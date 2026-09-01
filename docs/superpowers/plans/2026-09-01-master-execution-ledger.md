# Master Execution Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete W00 and Phase 0 with a deterministic execution ledger, evidence validation, roadmap reconciliation, and a recorded repository verification baseline.

**Architecture:** Canonical inventory lives in JSON. A dependency-free Node.js script validates it and renders only the generated matrix inside the existing Markdown ledger. Existing package verification runs the offline check; live GitHub reconciliation is recorded as audit evidence rather than becoming a CI network dependency.

**Tech Stack:** Node.js 22+, ECMAScript modules, JSON, Markdown, Vitest, pnpm, Task.

**Spec:** `docs/superpowers/specs/2026-09-01-master-execution-ledger-design.md`

## Global Constraints

- Preserve unrelated working-tree changes; stage only files owned by each task.
- Add no dependency.
- Keep normal CI verification offline and deterministic.
- Preserve issue #191 as roadmap ordering authority.
- Use only `implemented`, `partial`, `missing`, `blocked`, and `deferred` statuses.
- Require code, tests, docs, deploy evidence or a non-deployable reason, commit/PR evidence, and passing verification before `implemented`.
- Keep completed milestones closed; route follow-up work to active milestones.
- Use UTC ISO-8601 timestamps in committed audit data.
- Follow TDD: observe each new behavior test fail before implementation.

---

### Task 1: Canonical Model and Validator

**Files:**

- Create: `scripts/master-execution-status.mjs`
- Create: `scripts/master-execution-status.d.mts`
- Create: `tests/unit/scripts/master-execution-status.test.ts`

**Interfaces:**

- Consumes: parsed JSON value and optional `{ pathExists(path: string): boolean }` dependency.
- Produces: `validateExecutionStatus(value: unknown, options?: ValidationOptions): ExecutionStatus` and `executionStatusIds: readonly string[]`.

- [ ] **Step 1: Write failing validator tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  executionStatusIds,
  validateExecutionStatus,
} from "../../../scripts/master-execution-status.mjs";

function workstream(id: string, phase = 0) {
  return {
    id,
    name: `Workstream ${id}`,
    phase,
    priority: "P0",
    status: "missing",
    owner: "maintainers",
    dependencies: [],
    milestone: "Repository Maintenance & Release Health",
    issues: [191],
    evidence: { code: [], tests: [], docs: [], deployed: [], commits: [], pullRequests: [] },
    verification: { command: "not run", result: "not_run", checkedAt: "2026-09-01T00:00:00Z" },
    remaining: "Repository evidence has not been reconciled.",
  };
}

function validLedger() {
  return {
    version: 1,
    spec: { path: "BoardReadyOps_Agent_Master_Development_Spec.md", sha256: "e02df14e4105945ac1d8bb8dc13d132e04dd27803e560288548f9c3e60857c62" },
    roadmap: {
      source: "https://github.com/oaslananka/boardreadyops/issues/191",
      checkedAt: "2026-09-01T00:00:00Z",
      orderedMilestones: ["Repository Maintenance & Release Health"],
      completedMilestones: ["v1.8.0 — Release & Distribution Reliability"],
    },
    baseline: { command: "task verify", result: "not_run", commit: "0831efc", checkedAt: "2026-09-01T00:00:00Z", blockers: [] },
    workstreams: executionStatusIds.map((id) => workstream(id)),
  };
}

describe("master execution status validation", () => {
  it("accepts exactly W00 through W36", () => {
    expect(validateExecutionStatus(validLedger()).workstreams).toHaveLength(37);
  });

  it("rejects a missing workstream", () => {
    const ledger = validLedger();
    ledger.workstreams.pop();
    expect(() => validateExecutionStatus(ledger)).toThrow("missing workstream W36");
  });

  it("rejects a duplicate workstream", () => {
    const ledger = validLedger();
    ledger.workstreams.push(workstream("W00"));
    expect(() => validateExecutionStatus(ledger)).toThrow("duplicate workstream W00");
  });

  it("rejects a dependency cycle", () => {
    const ledger = validLedger();
    ledger.workstreams[0].dependencies = ["W01"];
    ledger.workstreams[1].dependencies = ["W00"];
    expect(() => validateExecutionStatus(ledger)).toThrow("dependency cycle: W00 -> W01 -> W00");
  });

  it("rejects implemented work without complete evidence", () => {
    const ledger = validLedger();
    ledger.workstreams[0].status = "implemented";
    delete ledger.workstreams[0].remaining;
    expect(() => validateExecutionStatus(ledger)).toThrow("W00 implemented evidence missing");
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts`

Expected: FAIL because `scripts/master-execution-status.mjs` does not exist.

- [ ] **Step 3: Implement minimum validator**

```javascript
import { existsSync } from "node:fs";

export const executionStatusIds = Object.freeze(
  Array.from({ length: 37 }, (_, index) => `W${String(index).padStart(2, "0")}`),
);

const statuses = new Set(["implemented", "partial", "missing", "blocked", "deferred"]);
const priorities = new Set(["P0", "P1", "P2", "P3"]);

export function validateExecutionStatus(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("execution status must be an object");
  const ledger = value;
  if (!Array.isArray(ledger.workstreams)) throw new TypeError("workstreams must be an array");
  const byId = new Map();
  for (const entry of ledger.workstreams) {
    if (byId.has(entry.id)) throw new Error(`duplicate workstream ${entry.id}`);
    byId.set(entry.id, entry);
  }
  for (const id of executionStatusIds) if (!byId.has(id)) throw new Error(`missing workstream ${id}`);
  for (const id of byId.keys()) if (!executionStatusIds.includes(id)) throw new Error(`unknown workstream ${id}`);
  if (ledger.roadmap?.source !== "https://github.com/oaslananka/boardreadyops/issues/191") {
    throw new Error("roadmap source must be issue #191");
  }
  if (!Array.isArray(ledger.roadmap.orderedMilestones) || ledger.roadmap.orderedMilestones.length === 0) {
    throw new Error("roadmap milestone order missing");
  }
  for (const entry of ledger.workstreams) validateWorkstream(entry, ledger, byId, options.pathExists ?? existsSync);
  validateDependencyGraph(byId);
  return ledger;
}

function validateWorkstream(entry, ledger, byId, pathExists) {
  if (!executionStatusIds.includes(entry.id)) throw new Error(`unknown workstream ${entry.id}`);
  if (typeof entry.name !== "string" || entry.name.trim() === "") throw new Error(`${entry.id} name missing`);
  if (!Number.isInteger(entry.phase) || entry.phase < 0 || entry.phase > 8) throw new Error(`${entry.id} phase invalid`);
  if (!priorities.has(entry.priority)) throw new Error(`${entry.id} priority invalid`);
  if (!statuses.has(entry.status)) throw new Error(`${entry.id} status invalid`);
  if (typeof entry.owner !== "string" || entry.owner.trim() === "") throw new Error(`${entry.id} owner missing`);
  if (!Array.isArray(entry.dependencies)) throw new Error(`${entry.id} dependencies invalid`);
  for (const dependency of entry.dependencies) {
    if (dependency === entry.id) throw new Error(`${entry.id} cannot depend on itself`);
    const target = byId.get(dependency);
    if (!target) throw new Error(`${entry.id} dependency missing: ${dependency}`);
    if (target.phase > entry.phase) throw new Error(`${entry.id} scheduled before dependency ${dependency}`);
  }
  if (ledger.roadmap.completedMilestones.includes(entry.milestone) && entry.status !== "implemented") {
    throw new Error(`${entry.id} targets completed milestone ${entry.milestone}`);
  }
  const evidenceKeys = ["code", "tests", "docs", "deployed", "commits", "pullRequests"];
  for (const key of evidenceKeys) {
    if (!Array.isArray(entry.evidence?.[key])) throw new Error(`${entry.id} evidence.${key} invalid`);
  }
  for (const path of [...entry.evidence.code, ...entry.evidence.tests, ...entry.evidence.docs]) {
    if (!pathExists(path)) throw new Error(`${entry.id} evidence path missing: ${path}`);
  }
  if (!entry.verification || !["pass", "fail", "not_run"].includes(entry.verification.result)) {
    throw new Error(`${entry.id} verification invalid`);
  }
  if (entry.status === "implemented") {
    const deployable = entry.evidence.deployed.length > 0;
    const changeEvidence = entry.evidence.commits.length + entry.evidence.pullRequests.length > 0;
    const complete = entry.evidence.code.length > 0 && entry.evidence.tests.length > 0 && entry.evidence.docs.length > 0 && deployable && changeEvidence && entry.verification.result === "pass";
    if (!complete) throw new Error(`${entry.id} implemented evidence missing`);
  } else if (entry.status === "deferred") {
    if (typeof entry.deferUntil !== "string" || entry.deferUntil.trim() === "") throw new Error(`${entry.id} defer trigger missing`);
  } else if (typeof entry.remaining !== "string" || entry.remaining.trim() === "") {
    throw new Error(`${entry.id} remaining work missing`);
  }
}

function validateDependencyGraph(byId) {
  const visited = new Set();
  const active = [];
  function visit(id) {
    const cycleStart = active.indexOf(id);
    if (cycleStart >= 0) throw new Error(`dependency cycle: ${[...active.slice(cycleStart), id].join(" -> ")}`);
    if (visited.has(id)) return;
    active.push(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    active.pop();
    visited.add(id);
  }
  for (const id of executionStatusIds) visit(id);
}
```

- [ ] **Step 4: Add declaration file**

```typescript
export type ExecutionStatusValue = "implemented" | "partial" | "missing" | "blocked" | "deferred";
export type VerificationResult = "pass" | "fail" | "not_run";
export interface ValidationOptions { pathExists?(path: string): boolean }
export interface WorkstreamStatus { id: string; name: string; phase: number; priority: "P0" | "P1" | "P2" | "P3"; status: ExecutionStatusValue; owner: string; dependencies: string[]; milestone: string; issues: number[]; evidence: Record<string, string[]>; verification: { command: string; result: VerificationResult; checkedAt: string }; remaining?: string; deferUntil?: string }
export interface ExecutionStatus { version: 1; spec: { path: string; sha256: string }; roadmap: { source: string; checkedAt: string; orderedMilestones: string[]; completedMilestones: string[] }; baseline: { command: string; result: VerificationResult; commit: string; checkedAt: string; blockers: string[] }; workstreams: WorkstreamStatus[] }
export const executionStatusIds: readonly string[];
export function validateExecutionStatus(value: unknown, options?: ValidationOptions): ExecutionStatus;
```

- [ ] **Step 5: Run validator tests and confirm GREEN**

Run: `corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit validator slice**

```bash
git add scripts/master-execution-status.mjs scripts/master-execution-status.d.mts tests/unit/scripts/master-execution-status.test.ts
git commit -m "feat(docs): validate master execution inventory"
```

### Task 2: Deterministic Markdown Renderer and Drift Check

**Files:**

- Modify: `scripts/master-execution-status.mjs`
- Modify: `scripts/master-execution-status.d.mts`
- Modify: `tests/unit/scripts/master-execution-status.test.ts`

**Interfaces:**

- Consumes: validated `ExecutionStatus` and Markdown containing `<!-- master-execution-status:start -->` / `<!-- master-execution-status:end -->`.
- Produces: `renderExecutionStatus(status)`, `replaceExecutionStatusSection(document, rendered)`, and `main(root?, args?)`.

- [ ] **Step 1: Write failing renderer tests**

```typescript
it("renders workstreams in phase, priority, and ID order", () => {
  const ledger = validLedger();
  ledger.workstreams.reverse();
  const rendered = renderExecutionStatus(validateExecutionStatus(ledger));
  expect(rendered.indexOf("| W00 |")).toBeLessThan(rendered.indexOf("| W36 |"));
});

it("replaces only the generated section", () => {
  const input = "before\n<!-- master-execution-status:start -->\nold\n<!-- master-execution-status:end -->\nafter\n";
  expect(replaceExecutionStatusSection(input, "new")).toBe(
    "before\n<!-- master-execution-status:start -->\nnew\n<!-- master-execution-status:end -->\nafter\n",
  );
});

it("rejects a document without both generated markers", () => {
  expect(() => replaceExecutionStatusSection("before", "new")).toThrow("generated execution status markers missing");
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts`

Expected: FAIL because renderer exports do not exist.

- [ ] **Step 3: Implement renderer and CLI modes**

```javascript
export function renderExecutionStatus(status) {
  const rows = [...status.workstreams]
    .sort((left, right) => left.phase - right.phase || left.priority.localeCompare(right.priority) || left.id.localeCompare(right.id))
    .map((entry) => `| ${entry.id} | ${entry.name} | ${entry.priority} | ${entry.phase} | ${entry.status} | ${entry.owner} | ${entry.dependencies.join(", ") || "—"} | ${entry.milestone} |`);
  return [
    "| Workstream | Name | Priority | Phase | Status | Owner | Dependencies | Roadmap target |",
    "| --- | --- | --- | ---: | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
```

`main(root, args)` reads JSON and Markdown, validates data, renders the section, writes on `render`, and throws `master execution status drift; run corepack pnpm run execution-status:render` on `check` when content differs.

- [ ] **Step 4: Extend declaration file with exact exports**

```typescript
export function renderExecutionStatus(status: ExecutionStatus): string;
export function replaceExecutionStatusSection(document: string, rendered: string): string;
export function main(root?: string, args?: string[]): Promise<void>;
```

- [ ] **Step 5: Run tests and confirm GREEN**

Run: `corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit renderer slice**

```bash
git add scripts/master-execution-status.mjs scripts/master-execution-status.d.mts tests/unit/scripts/master-execution-status.test.ts
git commit -m "feat(docs): render master execution ledger"
```

### Task 3: Canonical Inventory and Existing Ledger Adoption

**Files:**

- Create: `docs/development/master-execution-status.json`
- Modify: `docs/development/master-execution-status.md`
- Modify: `tests/unit/docs/master-execution-status-docs.test.ts`
- Preserve: `mkdocs.yml`

**Interfaces:**

- Consumes: current 37-row ledger, detailed evidence sections, issue #191 snapshot, and repository paths.
- Produces: valid canonical JSON plus generated Markdown markers and matrix.

- [ ] **Step 1: Strengthen docs contract and confirm RED**

```typescript
it("binds the generated ledger to canonical inventory and issue 191", () => {
  const status = JSON.parse(readFileSync(resolve(repoRoot, "docs/development/master-execution-status.json"), "utf8"));
  expect(status.roadmap.source).toBe("https://github.com/oaslananka/boardreadyops/issues/191");
  expect(status.workstreams.map((entry: { id: string }) => entry.id)).toEqual(
    Array.from({ length: 37 }, (_, index) => `W${String(index).padStart(2, "0")}`),
  );
  expect(readFileSync(masterStatusPath, "utf8")).toContain("<!-- master-execution-status:start -->");
});
```

Run: `corepack pnpm vitest run tests/unit/docs/master-execution-status-docs.test.ts`

Expected: FAIL because canonical JSON and markers do not exist.

- [ ] **Step 2: Create canonical inventory from current evidence**

Use the exact object structure from Task 1. Convert every existing W00-W36 matrix row. For each `implemented` claim, preserve it only when code, tests, docs, deployment or non-deployable reason, commit/PR, and passing verification are present. Downgrade unsupported claims to `partial` and record the missing evidence in `remaining`. Set dependencies from the phase ordering and issue #191; do not invent completed issue evidence.

- [ ] **Step 3: Add generated markers without changing narrative**

```markdown
<!-- master-execution-status:start -->
<!-- content written by scripts/master-execution-status.mjs -->
<!-- master-execution-status:end -->
```

Place markers around only the existing status matrix. Retain detailed workstream sections and unrelated MkDocs navigation changes.

- [ ] **Step 4: Render and verify canonical output**

Run: `node scripts/master-execution-status.mjs render`

Run: `node scripts/master-execution-status.mjs check`

Expected: both commands exit 0 and second command changes no files.

- [ ] **Step 5: Run inventory contracts and confirm GREEN**

Run: `corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts tests/unit/docs/master-execution-status-docs.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit inventory slice**

```bash
git add docs/development/master-execution-status.json docs/development/master-execution-status.md tests/unit/docs/master-execution-status-docs.test.ts mkdocs.yml
git commit -m "docs(docs): reconcile master execution inventory"
```

Before staging `mkdocs.yml`, use `git diff -- mkdocs.yml` and stage only the ledger navigation hunk; leave unrelated ADR navigation hunks unstaged.

### Task 4: Verification Wiring

**Files:**

- Modify: `package.json`
- Modify: `tests/unit/docs/master-execution-status-docs.test.ts`

**Interfaces:**

- Produces package scripts `execution-status:render` and `verify:execution-status`; existing `verify` invokes the latter.

- [ ] **Step 1: Write failing package-script contract**

```typescript
it("runs ledger drift validation in normal verification", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  expect(packageJson.scripts["execution-status:render"]).toBe("node scripts/master-execution-status.mjs render");
  expect(packageJson.scripts["verify:execution-status"]).toBe("node scripts/master-execution-status.mjs check");
  expect(packageJson.scripts.verify).toContain("corepack pnpm run verify:execution-status");
});
```

- [ ] **Step 2: Run contract and confirm RED**

Run: `corepack pnpm vitest run tests/unit/docs/master-execution-status-docs.test.ts`

Expected: FAIL because package scripts are absent.

- [ ] **Step 3: Add package scripts and verify-chain entry**

```json
"execution-status:render": "node scripts/master-execution-status.mjs render",
"verify:execution-status": "node scripts/master-execution-status.mjs check"
```

Insert `corepack pnpm run verify:execution-status` immediately after `verify:public-surface` in the existing `verify` command so documentation drift fails early.

- [ ] **Step 4: Run contracts and targeted verification**

Run: `corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts tests/unit/docs/master-execution-status-docs.test.ts`

Run: `corepack pnpm run verify:execution-status`

Expected: PASS.

- [ ] **Step 5: Commit verification wiring**

```bash
git add package.json tests/unit/docs/master-execution-status-docs.test.ts
git commit -m "ci(docs): verify execution ledger drift"
```

### Task 5: Phase 0 Reconciliation and Baseline Evidence

**Files:**

- Modify: `docs/development/master-execution-status.json`
- Modify: `docs/development/master-execution-status.md`

**Interfaces:**

- Consumes current GitHub issue/milestone state, repository ADR/schema/test inventory, and verification results.
- Produces auditable Phase 0 baseline and blocker snapshot.

- [ ] **Step 1: Capture current roadmap evidence**

Run:

```bash
gh issue view 191 --repo oaslananka/boardreadyops --json number,state,title,body,url
gh issue list --repo oaslananka/boardreadyops --state open --limit 500 --json number,title,milestone,labels,url
gh api 'repos/oaslananka/boardreadyops/milestones?state=all'
```

Update `roadmap.checkedAt`, ordered milestones, completed milestones, issue mappings, and duplicate redirects from these results. Store only public identifiers and URLs.

- [ ] **Step 2: Reconcile local evidence**

Run:

```bash
git ls-files "src/**" "packages/**" "apps/**" "schemas/**" "docs/architecture/adr/**" "tests/**"
```

For each workstream, verify every committed evidence path exists. Downgrade any unsupported `implemented` status and explain the exact missing evidence in `remaining`.

- [ ] **Step 3: Run focused checks before baseline**

Run:

```bash
corepack pnpm run toolchain:doctor
corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts tests/unit/docs/master-execution-status-docs.test.ts
corepack pnpm run verify:execution-status
```

Expected: PASS.

- [ ] **Step 4: Run full baseline**

Run: `task verify`

If it passes, record `baseline.result` as `pass`, the exact commit, UTC timestamp, and an empty blocker list. If it fails, record `baseline.result` as `fail` plus each exact failing command or test as a blocker; do not alter unrelated product code in this slice.

- [ ] **Step 5: Render final ledger and re-run checks**

Run:

```bash
corepack pnpm run execution-status:render
corepack pnpm run verify:execution-status
corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts tests/unit/docs/master-execution-status-docs.test.ts
```

Expected: PASS. W00 is `implemented` only if its complete evidence contract passes; otherwise it remains `partial` with exact blockers.

- [ ] **Step 6: Run formatting, typecheck, and Sonar local analysis**

Run:

```bash
corepack pnpm biome check scripts/master-execution-status.mjs scripts/master-execution-status.d.mts tests/unit/scripts/master-execution-status.test.ts tests/unit/docs/master-execution-status-docs.test.ts docs/development/master-execution-status.json docs/development/master-execution-status.md package.json
corepack pnpm run typecheck
```

Run SonarQube local analysis for changed source files, fix actionable findings, and repeat analysis until clean.

- [ ] **Step 7: Commit Phase 0 evidence**

```bash
git add docs/development/master-execution-status.json docs/development/master-execution-status.md
git commit -m "docs(docs): record phase zero verification baseline"
```

- [ ] **Step 8: Final verification**

Run:

```bash
corepack pnpm run verify:execution-status
corepack pnpm vitest run tests/unit/scripts/master-execution-status.test.ts tests/unit/docs/master-execution-status-docs.test.ts
git status --short
```

Expected: W00-owned files are clean. Pre-existing unrelated changes remain present and untouched.
