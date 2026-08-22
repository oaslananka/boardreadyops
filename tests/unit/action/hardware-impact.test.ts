import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../../../src/core/result.js";

const mocks = vi.hoisted(() => ({
  context: { payload: {} as Record<string, unknown> },
  getOctokit: vi.fn(),
  execFile: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  loadExactBaseRunResult: vi.fn(),
}));

vi.mock("@actions/github", () => ({
  context: mocks.context,
  getOctokit: mocks.getOctokit,
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

vi.mock("node:fs/promises", () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
}));

vi.mock("../../../src/action/previous-result.js", () => ({
  loadExactBaseRunResult: mocks.loadExactBaseRunResult,
}));

import { buildActionHardwareImpact } from "../../../src/action/hardware-impact.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const cloudRunId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const workspace = "/workspace";
const dotGit = path.join(workspace, ".git");

function run(score = 80): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.32.1" },
    status: "passed",
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, maxSeverity: "none", failed: false },
    readiness: {
      score,
      status: "ready",
      blocking: 0,
      nonBlocking: 0,
      evidence: [],
      missingRequired: [],
      missingRecommended: [],
      warnings: [],
    },
    projects: [],
    findings: [],
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-08-22T00:00:00.000Z",
  };
}

function setCommonEnv() {
  process.env.GITHUB_TOKEN = "token";
  process.env.GITHUB_REPOSITORY = "octo/board";
  process.env.GITHUB_RUN_ID = "900";
}

beforeEach(() => {
  mocks.context.payload = {};
  mocks.getOctokit.mockReset();
  mocks.execFile.mockReset();
  mocks.stat.mockReset();
  mocks.readFile.mockReset();
  mocks.loadExactBaseRunResult.mockReset();
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => callback(null, `${headSha}\n`, ""));
  mocks.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false });
  mocks.readFile.mockResolvedValue(`${headSha}\n`);
  mocks.loadExactBaseRunResult.mockResolvedValue({ status: "available", baseSha, runId: 700, result: run(82) });
  setCommonEnv();
});

afterEach(() => {
  for (const key of [
    "GITHUB_TOKEN",
    "GITHUB_REPOSITORY",
    "GITHUB_RUN_ID",
    "BOARDREADYOPS_PR_HEAD_SHA",
    "BOARDREADYOPS_CLOUD_RUN_ID",
  ]) {
    delete process.env[key];
  }
});

