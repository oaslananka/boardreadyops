import type { CompleteGitHubCheckRunInput } from "@boardreadyops/cloud-core/lifecycle-executor";
import type {
  ClaimedControlPlaneReconciliationItem,
  ControlPlaneCheckRunReconciliationContext,
  ControlPlaneOperationsStore,
} from "@boardreadyops/db/control-plane-operations-store";
import { type GitHubCheckRunObservation, readinessCheckName } from "./github-app-check-run-client.js";

type CheckRunReconciliationOperations = Pick<
  ControlPlaneOperationsStore,
  | "applyCheckRunReconciliation"
  | "completeReconciliationItem"
  | "failReconciliationItem"
  | "finalizeCheckRunReconciliationFailure"
  | "loadCheckRunReconciliationContext"
  | "rescheduleReconciliationItem"
>;

type CheckRunReconciliationClient = {
  readCheckRun(input: {
    installationId: number | string;
    repositoryOwner: string;
    repositoryName: string;
    checkRunId: number | string;
  }): Promise<GitHubCheckRunObservation>;
  completeCheckRun(input: CompleteGitHubCheckRunInput): Promise<void>;
};

export type ControlPlaneCheckRunReconciliationDependencies = {
  workerId: string;
  operations: CheckRunReconciliationOperations;
  github: CheckRunReconciliationClient;
  now?: () => Date;
  nextCheckSeconds?: number;
};

export type ProcessControlPlaneCheckRunReconciliationResult = {
  reconciliationId: string;
  status: "already_published" | "applied" | "failed" | "rescheduled" | "retry" | "dead_letter" | "stale";
  outcomeCode: string;
};

function checkRunScope(context: ControlPlaneCheckRunReconciliationContext) {
  return {
    installationId: context.githubInstallationId,
    repositoryOwner: context.repositoryOwner,
    repositoryName: context.repositoryName,
    checkRunId: context.githubCheckRunId,
  };
}

function recoveryPresentation(conclusion: ControlPlaneCheckRunReconciliationContext["expectedConclusion"]): {
  title: string;
  summary: string;
} {
  const title =
    conclusion === "success"
      ? "BoardReadyOps result: ready to release"
      : conclusion === "neutral"
        ? "BoardReadyOps result: review required"
        : conclusion === "timed_out"
          ? "BoardReadyOps result: run timed out"
          : "BoardReadyOps result: release blocked";
  return {
    title,
    summary:
      "BoardReadyOps restored this Check Run from the accepted signed terminal result. Open the BoardReadyOps run for complete evidence and details.",
  };
}

function isBoundToContext(
  observation: Extract<GitHubCheckRunObservation, { kind: "present" }>,
  context: ControlPlaneCheckRunReconciliationContext,
): boolean {
  return (
    observation.name === readinessCheckName &&
    observation.externalId === context.releaseRunId &&
    observation.headSha.toLowerCase() === context.commitSha.toLowerCase()
  );
}

function isCurrent(
  observation: GitHubCheckRunObservation,
  expectedConclusion: ControlPlaneCheckRunReconciliationContext["expectedConclusion"],
): observation is Extract<GitHubCheckRunObservation, { kind: "present" }> {
  return (
    observation.kind === "present" &&
    observation.status === "completed" &&
    observation.conclusion === expectedConclusion
  );
}

async function finalizeFailure(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
  input: { observedStatus: string; observedConclusion?: string; publicFailureReason: string },
): Promise<ProcessControlPlaneCheckRunReconciliationResult> {
  const status = await dependencies.operations.finalizeCheckRunReconciliationFailure({
    reconciliationId: item.reconciliationId,
    workerId: dependencies.workerId,
    ...input,
  });
  return { reconciliationId: item.reconciliationId, status, outcomeCode: input.publicFailureReason };
}

async function retryFailure(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
  outcomeCode: string,
  errorMessage: string,
): Promise<ProcessControlPlaneCheckRunReconciliationResult> {
  const status = await dependencies.operations.failReconciliationItem({
    reconciliationId: item.reconciliationId,
    workerId: dependencies.workerId,
    attemptCount: item.attemptCount,
    errorClass: "Error",
    errorMessage,
  });
  return { reconciliationId: item.reconciliationId, status, outcomeCode };
}

export async function processControlPlaneCheckRunReconciliation(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
): Promise<ProcessControlPlaneCheckRunReconciliationResult> {
  const nextCheckSeconds = dependencies.nextCheckSeconds ?? 60;
  const context = await dependencies.operations.loadCheckRunReconciliationContext({
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
      status: completion === "completed" ? "already_published" : "stale",
      outcomeCode: "context_stale",
    };
  }

  const deadline = new Date(context.deadlineAt);
  let observation: GitHubCheckRunObservation;
  try {
    observation = await dependencies.github.readCheckRun(checkRunScope(context));
  } catch {
    const failedAt = dependencies.now?.() ?? new Date();
    if (failedAt >= deadline) {
      return finalizeFailure(item, dependencies, {
        observedStatus: "lookup_failed",
        publicFailureReason: "github_check_run_lookup_failed",
      });
    }
    return retryFailure(
      item,
      dependencies,
      "github_check_run_lookup_failed",
      "GitHub Check Run reconciliation lookup failed.",
    );
  }

  const observedAt = dependencies.now?.() ?? new Date();
  if (observation.kind === "not_found") {
    if (observedAt < deadline) {
      const status = await dependencies.operations.rescheduleReconciliationItem({
        reconciliationId: item.reconciliationId,
        workerId: dependencies.workerId,
        nextCheckAt: new Date(observedAt.valueOf() + nextCheckSeconds * 1000),
        outcomeCode: "github_check_run_not_found",
      });
      return {
        reconciliationId: item.reconciliationId,
        status,
        outcomeCode: "github_check_run_not_found",
      };
    }
    return finalizeFailure(item, dependencies, {
      observedStatus: "not_found",
      publicFailureReason: "github_check_run_not_found",
    });
  }

  if (!isBoundToContext(observation, context)) {
    return finalizeFailure(item, dependencies, {
      observedStatus: observation.status,
      ...(observation.conclusion ? { observedConclusion: observation.conclusion } : {}),
      publicFailureReason: "github_check_run_binding_mismatch",
    });
  }

  const action = isCurrent(observation, context.expectedConclusion) ? "observed_current" : "updated";
  if (action === "updated") {
    try {
      const presentation = recoveryPresentation(context.expectedConclusion);
      await dependencies.github.completeCheckRun({
        ...checkRunScope(context),
        runId: context.releaseRunId,
        conclusion: context.expectedConclusion,
        completedAt: context.completedAt,
        ...presentation,
      });
    } catch {
      const failedAt = dependencies.now?.() ?? new Date();
      if (failedAt >= deadline) {
        return finalizeFailure(item, dependencies, {
          observedStatus: observation.status,
          ...(observation.conclusion ? { observedConclusion: observation.conclusion } : {}),
          publicFailureReason: "github_check_run_update_failed",
        });
      }
      return retryFailure(
        item,
        dependencies,
        "github_check_run_update_failed",
        "GitHub Check Run reconciliation update failed.",
      );
    }
  }

  const status = await dependencies.operations.applyCheckRunReconciliation({
    reconciliationId: item.reconciliationId,
    workerId: dependencies.workerId,
    observedStatus: observation.status,
    ...(observation.conclusion ? { observedConclusion: observation.conclusion } : {}),
    action,
  });
  return {
    reconciliationId: item.reconciliationId,
    status,
    outcomeCode: status === "already_published" ? "already_published" : "github_check_run_reconciled",
  };
}
