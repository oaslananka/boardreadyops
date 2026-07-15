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
  it("loads the target repository and default branch from the release run", async () => {
    const query = vi.fn(async (_sql: string, _params: readonly unknown[]) => ({
      rows: [{ owner: "octo-org", name: "hardware-board", github_repo_id: "98765", default_branch: "trunk" }],
    }));

    await expect(resultOidcExpectations({ query }, runId, executionAttemptId)).resolves.toEqual({
      runId,
      executionAttemptId,
      repository: "octo-org/hardware-board",
      repositoryId: "98765",
      workflowRef: "octo-org/hardware-board/.github/workflows/readiness-runner.yml@refs/heads/trunk",
      ref: "refs/heads/trunk",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("release_runs.execution_attempt_id is not distinct from $2"),
      [runId, executionAttemptId],
    );
    expect(query.mock.calls[0]?.[0]).toContain("release_run_attempts.github_workflow_dispatch_id is not null");
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
