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

const setupProbeAction = {
  type: "setup_probe.dispatch" as const,
  installation: { id: 123 },
  repository: { id: 456, owner: "octo", name: "board", fullName: "octo/board", private: false, defaultBranch: "main" },
  pullRequestNumber: 12,
  commitSha: "c".repeat(40),
  requestedBy: "maintainer",
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
  it("creates and dispatches one persisted setup probe for a merged setup PR", async () => {
    const store = setupStore();
    vi.mocked(store.createProbe).mockResolvedValue({
      outcome: "created",
      probeId: "11111111-1111-4111-8111-111111111111",
      setupRevisionId: "setup-1",
    });
    vi.mocked(store.markProbeDispatched).mockResolvedValue("applied");
    const inspect = vi.fn(async () => ({ actionsEnabled: true, workflowStatus: "probe_required" as const }));
    const dispatchProbe = vi.fn(async () => ({
      workflowRunId: "9988",
      workflowRunUrl: "https://github.test/run/9988",
    }));
    const now = new Date("2026-09-09T03:50:00.000Z");
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(),
      mutationService: vi.fn(),
      githubClient: { inspect, dispatchProbe },
      now: () => now,
    });
    const probeSetup = (executor as typeof executor & { probeSetup?: typeof executor.createSetupPr }).probeSetup;
    expect(probeSetup).toBeDefined();
    if (!probeSetup) return;

    await probeSetup(setupProbeAction, {
      deliveryId: "delivery-probe",
      eventType: "pull_request",
      eventAction: "closed",
    });

    expect(inspect).toHaveBeenCalledWith({ githubInstallationId: 123, owner: "octo", name: "board" });
    expect(store.createProbe).toHaveBeenCalledWith({
      installationId: "installation-1",
      repositoryId: "repository-1",
      requestedBy: "maintainer",
      requestId: "github:delivery-probe",
      expiresAt: new Date("2026-09-09T04:05:00.000Z"),
    });
    expect(dispatchProbe).toHaveBeenCalledWith({
      githubInstallationId: 123,
      owner: "octo",
      name: "board",
      defaultBranch: "main",
      probeId: "11111111-1111-4111-8111-111111111111",
    });
    expect(store.markProbeDispatched).toHaveBeenCalledWith({
      probeId: "11111111-1111-4111-8111-111111111111",
      workflowRunId: "9988",
    });
    expect(store.completeProbe).not.toHaveBeenCalled();
  });

  it.each(["dispatched", "completed"] as const)(
    "does not dispatch a second workflow when the setup probe delivery is replayed after %s",
    async (status) => {
      const store = setupStore();
      vi.mocked(store.createProbe).mockResolvedValue({
        outcome: "replayed",
        probeId: "11111111-1111-4111-8111-111111111111",
        setupRevisionId: "setup-1",
      });
      vi.mocked(store.getProbe).mockResolvedValue({
        probeId: "11111111-1111-4111-8111-111111111111",
        installationId: "installation-1",
        githubInstallationId: 123,
        repositoryId: "repository-1",
        githubRepositoryId: 456,
        owner: "octo",
        name: "board",
        defaultBranch: "main",
        preset: "production",
        presetVersion: 1,
        status,
        expiresAt: "2026-09-09T04:05:00.000Z",
      });
      const dispatchProbe = vi.fn();
      const executor = createRepositorySetupLifecycleExecutor({
        store,
        authenticateInstallation: vi.fn(),
        mutationService: vi.fn(),
        githubClient: {
          inspect: vi.fn(async () => ({ actionsEnabled: true, workflowStatus: "probe_required" as const })),
          dispatchProbe,
        },
      });

      await executor.probeSetup(setupProbeAction, {
        deliveryId: "delivery-probe",
        eventType: "pull_request",
        eventAction: "closed",
      });

      expect(dispatchProbe).not.toHaveBeenCalled();
      expect(store.markProbeDispatched).not.toHaveBeenCalled();
    },
  );

  it("redispatches the same probe id when a replay finds the probe still pending", async () => {
    const store = setupStore();
    vi.mocked(store.createProbe).mockResolvedValue({
      outcome: "replayed",
      probeId: "11111111-1111-4111-8111-111111111111",
      setupRevisionId: "setup-1",
    });
    vi.mocked(store.getProbe).mockResolvedValue({
      probeId: "11111111-1111-4111-8111-111111111111",
      installationId: "installation-1",
      githubInstallationId: 123,
      repositoryId: "repository-1",
      githubRepositoryId: 456,
      owner: "octo",
      name: "board",
      defaultBranch: "main",
      preset: "production",
      presetVersion: 1,
      status: "pending",
      expiresAt: "2026-09-09T04:05:00.000Z",
    });
    vi.mocked(store.markProbeDispatched).mockResolvedValue("applied");
    const dispatchProbe = vi.fn(async () => ({ workflowRunId: "9988" }));
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(),
      mutationService: vi.fn(),
      githubClient: {
        inspect: vi.fn(async () => ({ actionsEnabled: true, workflowStatus: "probe_required" as const })),
        dispatchProbe,
      },
    });

    await executor.probeSetup(setupProbeAction, {
      deliveryId: "delivery-probe",
      eventType: "pull_request",
      eventAction: "closed",
    });

    expect(dispatchProbe).toHaveBeenCalledWith(
      expect.objectContaining({ probeId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(store.markProbeDispatched).toHaveBeenCalledWith({
      probeId: "11111111-1111-4111-8111-111111111111",
      workflowRunId: "9988",
    });
  });

  it.each(["actions_disabled", "disabled", "incompatible"] as const)(
    "records a fail-closed setup revision instead of dispatching when merged workflow readiness is %s",
    async (workflowStatus) => {
      const store = setupStore();
      const dispatchProbe = vi.fn();
      const executor = createRepositorySetupLifecycleExecutor({
        store,
        authenticateInstallation: vi.fn(),
        mutationService: vi.fn(),
        githubClient: {
          inspect: vi.fn(async () => ({
            actionsEnabled: workflowStatus !== "actions_disabled",
            workflowStatus,
          })),
          dispatchProbe,
        },
      });

      await executor.probeSetup(setupProbeAction, {
        deliveryId: "delivery-disabled",
        eventType: "pull_request",
        eventAction: "closed",
      });

      expect(store.applyRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: "installation-1",
          repositoryId: "repository-1",
          workflowStatus,
          configStatus: "unknown",
          actorId: "maintainer",
        }),
      );
      expect(store.createProbe).not.toHaveBeenCalled();
      expect(dispatchProbe).not.toHaveBeenCalled();
    },
  );

  it("keeps a not-yet-visible merged workflow retryable without persisting false readiness", async () => {
    const store = setupStore();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(),
      mutationService: vi.fn(),
      githubClient: {
        inspect: vi.fn(async () => ({ actionsEnabled: true, workflowStatus: "missing" as const })),
        dispatchProbe: vi.fn(),
      },
    });

    await expect(
      executor.probeSetup(setupProbeAction, {
        deliveryId: "delivery-missing",
        eventType: "pull_request",
        eventAction: "closed",
      }),
    ).rejects.toThrow(/not visible.*default branch/iu);
    expect(store.applyRevision).not.toHaveBeenCalled();
    expect(store.createProbe).not.toHaveBeenCalled();
  });

  it("terminalizes a stale release preparation request when Actions write is unavailable", async () => {
    const store = setupStore();
    const mutationService = vi.fn();
    const executor = createRepositorySetupLifecycleExecutor({
      store,
      authenticateInstallation: vi.fn(async () => ({
        token: "token",
        permissions: { pull_requests: "read", actions: "read" },
      })),
      mutationService,
    });

    await expect(
      executor.prepareRelease(releasePrepareAction, {
        deliveryId: "delivery-release-prepare",
        eventType: "check_run",
        eventAction: "requested_action",
      }),
    ).resolves.toEqual([]);
    expect(mutationService).not.toHaveBeenCalled();
  });

  it("returns a setup-required release run when repository setup is not ready", async () => {
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
        deliveryId: "delivery-release-unconfigured",
        idempotencyScope: "release-prepare:delivery-release-unconfigured",
        setupIncomplete: true,
      },
    ]);
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
