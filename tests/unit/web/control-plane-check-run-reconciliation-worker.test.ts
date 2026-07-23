import { describe, expect, it, vi } from "vitest";
import {
  type ControlPlaneCheckRunReconciliationDependencies,
  processControlPlaneCheckRunReconciliation,
} from "../../../apps/web/lib/control-plane-check-run-reconciliation-worker.js";
import type {
  ClaimedControlPlaneReconciliationItem,
  ControlPlaneCheckRunReconciliationContext,
} from "../../../packages/db/src/control-plane-operations-store.js";

const now = new Date("2026-07-23T18:00:00.000Z");
const item: ClaimedControlPlaneReconciliationItem = {
  reconciliationId: "reconciliation-check-1",
  installationId: "installation-1",
  repositoryId: "repository-1",
  releaseRunId: "run-1",
  subjectType: "release_run",
  subjectId: "run-1",
  reasonCode: "reporting_stale",
  deadlineAt: "2026-07-23T18:10:00.000Z",
  nextCheckAt: "2026-07-23T18:00:00.000Z",
  attemptCount: 1,
};
const context: ControlPlaneCheckRunReconciliationContext = {
  reconciliationId: "reconciliation-check-1",
  installationId: "installation-1",
  githubInstallationId: 123,
  repositoryId: "repository-1",
  repositoryOwner: "octo",
  repositoryName: "board",
  repositoryFullName: "octo/board",
  releaseRunId: "run-1",
  commitSha: "a".repeat(40),
  githubCheckRunId: 77,
  runStatus: "completed",
  expectedConclusion: "success",
  completedAt: "2026-07-23T17:55:00.000Z",
  deadlineAt: "2026-07-23T18:10:00.000Z",
};

function dependencies(
  observation:
    | { kind: "not_found" }
    | {
        kind: "present";
        status: string;
        conclusion?: string;
        name?: string;
        externalId?: string;
        headSha?: string;
      },
  overrides: Partial<ControlPlaneCheckRunReconciliationDependencies> = {},
): ControlPlaneCheckRunReconciliationDependencies {
  const normalizedObservation =
    observation.kind === "present"
      ? {
          name: "BoardReadyOps / release readiness",
          externalId: "run-1",
          headSha: "a".repeat(40),
          ...observation,
        }
      : observation;
  const operations = {
    loadCheckRunReconciliationContext: vi.fn(async () => context),
    rescheduleReconciliationItem: vi.fn(async () => "rescheduled" as const),
    applyCheckRunReconciliation: vi.fn(async () => "applied" as const),
    finalizeCheckRunReconciliationFailure: vi.fn(async () => "failed" as const),
    completeReconciliationItem: vi.fn(async () => "completed" as const),
    failReconciliationItem: vi.fn(async () => "retry" as const),
  };
  return {
    workerId: "worker-1",
    operations,
    github: {
      readCheckRun: vi.fn(async () => normalizedObservation),
      completeCheckRun: vi.fn(async () => undefined),
    },
    now: () => now,
    nextCheckSeconds: 60,
    ...overrides,
  } as ControlPlaneCheckRunReconciliationDependencies;
}

