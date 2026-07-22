import { randomUUID } from "node:crypto";
import type {
  CompleteGitHubCheckRunInput,
  CreatePullRequestCheckRunInput,
  DispatchReleaseRunWorkflowInput,
} from "@boardreadyops/cloud-core/lifecycle-executor";
import type {
  ClaimedControlPlaneOutboxEffect,
  ControlPlaneOutboxStore,
} from "@boardreadyops/db/control-plane-outbox-store";

export type ControlPlaneOutboxCheckRunClient = {
  ensurePullRequestCheckRun(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
  completeCheckRun(input: CompleteGitHubCheckRunInput): Promise<void>;
};

export type ControlPlaneOutboxWorkflowDispatchClient = {
  dispatchReleaseRunWorkflow(input: DispatchReleaseRunWorkflowInput): Promise<{
    workflowDispatchId: string;
    workflowRunUrl?: string;
  }>;
};

export type ControlPlaneOutboxWorkerDependencies = {
  workerId: string;
  outbox: ControlPlaneOutboxStore;
  dispatchMode: "github-actions" | "none";
  checkRuns: ControlPlaneOutboxCheckRunClient;
  workflowDispatch?: ControlPlaneOutboxWorkflowDispatchClient;
  id?: () => string;
};

export type ProcessControlPlaneOutboxEffectResult = {
  outboxId: string;
  effectType: ClaimedControlPlaneOutboxEffect["effectType"];
  status:
    | "check_run_conflict"
    | "completed"
    | "dead_letter"
    | "reconciliation_required"
    | "retry"
    | "stale";
};

const credentialPattern = /\b(authorization|password|private[_-]?key|secret|token)\s*[=:]\s*[^\s,;]+/giu;

function errorDetails(error: unknown): { errorClass: string; errorMessage: string; deliveryUncertain: boolean } {
  const errorClass = error instanceof Error ? error.name || "Error" : "UnknownError";
  const original = error instanceof Error ? error.message : String(error);
  const redacted = original
    .replace(credentialPattern, "[redacted credential]")
    .replace(/[\r\n\t]+/gu, " ")
    .trim();
  const deliveryUncertain =
    typeof error === "object" &&
    error !== null &&
    "deliveryUncertain" in error &&
    (error as { deliveryUncertain?: unknown }).deliveryUncertain === true;
  return {
    errorClass: errorClass.slice(0, 100),
    errorMessage: (redacted || "Control-plane outbox effect failed.").slice(0, 500),
    deliveryUncertain,
  };
}

function checkRunCreateEffect(effect: ClaimedControlPlaneOutboxEffect) {
  if (effect.effectType !== "github.check_run.create" || effect.payload.type !== "github.check_run.create") {
    throw new Error("expected a Check Run creation effect");
  }
  return effect.payload;
}

function workflowDispatchEffect(effect: ClaimedControlPlaneOutboxEffect) {
  if (effect.effectType !== "github.workflow.dispatch" || effect.payload.type !== "github.workflow.dispatch") {
    throw new Error("expected a workflow dispatch effect");
  }
  return effect.payload;
}

function checkRunCompleteEffect(effect: ClaimedControlPlaneOutboxEffect) {
  if (effect.effectType !== "github.check_run.complete" || effect.payload.type !== "github.check_run.complete") {
    throw new Error("expected a Check Run completion effect");
  }
  return effect.payload;
}

function requiresCompletionEffect(action: CreatePullRequestCheckRunInput["action"]): boolean {
  return action.pullRequestDraft === true || action.pullRequestFromFork === true;
}

async function processCheckRunCreate(
  effect: ClaimedControlPlaneOutboxEffect,
  dependencies: ControlPlaneOutboxWorkerDependencies,
): Promise<ProcessControlPlaneOutboxEffectResult["status"]> {
  const payload = checkRunCreateEffect(effect);
  const checkRun = await dependencies.checkRuns.ensurePullRequestCheckRun({
    action: payload.action,
    runId: payload.runId,
    idempotencyKey: payload.idempotencyKey,
  });
  const id = dependencies.id ?? randomUUID;
  const safeMode = requiresCompletionEffect(payload.action);
  const plansNextEffect = safeMode || dependencies.dispatchMode === "github-actions";
  const executionAttemptId = !safeMode && dependencies.dispatchMode === "github-actions" ? id() : undefined;
  const nextOutboxId = plansNextEffect ? id() : undefined;
  const transition = await dependencies.outbox.completeCheckRunCreateEffect({
    effect,
    workerId: dependencies.workerId,
    githubCheckRunId: checkRun.id,
    dispatchMode: dependencies.dispatchMode,
    ...(executionAttemptId ? { executionAttemptId } : {}),
    ...(nextOutboxId ? { nextOutboxId } : {}),
  });
  return transition.outcome;
}

async function processWorkflowDispatch(
  effect: ClaimedControlPlaneOutboxEffect,
  dependencies: ControlPlaneOutboxWorkerDependencies,
): Promise<ProcessControlPlaneOutboxEffectResult["status"]> {
  const payload = workflowDispatchEffect(effect);
  if (!dependencies.workflowDispatch) throw new Error("workflow dispatch client is not configured");
  const delivered = await dependencies.workflowDispatch.dispatchReleaseRunWorkflow(payload.input);
  return await dependencies.outbox.completeWorkflowDispatchEffect({
    effect,
    workerId: dependencies.workerId,
    workflowDispatchId: delivered.workflowDispatchId,
    ...(delivered.workflowRunUrl ? { workflowRunUrl: delivered.workflowRunUrl } : {}),
  });
}

async function processCheckRunComplete(
  effect: ClaimedControlPlaneOutboxEffect,
  dependencies: ControlPlaneOutboxWorkerDependencies,
): Promise<ProcessControlPlaneOutboxEffectResult["status"]> {
  const payload = checkRunCompleteEffect(effect);
  await dependencies.checkRuns.completeCheckRun(payload.input);
  return await dependencies.outbox.completeEffect({
    outboxId: effect.outboxId,
    workerId: dependencies.workerId,
    externalResult: {
      githubCheckRunId: payload.input.checkRunId,
      conclusion: payload.input.conclusion,
    },
  });
}

export async function processControlPlaneOutboxEffect(
  effect: ClaimedControlPlaneOutboxEffect,
  dependencies: ControlPlaneOutboxWorkerDependencies,
): Promise<ProcessControlPlaneOutboxEffectResult> {
  try {
    const delivery = await dependencies.outbox.markDeliveryStarted({
      outboxId: effect.outboxId,
      workerId: dependencies.workerId,
    });
    if (delivery === "stale") {
      return { outboxId: effect.outboxId, effectType: effect.effectType, status: "stale" };
    }

    let status: ProcessControlPlaneOutboxEffectResult["status"];
    switch (effect.effectType) {
      case "github.check_run.create":
        status = await processCheckRunCreate(effect, dependencies);
        break;
      case "github.workflow.dispatch":
        status = await processWorkflowDispatch(effect, dependencies);
        break;
      case "github.check_run.complete":
        status = await processCheckRunComplete(effect, dependencies);
        break;
    }
    return { outboxId: effect.outboxId, effectType: effect.effectType, status };
  } catch (error) {
    const failure = errorDetails(error);
    const status = await dependencies.outbox.failEffect({
      outboxId: effect.outboxId,
      workerId: dependencies.workerId,
      attemptCount: effect.attemptCount,
      errorClass: failure.errorClass,
      errorMessage: failure.errorMessage,
      ...(failure.deliveryUncertain ? { deliveryUncertain: true } : {}),
    });
    return { outboxId: effect.outboxId, effectType: effect.effectType, status };
  }
}
