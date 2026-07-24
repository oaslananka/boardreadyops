import { describe, expect, it, vi } from "vitest";
import {
  type ControlPlaneLifecycleReconciliationDependencies,
  processControlPlaneLifecycleReconciliation,
} from "../../../apps/web/lib/control-plane-lifecycle-reconciliation-worker.js";
import type { ClaimedControlPlaneReconciliationItem } from "../../../packages/db/src/control-plane-operations-store.js";

const item: ClaimedControlPlaneReconciliationItem = {
  reconciliationId: "reconciliation-1",
  installationId: "installation-1",
  repositoryId: "repository-1",
  subjectType: "webhook_inbox",
  subjectId: "inbox-1",
  reasonCode: "lifecycle_job_missing",
  deadlineAt: "2026-07-24T02:00:00.000Z",
  nextCheckAt: "2026-07-24T01:30:00.000Z",
  attemptCount: 2,
};

function dependencies(
  outcome: "already_repaired" | "already_terminal" | "applied" | "stale" = "applied",
): ControlPlaneLifecycleReconciliationDependencies {
  return {
    workerId: "worker-1",
    operations: {
      applyLifecycleReconciliation: vi.fn(async () => outcome),
      failReconciliationItem: vi.fn(async () => "retry" as const),
    },
  };
}

describe("control-plane lifecycle reconciliation", () => {
  it.each([
    ["applied", "lifecycle_reconciliation_applied"],
    ["already_repaired", "lifecycle_reconciliation_already_repaired"],
    ["already_terminal", "lifecycle_reconciliation_already_terminal"],
    ["stale", "lifecycle_reconciliation_stale"],
  ] as const)("returns the %s apply outcome", async (status, outcomeCode) => {
    const deps = dependencies(status);

    await expect(processControlPlaneLifecycleReconciliation(item, deps)).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status,
      outcomeCode,
    });
    expect(deps.operations.applyLifecycleReconciliation).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-1",
      workerId: "worker-1",
    });
    expect(deps.operations.failReconciliationItem).not.toHaveBeenCalled();
  });

  it("routes a database failure through bounded reconciliation retry", async () => {
    const operations = {
      applyLifecycleReconciliation: vi.fn(async () => {
        throw new Error("normalized_actions=private-payload token=secret-value");
      }),
      failReconciliationItem: vi.fn(async () => "retry" as const),
    };

    await expect(
      processControlPlaneLifecycleReconciliation(item, { workerId: "worker-1", operations }),
    ).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "retry",
      outcomeCode: "lifecycle_reconciliation_failed",
    });
    expect(operations.failReconciliationItem).toHaveBeenCalledWith({
      reconciliationId: "reconciliation-1",
      workerId: "worker-1",
      attemptCount: 2,
      errorClass: "Error",
      errorMessage: "Control-plane lifecycle reconciliation failed.",
    });
  });

  it("preserves a dead-letter result from the durable failure path", async () => {
    const operations = {
      applyLifecycleReconciliation: vi.fn(async () => {
        throw new TypeError("database unavailable");
      }),
      failReconciliationItem: vi.fn(async () => "dead_letter" as const),
    };

    await expect(
      processControlPlaneLifecycleReconciliation(item, { workerId: "worker-1", operations }),
    ).resolves.toEqual({
      reconciliationId: "reconciliation-1",
      status: "dead_letter",
      outcomeCode: "lifecycle_reconciliation_failed",
    });
    expect(operations.failReconciliationItem).toHaveBeenCalledWith(
      expect.objectContaining({ errorClass: "TypeError", attemptCount: 2 }),
    );
  });
});