describe("control-plane Check Run reconciliation", () => {
  it.each([
    { field: "name", value: "Unrelated check" },
    { field: "externalId", value: "other-run" },
    { field: "headSha", value: "b".repeat(40) },
  ] as const)("fails closed when the persisted Check Run ID has a mismatched $field", async ({ field, value }) => {
    const deps = dependencies({
      kind: "present",
      status: "completed",
      conclusion: "success",
      [field]: value,
    });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "failed",
      outcomeCode: "github_check_run_binding_mismatch",
    });
    expect(deps.github.completeCheckRun).not.toHaveBeenCalled();
    expect(deps.operations.finalizeCheckRunReconciliationFailure).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      observedStatus: "completed",
      observedConclusion: "success",
      publicFailureReason: "github_check_run_binding_mismatch",
    });
  });

  it("repairs only database publication state when GitHub is already current", async () => {
    const deps = dependencies({ kind: "present", status: "completed", conclusion: "success" });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "applied",
      outcomeCode: "github_check_run_reconciled",
    });
    expect(deps.github.readCheckRun).toHaveBeenCalledWith({
      installationId: 123,
      repositoryOwner: "octo",
      repositoryName: "board",
      checkRunId: 77,
    });
    expect(deps.github.completeCheckRun).not.toHaveBeenCalled();
    expect(deps.operations.applyCheckRunReconciliation).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      observedStatus: "completed",
      observedConclusion: "success",
      action: "observed_current",
    });
  });

  it("updates a pending or mismatched Check Run with bounded content", async () => {
    const deps = dependencies({ kind: "present", status: "in_progress" });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "applied",
      outcomeCode: "github_check_run_reconciled",
    });
    expect(deps.github.completeCheckRun).toHaveBeenCalledWith({
      installationId: 123,
      repositoryOwner: "octo",
      repositoryName: "board",
      checkRunId: 77,
      runId: "run-1",
      conclusion: "success",
      completedAt: "2026-07-23T17:55:00.000Z",
      title: "BoardReadyOps result: ready to release",
      summary: expect.stringContaining("signed terminal result"),
    });
    expect(String(vi.mocked(deps.github.completeCheckRun).mock.calls[0]?.[0]?.summary)).not.toContain("findings");
    expect(deps.operations.applyCheckRunReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ action: "updated", observedStatus: "in_progress" }),
    );
  });

  it("reschedules a temporary 404 before the explicit deadline", async () => {
    const deps = dependencies({ kind: "not_found" });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "rescheduled",
      outcomeCode: "github_check_run_not_found",
    });
    expect(deps.operations.rescheduleReconciliationItem).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      nextCheckAt: new Date("2026-07-23T18:01:00.000Z"),
      outcomeCode: "github_check_run_not_found",
    });
  });

  it("records a stable publication failure when 404 persists beyond the deadline", async () => {
    const overdue = { ...context, deadlineAt: "2026-07-23T17:59:00.000Z" };
    const deps = dependencies(
      { kind: "not_found" },
      {
        operations: {
          ...dependencies({ kind: "not_found" }).operations,
          loadCheckRunReconciliationContext: vi.fn(async () => overdue),
        },
      },
    );

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "failed",
      outcomeCode: "github_check_run_not_found",
    });
    expect(deps.operations.finalizeCheckRunReconciliationFailure).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      observedStatus: "not_found",
      publicFailureReason: "github_check_run_not_found",
    });
  });

  it("routes transient lookup failures through bounded retry without leaking content", async () => {
    const deps = dependencies({ kind: "present", status: "queued" });
    deps.github.readCheckRun = vi.fn(async () => {
      throw new Error("authorization=Bearer secret-value private repository");
    });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "retry",
      outcomeCode: "github_check_run_lookup_failed",
    });
    expect(deps.operations.failReconciliationItem).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciliationId: "reconciliation-check-1",
        workerId: "worker-1",
        attemptCount: 1,
        errorMessage: "GitHub Check Run reconciliation lookup failed.",
      }),
    );
  });

  it("uses the post-lookup clock when an outage crosses the deadline", async () => {
    let clock = new Date("2026-07-23T18:09:59.000Z");
    const deps = dependencies({ kind: "present", status: "queued" }, { now: () => clock });
    deps.github.readCheckRun = vi.fn(async () => {
      clock = new Date("2026-07-23T18:10:01.000Z");
      throw new Error("upstream unavailable");
    });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "failed",
      outcomeCode: "github_check_run_lookup_failed",
    });
    expect(deps.operations.finalizeCheckRunReconciliationFailure).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      observedStatus: "lookup_failed",
      publicFailureReason: "github_check_run_lookup_failed",
    });
    expect(deps.operations.failReconciliationItem).not.toHaveBeenCalled();
  });

  it("records a stable update failure after the deadline", async () => {
    const overdue = { ...context, deadlineAt: "2026-07-23T17:59:00.000Z" };
    const deps = dependencies(
      { kind: "present", status: "in_progress" },
      {
        operations: {
          ...dependencies({ kind: "not_found" }).operations,
          loadCheckRunReconciliationContext: vi.fn(async () => overdue),
        },
      },
    );
    deps.github.completeCheckRun = vi.fn(async () => {
      throw new Error("upstream unavailable");
    });

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "failed",
      outcomeCode: "github_check_run_update_failed",
    });
    expect(deps.operations.finalizeCheckRunReconciliationFailure).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      observedStatus: "in_progress",
      publicFailureReason: "github_check_run_update_failed",
    });
  });

  it("completes a stale lease when the terminal result was already published", async () => {
    const deps = dependencies(
      { kind: "present", status: "completed", conclusion: "success" },
      {
        operations: {
          ...dependencies({ kind: "not_found" }).operations,
          loadCheckRunReconciliationContext: vi.fn(async () => undefined),
        },
      },
    );

    await expect(processControlPlaneCheckRunReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-check-1",
      status: "already_published",
      outcomeCode: "context_stale",
    });
    expect(deps.operations.completeReconciliationItem).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-check-1",
      workerId: "worker-1",
      outcomeCode: "context_stale",
      repaired: false,
    });
    expect(deps.github.readCheckRun).not.toHaveBeenCalled();
  });
});