describe("buildActionHardwareImpact", () => {
  it("uses trusted pull_request base/head SHAs", async () => {
    mocks.context.payload = {
      pull_request: {
        base: { sha: baseSha, repo: { full_name: "octo/board" } },
        head: { sha: headSha, repo: { full_name: "octo/board" } },
      },
    };

    const impact = await buildActionHardwareImpact(run(71), { workspace: "/workspace", artifactName: "boardreadyops" });

    expect(mocks.loadExactBaseRunResult).toHaveBeenCalledWith({
      token: "token",
      owner: "octo",
      repo: "board",
      artifactName: "boardreadyops",
      baseSha,
      candidateSha: headSha,
      analyzedSha: headSha,
      currentRunId: 900,
    });
    expect(mocks.stat).toHaveBeenCalledWith(dotGit);
    expect(mocks.readFile).toHaveBeenCalledWith(path.join(dotGit, "HEAD"), "utf8");
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(impact).toMatchObject({
      baseline: { status: "available", sha: baseSha },
      candidate: { sha: headSha },
      facts: { readiness: { previousScore: 82, currentScore: 71, scoreDelta: -11 } },
    });
  });

  it("resolves the analyzed SHA from worktree git metadata without invoking git", async () => {
    mocks.context.payload = {
      pull_request: {
        base: { sha: baseSha, repo: { full_name: "octo/board" } },
        head: { sha: headSha, repo: { full_name: "octo/board" } },
      },
    };
    mocks.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
    const worktreeGitDirectory = path.resolve(path.dirname(dotGit), "repo/.git/worktrees/board");
    mocks.readFile.mockImplementation(async (file) => {
      if (file === dotGit) return `gitdir: ${worktreeGitDirectory}\n`;
      if (file === path.join(worktreeGitDirectory, "HEAD")) return `${headSha}\n`;
      throw new Error(`unexpected read: ${String(file)}`);
    });

    await buildActionHardwareImpact(run(), { workspace: "/workspace", artifactName: "boardreadyops" });

    expect(mocks.loadExactBaseRunResult).toHaveBeenCalledWith(expect.objectContaining({ analyzedSha: headSha }));
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("resolves a symbolic HEAD from a loose ref without invoking git", async () => {
    mocks.context.payload = {
      pull_request: {
        base: { sha: baseSha, repo: { full_name: "octo/board" } },
        head: { sha: headSha, repo: { full_name: "octo/board" } },
      },
    };
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    mocks.readFile.mockImplementation(async (file) => {
      if (file === path.join(dotGit, "HEAD")) return "ref: refs/heads/feature/hardware-impact\n";
      if (file === path.join(dotGit, "commondir")) throw missing;
      if (file === path.join(dotGit, "refs", "heads", "feature", "hardware-impact")) return `${headSha}\n`;
      throw new Error(`unexpected read: ${String(file)}`);
    });

    await buildActionHardwareImpact(run(), { workspace: "/workspace", artifactName: "boardreadyops" });

    expect(mocks.loadExactBaseRunResult).toHaveBeenCalledWith(expect.objectContaining({ analyzedSha: headSha }));
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("uses the hosted BoardReadyOps Check Run as the trusted base binding", async () => {
    process.env.BOARDREADYOPS_PR_HEAD_SHA = headSha;
    process.env.BOARDREADYOPS_CLOUD_RUN_ID = cloudRunId;
    const listForRef = vi.fn();
    const paginate = vi.fn(async () => [
      {
        name: "BoardReadyOps / release readiness",
        external_id: cloudRunId,
        head_sha: headSha,
        output: { summary: `Trust mode: Standard\nImpact base SHA: ${baseSha}` },
      },
    ]);
    mocks.getOctokit.mockReturnValue({ rest: { checks: { listForRef } }, paginate });

    const impact = await buildActionHardwareImpact(run(71), { workspace: "/workspace", artifactName: "boardreadyops" });

    expect(paginate).toHaveBeenCalledWith(listForRef, {
      owner: "octo",
      repo: "board",
      ref: headSha,
      check_name: "BoardReadyOps / release readiness",
      filter: "all",
      per_page: 100,
    });
    expect(mocks.loadExactBaseRunResult).toHaveBeenCalledWith(
      expect.objectContaining({ baseSha, candidateSha: headSha }),
    );
    expect(impact?.baseline).toEqual({ status: "available", sha: baseSha });
  });

  it.each([
    [
      "a missing marker",
      [
        {
          name: "BoardReadyOps / release readiness",
          external_id: cloudRunId,
          head_sha: headSha,
          output: { summary: "Trust mode: Standard" },
        },
      ],
    ],
    [
      "the wrong external id",
      [
        {
          name: "BoardReadyOps / release readiness",
          external_id: "other-run",
          head_sha: headSha,
          output: { summary: `Impact base SHA: ${baseSha}` },
        },
      ],
    ],
    [
      "the wrong head sha",
      [
        {
          name: "BoardReadyOps / release readiness",
          external_id: cloudRunId,
          head_sha: "c".repeat(40),
          output: { summary: `Impact base SHA: ${baseSha}` },
        },
      ],
    ],
    [
      "duplicate matching Check Runs",
      [
        {
          name: "BoardReadyOps / release readiness",
          external_id: cloudRunId,
          head_sha: headSha,
          output: { summary: `Impact base SHA: ${baseSha}` },
        },
        {
          name: "BoardReadyOps / release readiness",
          external_id: cloudRunId,
          head_sha: headSha,
          output: { summary: `Impact base SHA: ${baseSha}` },
        },
      ],
    ],
    [
      "a malformed marker",
      [
        {
          name: "BoardReadyOps / release readiness",
          external_id: cloudRunId,
          head_sha: headSha,
          output: { summary: "Impact base SHA: not-a-sha" },
        },
      ],
    ],
  ])("rejects hosted binding with %s", async (_label, checks) => {
    process.env.BOARDREADYOPS_PR_HEAD_SHA = headSha;
    process.env.BOARDREADYOPS_CLOUD_RUN_ID = cloudRunId;
    const listForRef = vi.fn();
    const paginate = vi.fn(async () => checks);
    mocks.getOctokit.mockReturnValue({ rest: { checks: { listForRef } }, paginate });

    await expect(
      buildActionHardwareImpact(run(), { workspace: "/workspace", artifactName: "boardreadyops" }),
    ).resolves.toBeUndefined();
    expect(mocks.loadExactBaseRunResult).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("returns undefined when there is no PR comparison context", async () => {
    await expect(
      buildActionHardwareImpact(run(), { workspace: "/workspace", artifactName: "boardreadyops" }),
    ).resolves.toBeUndefined();
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.loadExactBaseRunResult).not.toHaveBeenCalled();
  });

  it("returns undefined without a repository-scoped token", async () => {
    delete process.env.GITHUB_TOKEN;
    mocks.context.payload = {
      pull_request: {
        base: { sha: baseSha, repo: { full_name: "octo/board" } },
        head: { sha: headSha, repo: { full_name: "octo/board" } },
      },
    };

    await expect(
      buildActionHardwareImpact(run(), { workspace: "/workspace", artifactName: "boardreadyops" }),
    ).resolves.toBeUndefined();
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.loadExactBaseRunResult).not.toHaveBeenCalled();
  });
});
