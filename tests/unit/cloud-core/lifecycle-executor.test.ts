import { describe, expect, it, vi } from "vitest";
import type { GitHubAppLifecycleAction } from "../../../packages/cloud-core/src/lifecycle.js";
import {
  type DispatchReleaseRunWorkflowInput,
  type EnqueueReleaseRunInput,
  executeGitHubAppLifecycleActions,
  type GitHubAppLifecycleStore,
  releaseRunIdempotencyKey,
} from "../../../packages/cloud-core/src/lifecycle-executor.js";

const installation = {
  id: 12345,
  accountLogin: "octo-org",
  accountType: "Organization",
};

const privateRepository = {
  id: 98765,
  owner: "octo-org",
  name: "hardware-board",
  fullName: "octo-org/hardware-board",
  private: true,
  defaultBranch: "main",
};

const publicRepository = {
  ...privateRepository,
  private: false,
};

function releaseAction(overrides: Partial<EnqueueReleaseRunInput> = {}): EnqueueReleaseRunInput {
  return {
    type: "release_run.enqueue",
    installation,
    repository: publicRepository,
    pullRequestNumber: 12,
    ref: "feature/ready",
    commitSha: "0123456789abcdef",
    triggerKind: "pr",
    pullRequestDraft: false,
    pullRequestFromFork: false,
    ...overrides,
  };
}

function lifecycleStore(overrides: Partial<GitHubAppLifecycleStore> = {}): GitHubAppLifecycleStore {
  return {
    upsertInstallation: vi.fn(async () => undefined),
    deleteInstallation: vi.fn(async () => undefined),
    upsertRepository: vi.fn(async () => undefined),
    removeRepository: vi.fn(async () => undefined),
    enqueueReleaseRun: vi.fn(async () => ({
      idempotencyKey: "98765:12:0123456789abcdef",
      runId: "run-row-id",
    })),
    attachGitHubCheckRun: vi.fn(async () => undefined),
    bindReleaseRunExecutionAttempt: vi.fn(async () => true),
    markReleaseRunDispatched: vi.fn(async () => undefined),
    markReleaseRunSkipped: vi.fn(async () => undefined),
    ...overrides,
  };
}

function checkRunClient() {
  return {
    createPullRequestCheckRun: vi.fn(async () => ({ id: 555 })),
    completeCheckRun: vi.fn(async () => undefined),
  };
}

function workflowClient() {
  return {
    dispatchReleaseRunWorkflow: vi.fn(async (_input: DispatchReleaseRunWorkflowInput) => ({
      workflowDispatchId: "dispatch-123",
    })),
  };
}

