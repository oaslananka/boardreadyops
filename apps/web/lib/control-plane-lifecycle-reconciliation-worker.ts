import type {
  ClaimedControlPlaneReconciliationItem,
  ControlPlaneOperationsStore,
} from "@boardreadyops/db/control-plane-operations-store";

type LifecycleReconciliationOperations = Pick<
  ControlPlaneOperationsStore,
  "applyLifecycleReconciliation" | "failReconciliationItem"
>;

export type ControlPlaneLifecycleReconciliationDependencies = {
  workerId: string;
  operations: LifecycleReconciliationOperations;
};

export type ProcessControlPlaneLifecycleReconciliationResult = {
  reconciliationId: string;
  status: "already_repaired" | "already_terminal" | "applied" | "dead_letter" | "retry" | "stale";
  outcomeCode: string;
};

function outcomeCode(status: "already_repaired" | "already_terminal" | "applied" | "stale"): string {
  return `lifecycle_reconciliation_${status}`;
}

export async function processControlPlaneLifecycleReconciliation(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneLifecycleReconciliationDependencies,
): Promise<ProcessControlPlaneLifecycleReconciliationResult> {
  try {
    const status = await dependencies.operations.applyLifecycleReconciliation({
      reconciliationId: item.reconciliationId,
      workerId: dependencies.workerId,
    });
    return {
      reconciliationId: item.reconciliationId,
      status,
      outcomeCode: outcomeCode(status),
    };
  } catch (error) {
    const errorClass = error instanceof Error ? error.name || "Error" : "UnknownError";
    const status = await dependencies.operations.failReconciliationItem({
      reconciliationId: item.reconciliationId,
      workerId: dependencies.workerId,
      attemptCount: item.attemptCount,
      errorClass,
      errorMessage: "Control-plane lifecycle reconciliation failed.",
    });
    return {
      reconciliationId: item.reconciliationId,
      status,
      outcomeCode: "lifecycle_reconciliation_failed",
    };
  }
}
