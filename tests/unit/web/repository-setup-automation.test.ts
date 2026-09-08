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

const waiverAction = {
  type: "waiver_pr.request" as const,
  installation: { id: 123 },
  repository: { id: 456, owner: "octo", name: "board", fullName: "octo/board", private: false, defaultBranch: "main" },
  ruleId: "rule.test",
  reason: "temporary exception",
  requestedBy: "octocat",
};

const releasePrepareAction = {
  type: "release.prepare" as const,
  installation: { id: 123 },
  repository: { id: 456, owner: "octo", name: "board", fullName: "octo/board", private: false, defaultBranch: "main" },
  checkRunId: 92,
  pullRequestNumber: 7,
  ref: "feature/board",
  commitSha: "a".repeat(40),
  baseCommitSha: "b".repeat(40),
  pullRequestDraft: false,
  pullRequestFromFork: false,
  requestedBy: "release-engineer",
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
      current: {
        id: "setup-1",
        installationId: "installation-1",
        repositoryId: "repository-1",
        revision: 1,
        preset: "production",
        presetVersion: 1,
        source: "workflow_probe",
        actorId: "github-actions",
        requestId: "probe-result:probe-1",
        workflowPath: "readiness-runner.yml",
        workflowContractVersion: 1,
        workflowStatus: "ready",
        configStatus: "ready",
        configVersion: 1,
        observedSha: "c".repeat(40),
        diagnostics: [],
        createdAt: "2026-09-08T18:00:00.000Z",
      },
    })),
    listRevisions: vi.fn(async () => []),
    applyRevision: vi.fn(async () => ({ outcome: "applied", revisionId: "revision-1", revision: 1 })),
    recordWaiverPrRequestAudit: vi.fn(async () => undefined),
    recordWaiverPrResultAudit: vi.fn(async () => undefined),
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
      mutationService: vi.fn(() => ({ execute, readFileSnapshot: vi.fn() })),
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
      mutationService: vi.fn(() => ({ execute, readFileSnapshot: vi.fn() })),
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
  it("fails closed before release preparation when Actions write is unavailable", async () => {
    const store = setupStore();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { pull_requests: "read", actions: "read" },
      })),
      mutationService: vi.fn(),
    });

    await expect(
      executor.prepareRelease(releasePrepareAction, {
        deliveryId: "delivery-release-prepare",
        eventType: "check_run",
        eventAction: "requested_action",
      }),
    ).rejects.toThrow(/actions:write/u);
  });

  it("fails closed when repository setup is not ready for release preparation", async () => {
    const store = setupStore();
    vi.mocked(store.getContextByGitHub).mockResolvedValueOnce({
      installationId: "installation-1",
      githubInstallationId: 123,
      repositoryId: "repository-1",
      githubRepositoryId: 456,
      owner: "octo",
      name: "board",
      private: false,
      defaultBranch: "main",
    });
    const authenticateInstallation = vi.fn();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation,
      mutationService: vi.fn(),
    });

    await expect(
      executor.prepareRelease(releasePrepareAction, {
        deliveryId: "delivery-release-unconfigured",
        eventType: "check_run",
        eventAction: "requested_action",
      }),
    ).rejects.toThrow(/setup.*ready/u);
    expect(authenticateInstallation).not.toHaveBeenCalled();
  });

  it("audits and returns an exact-SHA release run for an authorized preparation request", async () => {
    const store = setupStore();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { actions: "write" },
      })),
      mutationService: vi.fn(),
    });

    await expect(
      executor.prepareRelease(releasePrepareAction, {
        deliveryId: "delivery-release-prepare",
        eventType: "check_run",
        eventAction: "requested_action",
      }),
    ).resolves.toEqual([
      {
        type: "release_run.enqueue",
        installation: { id: 123 },
        repository: releasePrepareAction.repository,
        pullRequestNumber: 7,
        ref: "feature/board",
        commitSha: "a".repeat(40),
        baseCommitSha: "b".repeat(40),
        triggerKind: "pr",
        pullRequestDraft: false,
        pullRequestFromFork: false,
        deliveryId: "delivery-release-prepare",
        idempotencyScope: "release-prepare:delivery-release-prepare",
      },
    ]);
  });

  it("fails closed before waiver mutation when effective installation permissions cannot create a waiver PR", async () => {
    const store = setupStore();
    const execute = vi.fn();
    const readFileSnapshot = vi.fn();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({ token: "token", permissions: { pull_requests: "read" } })),
      mutationService: vi.fn(() => ({ execute, readFileSnapshot })),
    });

    await expect(
      executor.createWaiverPr(waiverAction, {
        deliveryId: "delivery-waiver",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).rejects.toThrow(/contents:write.*pull_requests:write/u);
    expect(readFileSnapshot).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("reads the exact base config and preserves it while creating an idempotent waiver PR", async () => {
    const store = setupStore();
    const recordWaiverPrRequestAudit = vi.mocked(store.recordWaiverPrRequestAudit);
    const recordWaiverPrResultAudit = vi.mocked(store.recordWaiverPrResultAudit);
    const readFileSnapshot = vi.fn(async () => ({
      baseCommitSha: "a".repeat(40),
      content: "version: 1\nmode: enforce\nrules:\n  bom.missing-mpn: true\n",
    }));
    const execute = vi.fn(async () => ({
      outcome: "created" as const,
      branchName: "boardreadyops/waiver-rule.test",
      commitSha: "b".repeat(40),
      pullRequestNumber: 14,
      pullRequestUrl: "https://github.test/octo/board/pull/14",
    }));
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { contents: "write", pull_requests: "write" },
      })),
      mutationService: vi.fn(() => ({ execute, readFileSnapshot })),
    });

    await executor.createWaiverPr(waiverAction, {
      deliveryId: "delivery-waiver",
      eventType: "issue_comment",
      eventAction: "created",
    });

    expect(readFileSnapshot).toHaveBeenCalledWith({
      owner: "octo",
      repo: "board",
      defaultBranch: "main",
      path: "boardreadyops.yml",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 123,
        owner: "octo",
        repo: "board",
        intent: "waiver",
        actorId: "octocat",
        requestId: "github:delivery-waiver",
        expectedBaseCommitSha: "a".repeat(40),
        files: [
          expect.objectContaining({
            path: "boardreadyops.yml",
            content: expect.stringMatching(
              /mode: enforce[\s\S]*bom\.missing-mpn: true[\s\S]*rule: rule\.test[\s\S]*reason: temporary exception/u,
            ),
          }),
        ],
      }),
    );
    expect(recordWaiverPrRequestAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "installation-1",
        repositoryId: "repository-1",
        actorId: "octocat",
        requestId: "github:delivery-waiver",
      }),
    );
    expect(recordWaiverPrRequestAudit.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[0] ?? 0,
    );
    expect(recordWaiverPrResultAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "installation-1",
        repositoryId: "repository-1",
        actorId: "octocat",
        requestId: "github:delivery-waiver",
        outcome: "created",
        pullRequestNumber: 14,
      }),
    );
  });

  it("does not mutate when the identical waiver already exists on the default branch", async () => {
    const store = setupStore();
    const recordWaiverPrRequestAudit = vi.mocked(store.recordWaiverPrRequestAudit);
    const recordWaiverPrResultAudit = vi.mocked(store.recordWaiverPrResultAudit);
    const readFileSnapshot = vi.fn(async () => ({
      baseCommitSha: "a".repeat(40),
      content:
        "version: 1\nmode: enforce\nwaivers:\n  - rule: rule.test\n    owner: octocat\n    reason: temporary exception\n",
    }));
    const execute = vi.fn();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { contents: "write", pull_requests: "write" },
      })),
      mutationService: vi.fn(() => ({ execute, readFileSnapshot })),
    });

    await executor.createWaiverPr(waiverAction, {
      deliveryId: "delivery-waiver-duplicate",
      eventType: "issue_comment",
      eventAction: "created",
    });

    expect(recordWaiverPrRequestAudit).toHaveBeenCalledOnce();
    expect(readFileSnapshot).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(recordWaiverPrResultAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "already_present" }));
    expect(recordWaiverPrResultAudit.mock.calls[0]?.[0]).not.toHaveProperty("pullRequestNumber");
  });

  it("rejects a waiver request without an explicit rule and audit reason", async () => {
    const store = setupStore();
    const readFileSnapshot = vi.fn();
    const execute = vi.fn();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { contents: "write", pull_requests: "write" },
      })),
      mutationService: vi.fn(() => ({ execute, readFileSnapshot })),
    });

    await expect(
      executor.createWaiverPr(
        { ...waiverAction, reason: undefined },
        { deliveryId: "delivery-waiver", eventType: "check_run" },
      ),
    ).rejects.toThrow(/rule.*reason.*required/iu);
    expect(readFileSnapshot).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