describe("GitHub App lifecycle execution", () => {
  it("dispatches lifecycle actions to the configured store in order", async () => {
    const calls: string[] = [];
    const store = lifecycleStore({
      upsertInstallation: vi.fn(async () => {
        calls.push("installation.upsert");
      }),
      upsertRepository: vi.fn(async () => {
        calls.push("repository.upsert");
      }),
      enqueueReleaseRun: vi.fn(async () => {
        calls.push("release_run.enqueue");
        return { idempotencyKey: "98765:12:0123456789abcdef", runId: "run-row-id" };
      }),
    });
    const actions: GitHubAppLifecycleAction[] = [
      { type: "installation.upsert", installation },
      { type: "repository.upsert", installation, repository: privateRepository },
      releaseAction({ repository: privateRepository }),
    ];

    const result = await executeGitHubAppLifecycleActions(actions, store);

    expect(calls).toEqual(["installation.upsert", "repository.upsert", "release_run.enqueue"]);
    expect(result).toEqual({
      total: 3,
      installationsUpserted: 1,
      installationsDeleted: 0,
      repositoriesUpserted: 1,
      repositoriesRemoved: 0,
      releaseRunsQueued: 1,
      checkRunsCreated: 0,
      checkRunsSkipped: 0,
      workflowDispatchesCreated: 0,
      workflowDispatchesSkipped: 1,
    });
  });

  it("creates a stable release run idempotency key", () => {
    expect(releaseRunIdempotencyKey(releaseAction())).toBe("98765:12:0123456789abcdef");
  });

  it("dispatches a private same-repository pull request with safe-mode metadata", async () => {
    const store = lifecycleStore();
    const checks = checkRunClient();
    const workflows = workflowClient();
    const action = releaseAction({
      repository: privateRepository,
      safeMode: { enabled: true, reasons: ["private-repository"] },
    });

    const result = await executeGitHubAppLifecycleActions([action], store, checks, workflows);

    expect(workflows.dispatchReleaseRunWorkflow).toHaveBeenCalledWith({
      action,
      runId: "run-row-id",
      idempotencyKey: "98765:12:0123456789abcdef",
      githubCheckRunId: 555,
      executionAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(store.bindReleaseRunExecutionAttempt).toHaveBeenCalledWith({
      runId: "run-row-id",
      executionAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      startedAt: expect.any(String),
    });
    expect(store.markReleaseRunDispatched).toHaveBeenCalledWith({
      runId: "run-row-id",
      executionAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      dispatchedAt: expect.any(String),
      workflowDispatchId: "dispatch-123",
    });
    expect(store.markReleaseRunSkipped).not.toHaveBeenCalled();
    expect(checks.completeCheckRun).not.toHaveBeenCalled();
    expect(result.workflowDispatchesCreated).toBe(1);
    expect(result.workflowDispatchesSkipped).toBe(0);
  });

  it.each([
    {
      label: "draft pull request",
      action: releaseAction({
        pullRequestDraft: true,
        safeMode: { enabled: true, reasons: ["draft-pull-request"] },
      }),
      summary: "draft pull request",
    },
    {
      label: "fork pull request",
      action: releaseAction({
        pullRequestFromFork: true,
        safeMode: { enabled: true, reasons: ["fork-pull-request"] },
      }),
      summary: "fork pull request safe mode",
    },
  ])("terminalizes a skipped $label as completed and neutral", async ({ action, summary }) => {
    const store = lifecycleStore();
    const checks = checkRunClient();
    const workflows = workflowClient();

    const result = await executeGitHubAppLifecycleActions([action], store, checks, workflows);

    expect(workflows.dispatchReleaseRunWorkflow).not.toHaveBeenCalled();
    expect(store.markReleaseRunDispatched).not.toHaveBeenCalled();
    expect(store.markReleaseRunSkipped).toHaveBeenCalledOnce();
    const completedAt = vi.mocked(store.markReleaseRunSkipped).mock.calls[0]?.[0].completedAt;
    expect(completedAt).toBeDefined();
    expect(new Date(completedAt ?? "").toISOString()).toBe(completedAt);
    expect(checks.completeCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-row-id",
        checkRunId: 555,
        conclusion: "neutral",
        completedAt,
        summary: expect.stringContaining(summary),
      }),
    );
    expect(result.workflowDispatchesCreated).toBe(0);
    expect(result.workflowDispatchesSkipped).toBe(1);
  });

  it("leaves a run queued when self-hosted mode provides no workflow dispatch client", async () => {
    const store = lifecycleStore();
    const checks = checkRunClient();

    const result = await executeGitHubAppLifecycleActions([releaseAction()], store, checks);

    expect(store.markReleaseRunDispatched).not.toHaveBeenCalled();
    expect(store.markReleaseRunSkipped).not.toHaveBeenCalled();
    expect(checks.completeCheckRun).not.toHaveBeenCalled();
    expect(result.workflowDispatchesCreated).toBe(0);
    expect(result.workflowDispatchesSkipped).toBe(1);
  });

  it("retries a queued run that already has a check after dispatch failure", async () => {
    const enqueueReleaseRun = vi
      .fn()
      .mockResolvedValueOnce({
        idempotencyKey: "98765:12:0123456789abcdef",
        runId: "run-row-id",
        status: "queued",
      })
      .mockResolvedValueOnce({
        idempotencyKey: "98765:12:0123456789abcdef",
        runId: "run-row-id",
        githubCheckRunId: 555,
        status: "queued",
      });
    const store = lifecycleStore({ enqueueReleaseRun });
    const checks = checkRunClient();
    const workflows = workflowClient();
    workflows.dispatchReleaseRunWorkflow
      .mockRejectedValueOnce(new Error("dispatch unavailable"))
      .mockResolvedValueOnce({ workflowDispatchId: "dispatch-retry" });

    await expect(executeGitHubAppLifecycleActions([releaseAction()], store, checks, workflows)).rejects.toThrow(
      "dispatch unavailable",
    );
    const retry = await executeGitHubAppLifecycleActions([releaseAction()], store, checks, workflows);

    expect(checks.createPullRequestCheckRun).toHaveBeenCalledOnce();
    expect(store.attachGitHubCheckRun).toHaveBeenCalledOnce();
    expect(workflows.dispatchReleaseRunWorkflow).toHaveBeenCalledTimes(2);
    const firstAttemptId = workflows.dispatchReleaseRunWorkflow.mock.calls[0]?.[0].executionAttemptId;
    const secondAttemptId = workflows.dispatchReleaseRunWorkflow.mock.calls[1]?.[0].executionAttemptId;
    expect(firstAttemptId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(secondAttemptId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(secondAttemptId).not.toBe(firstAttemptId);
    expect(store.markReleaseRunDispatched).toHaveBeenCalledOnce();
    expect(retry.checkRunsSkipped).toBe(1);
    expect(retry.workflowDispatchesCreated).toBe(1);
  });

  it("does not dispatch when the queued run is no longer claimable", async () => {
    const store = lifecycleStore({ bindReleaseRunExecutionAttempt: vi.fn(async () => false) });
    const workflows = workflowClient();

    const result = await executeGitHubAppLifecycleActions([releaseAction()], store, checkRunClient(), workflows);

    expect(store.bindReleaseRunExecutionAttempt).toHaveBeenCalledOnce();
    expect(workflows.dispatchReleaseRunWorkflow).not.toHaveBeenCalled();
    expect(store.markReleaseRunDispatched).not.toHaveBeenCalled();
    expect(result.workflowDispatchesCreated).toBe(0);
    expect(result.workflowDispatchesSkipped).toBe(1);
  });

  it("repairs the neutral check for an already completed safe-mode run", async () => {
    const store = lifecycleStore({
      enqueueReleaseRun: vi.fn(async () => ({
        idempotencyKey: "98765:12:0123456789abcdef",
        runId: "run-row-id",
        githubCheckRunId: "555",
        status: "completed",
      })),
    });
    const checks = checkRunClient();
    const action = releaseAction({
      pullRequestFromFork: true,
      safeMode: { enabled: true, reasons: ["fork-pull-request"] },
    });

    const result = await executeGitHubAppLifecycleActions([action], store, checks, workflowClient());

    expect(store.markReleaseRunSkipped).not.toHaveBeenCalled();
    expect(checks.completeCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ checkRunId: "555", conclusion: "neutral" }),
    );
    expect(result.checkRunsSkipped).toBe(1);
    expect(result.workflowDispatchesSkipped).toBe(1);
  });

  it("does not redispatch a run that is already dispatched", async () => {
    const store = lifecycleStore({
      enqueueReleaseRun: vi.fn(async () => ({
        idempotencyKey: "98765:12:0123456789abcdef",
        runId: "run-row-id",
        githubCheckRunId: 555,
        status: "dispatched",
      })),
    });
    const workflows = workflowClient();

    const result = await executeGitHubAppLifecycleActions([releaseAction()], store, checkRunClient(), workflows);

    expect(workflows.dispatchReleaseRunWorkflow).not.toHaveBeenCalled();
    expect(store.markReleaseRunDispatched).not.toHaveBeenCalled();
    expect(result.checkRunsSkipped).toBe(1);
    expect(result.workflowDispatchesSkipped).toBe(1);
  });

  it("does not mark a run dispatched when workflow dispatch fails", async () => {
    const store = lifecycleStore();
    const checks = checkRunClient();
    const workflows = workflowClient();
    workflows.dispatchReleaseRunWorkflow.mockRejectedValueOnce(new Error("dispatch unavailable"));

    await expect(executeGitHubAppLifecycleActions([releaseAction()], store, checks, workflows)).rejects.toThrow(
      "dispatch unavailable",
    );
    expect(store.markReleaseRunDispatched).not.toHaveBeenCalled();
    expect(store.markReleaseRunSkipped).not.toHaveBeenCalled();
  });
});
