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

function restoredTitleForConclusion(conclusion: string): string {
  switch (conclusion) {
    case "success":
      return "BoardReadyOps result: ready to release";
    case "neutral":
      return "BoardReadyOps result: review required";
    case "timed_out":
      return "BoardReadyOps result: run timed out";
    default:
      return "BoardReadyOps result: release blocked";
  }
}

function recoveryPresentation(
  conclusion: ControlPlaneCheckRunReconciliationContext["expectedConclusion"],
  resultReported: boolean,
): {
  title: string;
  summary: string;
} {
  if (!resultReported) {
    // Saying the result was "restored" here would be untrue: the execution never reported one.
    // The check is completed so the pull request stops waiting, and says why.
    return {
      title: "BoardReadyOps result: no result reported",
      summary:
        "The execution for this commit ended without reporting a result, so BoardReadyOps completed this Check Run rather than leaving it pending. Open the BoardReadyOps run and the workflow logs to see why the execution did not report.",
    };
  }

  return {
    title: restoredTitleForConclusion(conclusion),
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

async function retryOrFinalizeFailure(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
  deadline: Date,
  input: { observedStatus: string; observedConclusion?: string; outcomeCode: string; errorMessage: string },
): Promise<ProcessControlPlaneCheckRunReconciliationResult> {
  const failedAt = dependencies.now?.() ?? new Date();
  if (failedAt >= deadline) {
    return finalizeFailure(item, dependencies, {
      observedStatus: input.observedStatus,
      ...(input.observedConclusion ? { observedConclusion: input.observedConclusion } : {}),
      publicFailureReason: input.outcomeCode,
    });
  }
  return retryFailure(item, dependencies, input.outcomeCode, input.errorMessage);
}

async function handleMissingCheckRun(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
  deadline: Date,
  nextCheckSeconds: number,
): Promise<ProcessControlPlaneCheckRunReconciliationResult> {
  const observedAt = dependencies.now?.() ?? new Date();
  if (observedAt >= deadline) {
    return finalizeFailure(item, dependencies, {
      observedStatus: "not_found",
      publicFailureReason: "github_check_run_not_found",
    });
  }
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

async function repairCheckRun(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
  context: ControlPlaneCheckRunReconciliationContext,
  observation: Extract<GitHubCheckRunObservation, { kind: "present" }>,
  deadline: Date,
): Promise<ProcessControlPlaneCheckRunReconciliationResult | undefined> {
  try {
    const presentation = recoveryPresentation(context.expectedConclusion, context.resultReported);
    await dependencies.github.completeCheckRun({
      ...checkRunScope(context),
      runId: context.releaseRunId,
      conclusion: context.expectedConclusion,
      completedAt: context.completedAt,
      ...presentation,
    });
    return undefined;
  } catch {
    return retryOrFinalizeFailure(item, dependencies, deadline, {
      observedStatus: observation.status,
      ...(observation.conclusion ? { observedConclusion: observation.conclusion } : {}),
      outcomeCode: "github_check_run_update_failed",
      errorMessage: "GitHub Check Run reconciliation update failed.",
    });
  }
}

async function handleMissingContext(
  item: ClaimedControlPlaneReconciliationItem,
  dependencies: ControlPlaneCheckRunReconciliationDependencies,
): Promise<ProcessControlPlaneCheckRunReconciliationResult> {
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

function getReconciliationOutcomeCode(status: string, resultReported: boolean): string {
  if (status === "already_published") return "already_published";
  return resultReported ? "github_check_run_reconciled" : "github_check_run_reconciled_without_result";
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
    return handleMissingContext(item, dependencies);
  }

  const deadline = new Date(context.deadlineAt);
  let observation: GitHubCheckRunObservation;
  try {
    observation = await dependencies.github.readCheckRun(checkRunScope(context));
  } catch {
    return retryOrFinalizeFailure(item, dependencies, deadline, {
      observedStatus: "lookup_failed",
      outcomeCode: "github_check_run_lookup_failed",
      errorMessage: "GitHub Check Run reconciliation lookup failed.",
    });
  }

  if (observation.kind === "not_found") {
    return handleMissingCheckRun(item, dependencies, deadline, nextCheckSeconds);
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
    const failure = await repairCheckRun(item, dependencies, context, observation, deadline);
    if (failure) return failure;
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
    outcomeCode: getReconciliationOutcomeCode(status, context.resultReported),
  };
}
