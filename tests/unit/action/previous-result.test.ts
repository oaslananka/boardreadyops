import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFinding } from "../../../src/core/findings.js";

const exactLookupMocks = vi.hoisted(() => ({
  getOctokit: vi.fn(),
  listArtifacts: vi.fn(),
  downloadArtifact: vi.fn(),
}));

vi.mock("@actions/github", () => ({
  context: { payload: {} },
  getOctokit: exactLookupMocks.getOctokit,
}));

vi.mock("@actions/artifact", () => ({
  DefaultArtifactClient: class {
    listArtifacts = exactLookupMocks.listArtifacts;
    downloadArtifact = exactLookupMocks.downloadArtifact;
  },
}));

import { findRunResultArtifact, loadExactBaseRunResult, previousRunIds } from "../../../src/action/previous-result.js";

const baseSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const workflowId = 77;
const currentRunId = 900;

type MockRun = { id: number; head_sha: string; workflow_id: number; conclusion?: string };

type ArtifactFixture =
  | { kind: "missing" }
  | { kind: "named"; payload: unknown | string }
  | { kind: "wrong-name"; payload: unknown | string };

function validComparisonReport() {
  const item = createFinding({
    ruleId: "bom.missing-mpn",
    severity: "high",
    message: "R1 missing MPN",
    resource: { path: "bom.csv", kind: "bom" },
  });
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.32.1" },
    status: "passed",
    summary: { total: 1, bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 }, failed: true },
    projects: [],
    findings: [item],
    fabrication: {
      bom: [{ reference: "R1", value: "10k", footprint: "0402" }],
      outputs: [{ kind: "gerber", files: [{ path: "fab/top.gbr", digest: "abc" }] }],
    },
    readiness: {
      score: 82,
      status: "ready",
      blocking: 0,
      nonBlocking: 0,
      evidence: [],
      missingRequired: [],
      missingRecommended: [],
      warnings: [],
    },
    generatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function configureExactLookup(runs: MockRun[], artifacts: Map<number, ArtifactFixture>) {
  const getWorkflowRun = vi.fn(async () => ({ data: { workflow_id: workflowId } }));
  const listWorkflowRuns = vi.fn();
  const paginate = vi.fn(async () => runs);
  const downloadPaths: string[] = [];

  exactLookupMocks.getOctokit.mockReturnValue({
    rest: { actions: { getWorkflowRun, listWorkflowRuns } },
    paginate,
  });
  exactLookupMocks.listArtifacts.mockImplementation(async ({ findBy }: { findBy: { workflowRunId: number } }) => {
    const fixture = artifacts.get(findBy.workflowRunId) ?? { kind: "missing" as const };
    if (fixture.kind === "missing") return { artifacts: [] };
    return {
      artifacts: [{ id: findBy.workflowRunId, name: fixture.kind === "named" ? "boardreadyops" : "other" }],
    };
  });
  exactLookupMocks.downloadArtifact.mockImplementation(async (artifactId: number, options: { path: string }) => {
    const fixture = artifacts.get(artifactId);
    if (!fixture || fixture.kind === "missing") throw new Error("missing artifact fixture");
    downloadPaths.push(options.path);
    await fs.mkdir(options.path, { recursive: true });
    const content = typeof fixture.payload === "string" ? fixture.payload : JSON.stringify(fixture.payload);
    await fs.writeFile(path.join(options.path, "boardreadyops.findings.json"), content, "utf8");
    return { downloadPath: options.path };
  });

  return { getWorkflowRun, listWorkflowRuns, paginate, downloadPaths };
}

function lookupInput(overrides: Partial<Parameters<typeof loadExactBaseRunResult>[0]> = {}) {
  return {
    token: "token",
    owner: "octo",
    repo: "board",
    artifactName: "boardreadyops",
    baseSha,
    candidateSha,
    analyzedSha: candidateSha,
    currentRunId,
    ...overrides,
  };
}

beforeEach(() => {
  exactLookupMocks.getOctokit.mockReset();
  exactLookupMocks.listArtifacts.mockReset();
  exactLookupMocks.downloadArtifact.mockReset();
});

describe("previous action result", () => {
  it("loads the BoardReadyOps JSON report from a downloaded artifact tree", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-artifact-"));
    await fs.mkdir(path.join(root, "reports"), { recursive: true });
    await fs.writeFile(path.join(root, "summary.json"), JSON.stringify({ tool: { name: "other" } }), "utf8");
    await fs.writeFile(
      path.join(root, "reports", "boardreadyops.findings.json"),
      JSON.stringify({
        schemaVersion: 1,
        tool: { name: "boardreadyops", version: "1.0.0" },
        summary: { total: 0 },
        projects: [],
        findings: [],
        fabrication: { bom: [], outputs: [] },
        generatedAt: "2026-05-21T00:00:00.000Z",
      }),
      "utf8",
    );

    await expect(findRunResultArtifact(root)).resolves.toMatchObject({
      tool: { name: "boardreadyops" },
      fabrication: { bom: [], outputs: [] },
    });
  });

  it("loads extensionless BoardReadyOps reports from downloaded artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-artifact-"));
    await fs.writeFile(
      path.join(root, "findings"),
      JSON.stringify({
        tool: { name: "boardreadyops", version: "1.0.0" },
        findings: [],
      }),
      "utf8",
    );

    await expect(findRunResultArtifact(root)).resolves.toMatchObject({
      tool: { name: "boardreadyops" },
      findings: [],
    });
  });

  it("excludes the in-progress workflow run from prior artifact candidates", async () => {
    const calls: unknown[] = [];
    const octokit = {
      rest: {
        actions: {
          listWorkflowRunsForRepo: async (options: unknown) => {
            calls.push(options);
            return {
              data: {
                workflow_runs: [
                  { id: 101, head_sha: "head", conclusion: "failure" },
                  { id: 102, head_sha: "head", conclusion: undefined },
                  { id: 103, head_sha: "merge", conclusion: "success" },
                ],
              },
            };
          },
        },
      },
    };

    await expect(previousRunIds(octokit as never, "owner", "repo", "pr-branch", "merge", 102)).resolves.toEqual([101]);
    expect(calls).toEqual([{ owner: "owner", repo: "repo", branch: "pr-branch", status: "completed", per_page: 100 }]);
  });
});

