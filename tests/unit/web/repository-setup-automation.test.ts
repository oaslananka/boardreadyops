import { describe, expect, it, vi } from "vitest";
import { createRepositorySetupLifecycleExecutor } from "../../../apps/web/lib/repository-setup-automation.js";
import type { RepositorySetupStore } from "../../../packages/db/src/repository-setup-store.js";

const action = {
  type: "setup_pr.create" as const,
  installation: { id: 123 },
  repository: { id: 456, owner: "octo", name: "board", fullName: "octo/board", private: false, defaultBranch: "main" },
  checkRunId: 91,
  requestedBy: "octocat",
};

function setupStore(): RepositorySetupStore {
  return {
    getContext: vi.fn(),
    getContextByGitHub: vi.fn(async () => ({
      installationId: "installation-1",
      githubInstallationId: 123,
      repositoryId: "repository-1",
      githubRepositoryId: 456,
      owner: "octo",
      name: "board",
      private: false,
      defaultBranch: "main",
    })),
    listRevisions: vi.fn(async () => []),
    applyRevision: vi.fn(async () => ({ outcome: "applied", revisionId: "revision-1", revision: 1 })),
    createProbe: vi.fn(),
    getProbe: vi.fn(),
    markProbeDispatched: vi.fn(),
    failProbe: vi.fn(),
    completeProbe: vi.fn(),
  };
}

describe("repository setup lifecycle automation", () => {
  it("fails closed before mutation when effective installation permissions cannot create a setup PR", async () => {
    const store = setupStore();
    const execute = vi.fn();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { checks: "write", actions: "write", pull_requests: "read" },
      })),
      mutationService: vi.fn(() => ({ execute })),
    });

    await expect(
      executor.createSetupPr(action, {
        deliveryId: "delivery-1",
        eventType: "check_run",
        eventAction: "requested_action",
      }),
    ).rejects.toThrow(/contents:write.*workflows:write.*pull_requests:write/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it("creates an idempotent setup PR and records the setup revision when capabilities are available", async () => {
    const store = setupStore();
    const execute = vi.fn(async () => ({
      outcome: "created" as const,
      branchName: "boardreadyops/setup",
      commitSha: "a".repeat(40),
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.test/octo/board/pull/12",
    }));
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { contents: "write", workflows: "write", pull_requests: "write" },
      })),
      mutationService: vi.fn(() => ({ execute })),
    });

    await executor.createSetupPr(action, {
      deliveryId: "delivery-1",
      eventType: "check_run",
      eventAction: "requested_action",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 123,
        owner: "octo",
        repo: "board",
        intent: "setup",
        actorId: "octocat",
        requestId: "github:delivery-1",
      }),
    );
    expect(store.applyRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "installation-1",
        repositoryId: "repository-1",
        source: "operator",
        actorId: "octocat",
        workflowStatus: "unknown",
        configStatus: "unknown",
      }),
    );
  });
});
