import { describe, expect, it, vi } from "vitest";
import {
  type ControlPlaneWorkflowReconciliationDependencies,
  processControlPlaneWorkflowReconciliation,
} from "../../../apps/web/lib/control-plane-reconciliation-worker.js";
import type { GitHubWorkflowObservation } from "../../../apps/web/lib/github-workflow-reconciliation-client.js";
import type {
  ClaimedControlPlaneReconciliationItem,
  ControlPlaneWorkflowReconciliationContext,
} from "../../../packages/db/src/control-plane-operations-store.js";

const now = new Date("2026-07-23T16:00:00.000Z");
const item: ClaimedControlPlaneReconciliationItem = {
  reconciliationId: "reconciliation-1",
  installationId: "installation-1",
  repositoryId: "repository-1",
  releaseRunId: "run-1",
  executionAttemptId: "attempt-1",
  subjectType: "execution_attempt",
  subjectId: "attempt-1",
  reasonCode: "callback_missing",
  deadlineAt: "2026-07-23T16:10:00.000Z",
  nextCheckAt: "2026-07-23T16:00:00.000Z",
  attemptCount: 1,
};
const context: ControlPlaneWorkflowReconciliationContext = {
  reconciliationId: "reconciliation-1",
  installationId: "installation-1",
  githubInstallationId: 123,
  repositoryId: "repository-1",
  repositoryOwner: "octo",
  repositoryName: "board",
  repositoryFullName: "octo/board",
  releaseRunId: "run-1",
  executionAttemptId: "attempt-1",
  githubWorkflowRunId: "987",
  attemptStatus: "dispatched",
  deadlineAt: "2026-07-23T16:10:00.000Z",
};

function dependencies(
  observation: GitHubWorkflowObservation,
  overrides: Partial<ControlPlaneWorkflowReconciliationDependencies> = {},
): ControlPlaneWorkflowReconciliationDependencies {
  const operations = {
    loadWorkflowReconciliationContext: vi.fn(async () => context),
    rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
    applyWorkflowReconciliation: vi.fn(async () => "applied" as const),
    completeReconciliationItem: vi.fn(async () => "completed" as const),
    failReconciliationItem: vi.fn(async () => "retry" as const),
  };
  return {
    workerId: "worker-1",
    operations,
    github: { readWorkflowRun: vi.fn(async () => observation) },
    now: () => now,
    nextCheckSeconds: 60,
    ...overrides,
  } as const;
}