describe("exact-base action result", () => {
  it("selects only the same workflow identity at the exact base SHA", async () => {
    const runs: MockRun[] = [
      { id: 710, head_sha: "c".repeat(40), workflow_id: workflowId },
      { id: 705, head_sha: baseSha, workflow_id: 88 },
      { id: 700, head_sha: baseSha, workflow_id: workflowId },
    ];
    const harness = configureExactLookup(runs, new Map([[700, { kind: "named", payload: validComparisonReport() }]]));

    await expect(loadExactBaseRunResult(lookupInput())).resolves.toMatchObject({
      status: "available",
      baseSha,
      runId: 700,
      result: { tool: { name: "boardreadyops" } },
    });
    expect(harness.getWorkflowRun).toHaveBeenCalledWith({ owner: "octo", repo: "board", run_id: currentRunId });
    expect(harness.paginate).toHaveBeenCalledWith(harness.listWorkflowRuns, {
      owner: "octo",
      repo: "board",
      workflow_id: workflowId,
      status: "completed",
      head_sha: baseSha,
      per_page: 100,
    });
  });

  it("ignores newer wrong-SHA and other-workflow runs", async () => {
    const runs: MockRun[] = [
      { id: 899, head_sha: "c".repeat(40), workflow_id: workflowId },
      { id: 898, head_sha: baseSha, workflow_id: 999 },
      { id: 500, head_sha: baseSha, workflow_id: workflowId },
    ];
    configureExactLookup(runs, new Map([[500, { kind: "named", payload: validComparisonReport() }]]));

    await expect(loadExactBaseRunResult(lookupInput())).resolves.toMatchObject({ status: "available", runId: 500 });
  });

  it("sorts eligible exact-base runs by numeric run id descending independent of API order", async () => {
    const runs: MockRun[] = [101, 305, 204].map((id) => ({ id, head_sha: baseSha, workflow_id: workflowId }));
    configureExactLookup(
      runs,
      new Map(runs.map((run) => [run.id, { kind: "named" as const, payload: validComparisonReport() }])),
    );

    await expect(loadExactBaseRunResult(lookupInput())).resolves.toMatchObject({ status: "available", runId: 305 });
    expect(exactLookupMocks.listArtifacts.mock.calls[0]?.[0]).toMatchObject({ findBy: { workflowRunId: 305 } });
  });

  it("returns candidate-mismatch before GitHub or artifact discovery", async () => {
    await expect(loadExactBaseRunResult(lookupInput({ analyzedSha: "c".repeat(40) }))).resolves.toEqual({
      status: "unavailable",
      baseSha,
      reason: "candidate-mismatch",
    });
    expect(exactLookupMocks.getOctokit).not.toHaveBeenCalled();
    expect(exactLookupMocks.listArtifacts).not.toHaveBeenCalled();
  });

  it("returns not-found when no exact-base run has the configured artifact", async () => {
    configureExactLookup([{ id: 500, head_sha: baseSha, workflow_id: workflowId }], new Map());
    await expect(loadExactBaseRunResult(lookupInput())).resolves.toEqual({
      status: "unavailable",
      baseSha,
      reason: "not-found",
    });
  });

  it("returns invalid-artifact for malformed or non-BoardReadyOps named JSON", async () => {
    configureExactLookup(
      [
        { id: 501, head_sha: baseSha, workflow_id: workflowId },
        { id: 500, head_sha: baseSha, workflow_id: workflowId },
      ],
      new Map([
        [501, { kind: "named", payload: "{not-json" }],
        [500, { kind: "named", payload: { tool: { name: "other" }, findings: [] } }],
      ]),
    );
    await expect(loadExactBaseRunResult(lookupInput())).resolves.toEqual({
      status: "unavailable",
      baseSha,
      reason: "invalid-artifact",
    });
  });

  it("returns unsupported-result when BoardReadyOps JSON lacks the comparison shape", async () => {
    configureExactLookup(
      [{ id: 500, head_sha: baseSha, workflow_id: workflowId }],
      new Map([[500, { kind: "named", payload: { tool: { name: "boardreadyops", version: "1.0.0" }, findings: [] } }]]),
    );
    await expect(loadExactBaseRunResult(lookupInput())).resolves.toEqual({
      status: "unavailable",
      baseSha,
      reason: "unsupported-result",
    });
  });

  it("never considers the current workflow run as its own baseline and cleans temporary downloads", async () => {
    const harness = configureExactLookup(
      [
        { id: currentRunId, head_sha: baseSha, workflow_id: workflowId },
        { id: 800, head_sha: baseSha, workflow_id: workflowId },
      ],
      new Map([
        [currentRunId, { kind: "named", payload: validComparisonReport() }],
        [800, { kind: "named", payload: validComparisonReport() }],
      ]),
    );

    await expect(loadExactBaseRunResult(lookupInput())).resolves.toMatchObject({ status: "available", runId: 800 });
    expect(exactLookupMocks.listArtifacts).toHaveBeenCalledTimes(1);
    expect(harness.downloadPaths).toHaveLength(1);
    await expect(fs.access(harness.downloadPaths[0] as string)).rejects.toThrow();
  });
});
