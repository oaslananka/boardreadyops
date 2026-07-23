import type {
  ClaimedControlPlaneReconciliationItem,
  ControlPlaneOperationsStore,
  ControlPlaneWorkflowReconciliationContext,
  ControlPlaneWorkflowTerminalStatus,
} from "@boardreadyops/db/control-plane-operations-store";
import type {
  GitHubWorkflowObservation,
  GitHubWorkflowReconciliationClient,
} from "./github-workflow-reconciliation-client.js";

type WorkflowReconciliationOperations = Pick<
  ControlPlaneOperationsStore,
  | "applyWorkflowReconciliation"
  | "completeReconciliationItem"
  | "failReconciliationItem"
  | "loadWorkflowReconciliationContext"
  | "rescheduleReconciliationItem"
>;

export type ControlPlaneWorkflowReconciliationDependencies = {
  workerId: string;
  operations: WorkflowReconciliationOperations;
  github: GitHubWorkflowReconciliationClient;
  now?: () => Date;
  nextCheckSeconds?: number;
};

export type ProcessControlPlaneWorkflowReconciliationResult = {
  reconciliationId: string;
  status: "already_terminal" | "applied" | "dead_letter" | "rescheduled" | "retry" | "stale";
  outcomeCode: string;
};

function terminalObservation(observation: GitHubWorkflowObservation): {
  observedStatus: string;
  observedConclusion?: string;
  terminalStatus: ControlPlaneWorkflowTerminalStatus;
  publicFailureReason: string;
} {
  if (observation.kind === "not_found") {
    return {
      observedStatus: "not_found",
      terminalStatus: "failed",
      publicFailureReason: "github_workflow_not_found",
    };
  }
  if (observation.kind !== "completed") throw new Error("expected a terminal GitHub workflow observation");
  if (observation.conclusion === "timed_out") {
    return {
      observedStatus: "completed",
      observedConclusion: observation.conclusion,
      terminalStatus: "timed_out",
      publicFailureReason: "github_workflow_timed_out",
    };
  }
  return {
    observedStatus: "completed",
    observedConclusion: observation.conclusion,
    terminalStatus: "failed",
    publicFailureReason:
      observation.conclusion === "success"
        ? "github_result_callback_missing"
        : `github_workflow_${observation.conclusion}`,
  };
}

function contextScope(context: ControlPlaneWorkflowReconciliationContext) {
  return {
    githubInstallationId: context.githubInstallationId,
    repositoryOwner: context.repositoryOwner,
    repositoryName: context.repositoryName,
    workflowRunId: context.githubWorkflowRunId,
  };
}

function observationPendingOutcome(observation: GitHubWorkflowObservation): string | undefined {
  if (observation.kind === "pending") return `github_workflow_${observation.status}`;
  if (observation.kind === "not_found") return "github_workflow_not_found";
  if (observation.conclusion === "success") return "github_result_callback_pending";
  return undefined;
}

export async function processControlPlaneWorkflowReconciliation(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneWorkflowReconciliationDependencies,
): Promise<ProcessControlPlaneWorkflowReconciliationResult> {
  const nextCheckSeconds = dependencies.nextCheckSeconds ?? 60;
  let context: ControlPlaneWorkflowReconciliationContext | undefined;
  try {
    context = await dependencies.operations.loadWorkflowReconciliationContext({
      reconciliationId: item.reconciliationId,
      workerId: dependencies.workerId,
    });
    if (!context) {
      const completion = await dependencies.operations.completeReconciliationItem({
        reconciliationId: item.reconciliationId,
        workerId: dependencies.workerId,
        outcomeCode: "context_stale",
        repaired: false,
      });
      return {
        reconciliationId: item.reconciliationId,
        status: completion === "completed" ? "already_terminal" : "stale",
        outcomeCode: "context_stale",
      };
    }

    const observation = await dependencies.github.readWorkflowRun(contextScope(context));
    const now = dependencies.now?.() ?? new Date();
    const deadline = new Date(context.deadlineAt);
    const pendingOutcomeCode = observationPendingOutcome(observation);
    if (pendingOutcomeCode && now < deadline) {
      const status = await dependencies.operations.rescheduleReconciliationItem({
        reconciliationId: item.reconciliationId,
        workerId: dependencies.workerId,
        nextCheckAt: new Date(now.valueOf() + nextCheckSeconds * 1000),
        outcomeCode: pendingOutcomeCode,
      });
      return {
        reconciliationId: item.reconciliationId,
        status,
        outcomeCode: pendingOutcomeCode,
      };
    }

    const terminal =
      observation.kind === "pending"
        ? {
            observedStatus: observation.status,
            terminalStatus: "timed_out" as const,
            publicFailureReason: "github_workflow_deadline_exceeded",
          }
        : terminalObservation(observation);
    const status = await dependencies.operations.applyWorkflowReconciliation({
      reconciliationId: item.reconciliationId,
      workerId: dependencies.workerId,
      ...terminal,
    });
    return {
      reconciliationId: item.reconciliationId,
      status,
      outcomeCode: terminal.publicFailureReason,
    };
  } catch (error) {
    let failure = error;
    const failedAt = dependencies.now?.() ?? new Date();
    if (context && failedAt >= new Date(context.deadlineAt)) {
      try {
        const status = await dependencies.operations.applyWorkflowReconciliation({
          reconciliationId: item.reconciliationId,
          workerId: dependencies.workerId,
          observedStatus: "lookup_failed",
          terminalStatus: "failed",
          publicFailureReason: "github_workflow_lookup_failed",
        });
        return {
          reconciliationId: item.reconciliationId,
          status,
          outcomeCode: "github_workflow_lookup_failed",
        };
      } catch (terminalizationError) {
        failure = terminalizationError;
      }
    }

    const errorClass = failure instanceof Error ? failure.name || "Error" : "UnknownError";
    const status = await dependencies.operations.failReconciliationItem({
      reconciliationId: item.reconciliationId,
      workerId: dependencies.workerId,
      attemptCount: item.attemptCount,
      errorClass,
      errorMessage: "GitHub workflow reconciliation lookup failed.",
    });
    return {
      reconciliationId: item.reconciliationId,
      status,
      outcomeCode: "github_lookup_failed",
    };
  }
}
