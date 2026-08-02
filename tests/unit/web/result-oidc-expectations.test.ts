import { afterEach, describe, expect, it, vi } from "vitest";
import { resultOidcExpectations } from "../../../apps/web/lib/result-oidc-expectations.js";

const runId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const executionAttemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
const originalWorkflow = process.env.BOARDREADYOPS_DISPATCH_WORKFLOW;

afterEach(() => {
  if (originalWorkflow === undefined) delete process.env.BOARDREADYOPS_DISPATCH_WORKFLOW;
  else process.env.BOARDREADYOPS_DISPATCH_WORKFLOW = originalWorkflow;
});

describe("result OIDC repository binding", () => {
  it("loads the target repository, default branch, and persisted trust snapshot from the release run", async () => {
    const query = vi.fn(async (_sql: string, _params: readonly unknown[]) => ({
      rows: [
        {
          owner: "octo-org",
          name: "hardware-board",
          github_repo_id: "98765",
          default_branch: "trunk",
          commit_sha: "a".repeat(40),
          trust_mode: "safe",
          safe_mode_reasons: ["private-repository"],
        },
      ],
    }));

    await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toEqual({
      runId,
      executionAttemptId,
      repository: "octo-org/hardware-board",
      repositoryId: "98765",
      sha: "a".repeat(40),
      workflowRef: "octo-org/hardware-board/.github/workflows/readiness-runner.yml@refs/heads/trunk",
      ref: "refs/heads/trunk",
      audience:
        "boardreadyops-cloud:5dc4193b-5c7e-4df8-b86f-e4d3266fc22d:7559e99b-4998-4e02-a94a-7a7a4686ae11:safe:private-repository",
      trustMode: "safe",
      safeModeReasons: ["private-repository"],
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("release_runs.execution_attempt_id is not distinct from $2"),
      [runId, executionAttemptId],
    );
    expect(query.mock.calls[0]?.[0]).toContain("release_run_attempts.github_workflow_dispatch_id is not null");
    expect(query.mock.calls[0]?.[0]).toContain("release_runs.trust_mode");
    expect(query.mock.calls[0]?.[0]).toContain("release_runs.safe_mode_reasons");
  });

  it("accepts only canonical trust snapshots", async () => {
    const query = vi.fn();
    const baseRow = {
      owner: "octo-org",
      name: "hardware-board",
      github_repo_id: "98765",
      default_branch: "trunk",
      commit_sha: "a".repeat(40),
    };

    query.mockResolvedValueOnce({ rows: [{ ...baseRow, trust_mode: "standard", safe_mode_reasons: [] }] });
    await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toMatchObject({
      audience:
        "boardreadyops-cloud:5dc4193b-5c7e-4df8-b86f-e4d3266fc22d:7559e99b-4998-4e02-a94a-7a7a4686ae11:standard:none",
      trustMode: "standard",
      safeModeReasons: [],
    });

    for (const trust of [
      { trust_mode: "safe", safe_mode_reasons: [] },
      { trust_mode: "standard", safe_mode_reasons: ["private-repository"] },
      { trust_mode: "safe", safe_mode_reasons: ["unknown"] },
      { trust_mode: "safe", safe_mode_reasons: ["private-repository", "private-repository"] },
      { trust_mode: "safe", safe_mode_reasons: ["private-repository", "draft-pull-request"] },
    ]) {
      query.mockResolvedValueOnce({ rows: [{ ...baseRow, ...trust }] });
      await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toBeUndefined();
    }
  });

  it("fails closed when the persisted commit SHA is not exact", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          owner: "octo-org",
          name: "hardware-board",
          github_repo_id: "98765",
          default_branch: "trunk",
          commit_sha: "main",
          trust_mode: "standard",
          safe_mode_reasons: [],
        },
      ],
    }));

    await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toBeUndefined();
  });

  it("fails closed for an unknown run or invalid workflow configuration", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toBeUndefined();

    process.env.BOARDREADYOPS_DISPATCH_WORKFLOW = "../unsafe.yml";
    query.mockClear();
    await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});