describe("control-plane workflow reconciliation", () => {
  it("reschedules an authoritative pending workflow before its deadline", async () => {
    const deps = dependencies({ kind: "pending", status: "in_progress" });

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "rescheduled",
      outcomeCode: "github_workflow_in_progress",
    });
    expect(deps.operations.rescheduleReconciliationItem).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-1",
      workerId: "worker-1",
      nextCheckAt: new Date("2026-07-23T16:01:00.000Z"),
      outcomeCode: "github_workflow_in_progress",
    });
    expect(deps.operations.applyWorkflowReconciliation).not.toHaveBeenCalled();
  });

  it("keeps observing a successful workflow until the signed callback deadline", async () => {
    const deps = dependencies({ kind: "completed", conclusion: "success" });

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "rescheduled",
      outcomeCode: "github_result_callback_pending",
    });
    expect(deps.github.readWorkflowRun).toHaveBeenCalledWith({
      githubInstallationId: 123,
      repositoryOwner: "octo",
      repositoryName: "board",
      workflowRunId: "987",
    });
    expect(deps.operations.rescheduleReconciliationItem).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-1",
      workerId: "worker-1",
      nextCheckAt: new Date("2026-07-23T16:01:00.000Z"),
      outcomeCode: "github_result_callback_pending",
    });
    expect(deps.operations.applyWorkflowReconciliation).not.toHaveBeenCalled();
  });

  it("keeps observing a missing workflow until the terminal deadline", async () => {
    const deps = dependencies({ kind: "not_found" });

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "rescheduled",
      outcomeCode: "github_workflow_not_found",
    });
    expect(deps.operations.applyWorkflowReconciliation).not.toHaveBeenCalled();
  });

  it("maps GitHub timeout to a stable terminal outcome immediately", async () => {
    const timedOut = dependencies({ kind: "completed", conclusion: "timed_out" });
    await processControlPlaneWorkflowReconciliation(item, timedOut);
    expect(timedOut.operations.applyWorkflowReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ terminalStatus: "timed_out", publicFailureReason: "github_workflow_timed_out" }),
    );
  });

  it("fails closed when success or missing workflow state remains after the deadline", async () => {
    const overdueContext = { ...context, deadlineAt: "2026-07-23T15:59:00.000Z" };
    const success = dependencies(
      { kind: "completed", conclusion: "success" },
      {
        operations: {
          ...dependencies({ kind: "pending", status: "queued" }).operations,
          loadWorkflowReconciliationContext: vi.fn(async () => overdueContext),
        },
      },
    );
    await processControlPlaneWorkflowReconciliation(item, success);
    expect(success.operations.applyWorkflowReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        observedStatus: "completed",
        observedConclusion: "success",
        terminalStatus: "failed",
        publicFailureReason: "github_result_callback_missing",
      }),
    );

    const missing = dependencies(
      { kind: "not_found" },
      {
        operations: {
          ...dependencies({ kind: "pending", status: "queued" }).operations,
          loadWorkflowReconciliationContext: vi.fn(async () => overdueContext),
        },
      },
    );
    await processControlPlaneWorkflowReconciliation(item, missing);
    expect(missing.operations.applyWorkflowReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        observedStatus: "not_found",
        terminalStatus: "failed",
        publicFailureReason: "github_workflow_not_found",
      }),
    );
  });

  it("terminalizes a still-pending workflow after the explicit reconciliation deadline", async () => {
    const overdueItem = { ...item, deadlineAt: "2026-07-23T15:59:00.000Z" };
    const overdueContext = { ...context, deadlineAt: overdueItem.deadlineAt };
    const deps = dependencies(
      { kind: "pending", status: "queued" },
      {
        operations: {
          loadWorkflowReconciliationContext: vi.fn(async () => overdueContext),
          rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
          applyWorkflowReconciliation: vi.fn(async () => "applied" as const),
          completeReconciliationItem: vi.fn(async () => "completed" as const),
          failReconciliationItem: vi.fn(async () => "retry" as const),
        },
      },
    );

    await processControlPlaneWorkflowReconciliation(overdueItem, deps);
    expect(deps.operations.applyWorkflowReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        observedStatus: "queued",
        terminalStatus: "timed_out",
        publicFailureReason: "github_workflow_deadline_exceeded",
      }),
    );
  });

  it("completes a lease when the current attempt context has already changed", async () => {
    const operations = {
      loadWorkflowReconciliationContext: vi.fn(async () => undefined),
      rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
      applyWorkflowReconciliation: vi.fn(async () => "applied" as const),
      completeReconciliationItem: vi.fn(async () => "completed" as const),
      failReconciliationItem: vi.fn(async () => "retry" as const),
    };
    const deps: ControlPlaneWorkflowReconciliationDependencies = {
      workerId: "worker-1",
      operations,
      github: { readWorkflowRun: vi.fn(async () => ({ kind: "not_found" as const })) },
      now: () => now,
      nextCheckSeconds: 60,
    };

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "already_terminal",
      outcomeCode: "context_stale",
    });
    expect(operations.completeReconciliationItem).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-1",
      workerId: "worker-1",
      outcomeCode: "context_stale",
      repaired: false,
    });
    expect(deps.github.readWorkflowRun).not.toHaveBeenCalled();
  });

  it("fails closed after the deadline when GitHub lookup remains unavailable", async () => {
    const overdueContext = { ...context, deadlineAt: "2026-07-23T15:59:00.000Z" };
    const operations = {
      loadWorkflowReconciliationContext: vi.fn(async () => overdueContext),
      rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
      applyWorkflowReconciliation: vi.fn(async () => "applied" as const),
      completeReconciliationItem: vi.fn(async () => "completed" as const),
      failReconciliationItem: vi.fn(
        async (
          _input: Parameters<ControlPlaneWorkflowReconciliationDependencies["operations"]["failReconciliationItem"]>[0],
        ) => "retry" as const,
      ),
    };
    const deps: ControlPlaneWorkflowReconciliationDependencies = {
      workerId: "worker-1",
      operations,
      github: {
        readWorkflowRun: vi.fn(async () => {
          throw new Error("upstream unavailable");
        }),
      },
      now: () => now,
      nextCheckSeconds: 60,
    };

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "applied",
      outcomeCode: "github_workflow_lookup_failed",
    });
    expect(operations.applyWorkflowReconciliation).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-1",
      workerId: "worker-1",
      observedStatus: "lookup_failed",
      terminalStatus: "failed",
      publicFailureReason: "github_workflow_lookup_failed",
    });
    expect(operations.failReconciliationItem).not.toHaveBeenCalled();
  });

  it("routes transient lookup errors through bounded reconciliation retry", async () => {
    const operations = {
      loadWorkflowReconciliationContext: vi.fn(async () => context),
      rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
      applyWorkflowReconciliation: vi.fn(async () => "applied" as const),
      completeReconciliationItem: vi.fn(async () => "completed" as const),
      failReconciliationItem: vi.fn(
        async (
          _input: Parameters<ControlPlaneWorkflowReconciliationDependencies["operations"]["failReconciliationItem"]>[0],
        ) => "retry" as const,
      ),
    };
    const deps: ControlPlaneWorkflowReconciliationDependencies = {
      workerId: "worker-1",
      operations,
      github: {
        readWorkflowRun: vi.fn(async () => {
          throw new Error("authorization=Bearer secret-value upstream unavailable");
        }),
      },
      now: () => now,
      nextCheckSeconds: 60,
    };

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "retry",
      outcomeCode: "github_lookup_failed",
    });
    expect(operations.failReconciliationItem).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciliationId: "reconciliation-1",
        workerId: "worker-1",
        attemptCount: 1,
        errorClass: "Error",
      }),
    );
    expect(operations.failReconciliationItem.mock.calls[0]?.[0]?.errorMessage).not.toContain("secret-value");
  });

  it("falls back to bounded failure handling when deadline terminalization races", async () => {
    const overdueContext = { ...context, deadlineAt: "2026-07-23T15:59:00.000Z" };
    const operations = {
      loadWorkflowReconciliationContext: vi.fn(async () => overdueContext),
      rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
      applyWorkflowReconciliation: vi.fn(async () => {
        throw new Error("lease changed");
      }),
      completeReconciliationItem: vi.fn(async () => "completed" as const),
      failReconciliationItem: vi.fn(
        async (
          _input: Parameters<ControlPlaneWorkflowReconciliationDependencies["operations"]["failReconciliationItem"]>[0],
        ) => "retry" as const,
      ),
    };
    const deps: ControlPlaneWorkflowReconciliationDependencies = {
      workerId: "worker-1",
      operations,
      github: {
        readWorkflowRun: vi.fn(async () => {
          throw new Error("upstream unavailable");
        }),
      },
      now: () => now,
      nextCheckSeconds: 60,
    };

    await expect(processControlPlaneWorkflowReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "retry",
      outcomeCode: "github_lookup_failed",
    });
    expect(operations.failReconciliationItem).toHaveBeenCalledWith(expect.objectContaining({ errorClass: "Error" }));
  });
});
