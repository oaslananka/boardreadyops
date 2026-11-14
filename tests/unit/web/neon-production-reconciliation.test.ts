import { describe, expect, it, vi } from "vitest";
import {
  createProductionNeonReconciliationOperation,
  runClaimedGitHubReconciliationPass,
} from "../../../apps/web/lib/neon-production-reconciliation.js";
import type { ClaimedControlPlaneReconciliationItem } from "../../../packages/db/src/control-plane-operations-store.js";

const item = (id: string) =>
  ({
    reconciliationId: id,
    installationId: "trusted-installation",
    releaseRunId: "persisted-run",
    subjectType: "execution_attempt",
    subjectId: "persisted-attempt",
    reasonCode: "callback_missing",
    deadlineAt: "2026-11-14T21:10:00Z",
    nextCheckAt: "2026-11-14T21:00:00Z",
    attemptCount: 1,
  }) as ClaimedControlPlaneReconciliationItem;

function fixture() {
  const methods = {
    detectWorkflowReconciliationCandidates: vi.fn(async () => 1),
    detectCheckRunReconciliationCandidates: vi.fn(async () => 1),
    claimWorkflowReconciliationItems: vi.fn(async () => [item("workflow")]),
    claimCheckRunReconciliationItems: vi.fn(async () => [item("check")]),
    loadWorkflowReconciliationContext: vi.fn(async () => undefined),
    loadCheckRunReconciliationContext: vi.fn(async () => undefined),
    completeReconciliationItem: vi.fn(async () => "completed" as const),
    failReconciliationItem: vi.fn(async () => "retry" as const),
  };
  return methods;
}

describe("Neon GitHub result reconciliation (existing persisted scopes)", () => {
  it("detects both kinds and reconciles only claimed durable items", async () => {
    const operations = fixture();
    await runClaimedGitHubReconciliationPass({
      workerId: "neon-1",
      limit: 2,
      signal: new AbortController().signal,
      operations: operations as never,
      workflowGitHub: { readWorkflowRun: vi.fn() },
      checkRunGitHub: { readCheckRun: vi.fn(), completeCheckRun: vi.fn() },
    });
    expect(operations.detectWorkflowReconciliationCandidates).toHaveBeenCalledWith({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1800,
      limit: 2,
    });
    expect(operations.detectCheckRunReconciliationCandidates).toHaveBeenCalledWith({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1800,
      limit: 2,
    });
    expect(operations.claimWorkflowReconciliationItems).toHaveBeenCalledWith({ workerId: "neon-1", limit: 2 });
    expect(operations.claimCheckRunReconciliationItems).toHaveBeenCalledWith({ workerId: "neon-1", limit: 2 });
    expect(operations.completeReconciliationItem).toHaveBeenCalledTimes(2);
  });

  it("cannot detect or claim jobs without the exclusive lock", async () => {
    const operations = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runClaimedGitHubReconciliationPass({
        workerId: "neon-1",
        limit: 2,
        signal: controller.signal,
        operations: operations as never,
        workflowGitHub: { readWorkflowRun: vi.fn() },
        checkRunGitHub: { readCheckRun: vi.fn(), completeCheckRun: vi.fn() },
      }),
    ).rejects.toThrow("worker_ownership_lost");
    expect(operations.detectWorkflowReconciliationCandidates).not.toHaveBeenCalled();
    expect(operations.claimWorkflowReconciliationItems).not.toHaveBeenCalled();
  });

  it("stops before the second kind when ownership is lost", async () => {
    const operations = fixture();
    const controller = new AbortController();
    operations.completeReconciliationItem.mockImplementation(async () => {
      controller.abort();
      return "completed" as const;
    });
    await expect(
      runClaimedGitHubReconciliationPass({
        workerId: "neon-1",
        limit: 2,
        signal: controller.signal,
        operations: operations as never,
        workflowGitHub: { readWorkflowRun: vi.fn() },
        checkRunGitHub: { readCheckRun: vi.fn(), completeCheckRun: vi.fn() },
      }),
    ).rejects.toThrow("worker_ownership_lost");
    expect(operations.loadCheckRunReconciliationContext).not.toHaveBeenCalled();
  });

  it("fails on a database detection error instead of acknowledging an idle pass", async () => {
    const operations = fixture();
    operations.detectWorkflowReconciliationCandidates.mockRejectedValue(new Error("sql unavailable"));
    await expect(
      runClaimedGitHubReconciliationPass({
        workerId: "neon-1",
        limit: 1,
        signal: new AbortController().signal,
        operations: operations as never,
        workflowGitHub: { readWorkflowRun: vi.fn() },
        checkRunGitHub: { readCheckRun: vi.fn(), completeCheckRun: vi.fn() },
      }),
    ).rejects.toThrow("sql unavailable");
  });

  it("rejects unbounded work and missing GitHub credentials before accessing PostgreSQL", async () => {
    const opts = {
      workerId: "neon-1",
      connectionString: "postgresql://worker@localhost/test",
      environment: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "unused",
        BOARDREADYOPS_RUNNER_MODE: "github-actions",
      },
    };
    expect(() => createProductionNeonReconciliationOperation({ ...opts, batchLimit: 0 })).toThrow("limit");
    expect(() => createProductionNeonReconciliationOperation({ ...opts, batchLimit: 99 })).toThrow("limit");
    expect(() => createProductionNeonReconciliationOperation({ ...opts, environment: {} })).toThrow("GitHub App");
    expect(() =>
      createProductionNeonReconciliationOperation({
        ...opts,
        environment: { ...opts.environment, BOARDREADYOPS_RUNNER_MODE: "self-hosted" },
      }),
    ).toThrow("github-actions");
  });
});
