import {
  type GitHubAppDurableLifecycleStore,
  planGitHubAppLifecycleActions,
} from "@boardreadyops/cloud-core/durable-lifecycle-planner";
import type { GitHubAppLifecycleAction, GitHubAppLifecycleContext } from "@boardreadyops/cloud-core/lifecycle";
import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";

type SetupAction = Extract<GitHubAppLifecycleAction, { type: "setup_pr.create" }>;
type WaiverAction = Extract<GitHubAppLifecycleAction, { type: "waiver_pr.request" }>;
type GitHubCommandAction = Extract<GitHubAppLifecycleAction, { type: "github_command.execute" }>;
type ReleasePrepareAction = Extract<GitHubAppLifecycleAction, { type: "release.prepare" }>;

type ControlPlaneInteractionExecutor = {
  createSetupPr?(action: SetupAction, context: GitHubAppLifecycleContext): Promise<void>;
  createWaiverPr?(action: WaiverAction, context: GitHubAppLifecycleContext): Promise<void>;
  prepareRelease?(
    action: ReleasePrepareAction,
    context: GitHubAppLifecycleContext,
  ): Promise<readonly GitHubAppLifecycleAction[]>;
  executeGitHubCommand?(
    action: GitHubCommandAction,
    context: GitHubAppLifecycleContext,
  ): Promise<readonly GitHubAppLifecycleAction[]>;
};

export type ControlPlaneWorkerDependencies = {
  workerId: string;
  jobs: ControlPlaneJobStore;
  lifecycle: GitHubAppDurableLifecycleStore;
  interactions?: ControlPlaneInteractionExecutor;
};

export type ProcessControlPlaneJobResult = {
  jobId: string;
  deliveryId: string;
  status: "completed" | "dead_letter" | "retry" | "stale";
};

const credentialPattern = /\b(authorization|password|private[_-]?key|secret|token)\s*[=:]\s*[^\s,;]+/giu;

function errorDetails(error: unknown): { errorClass: string; errorMessage: string } {
  const errorClass = error instanceof Error ? error.name || "Error" : "UnknownError";
  const original = error instanceof Error ? error.message : String(error);
  const redacted = original
    .replace(credentialPattern, "[redacted credential]")
    .replace(/[\r\n\t]+/gu, " ")
    .trim();
  return {
    errorClass: errorClass.slice(0, 100),
    errorMessage: (redacted || "Control-plane job failed.").slice(0, 500),
  };
}

async function executeSetupInteraction(
  action: SetupAction,
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  const createSetupPr = dependencies.interactions?.createSetupPr;
  if (!createSetupPr) throw new Error("setup lifecycle interaction executor is not configured");
  await createSetupPr(action, context);
}

async function executeWaiverInteraction(
  action: WaiverAction,
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  const createWaiverPr = dependencies.interactions?.createWaiverPr;
  if (!createWaiverPr) throw new Error("waiver lifecycle interaction executor is not configured");
  await createWaiverPr(action, context);
}

async function executeReleasePrepareInteraction(
  action: ReleasePrepareAction,
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  const prepareRelease = dependencies.interactions?.prepareRelease;
  if (!prepareRelease) throw new Error("release prepare lifecycle interaction executor is not configured");
  const followUpActions = await prepareRelease(action, context);
  if (followUpActions.some((followUp) => followUp.type === "release.prepare")) {
    throw new Error("release prepare executor returned a recursive release.prepare action");
  }
  await processLifecycleActions(followUpActions, dependencies, context);
}

async function executeCommandInteraction(
  action: GitHubCommandAction,
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  const executeGitHubCommand = dependencies.interactions?.executeGitHubCommand;
  if (!executeGitHubCommand) throw new Error("GitHub command interaction executor is not configured");
  const followUpActions = await executeGitHubCommand(action, context);
  if (followUpActions.some((followUp) => followUp.type === "github_command.execute")) {
    throw new Error("GitHub command executor returned a recursive command action");
  }
  await processLifecycleActions(followUpActions, dependencies, context);
}

async function executeInteractionAction(
  action: GitHubAppLifecycleAction,
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  switch (action.type) {
    case "setup_pr.create":
      return executeSetupInteraction(action, dependencies, context);
    case "waiver_pr.request":
      return executeWaiverInteraction(action, dependencies, context);
    case "release.prepare":
      return executeReleasePrepareInteraction(action, dependencies, context);
    case "github_command.execute":
      return executeCommandInteraction(action, dependencies, context);
    default:
      return undefined;
  }
}

async function processLifecycleActions(
  actions: readonly GitHubAppLifecycleAction[],
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  await planGitHubAppLifecycleActions(actions, dependencies.lifecycle, context);
  for (const action of actions) await executeInteractionAction(action, dependencies, context);
}

export async function processControlPlaneJob(
  job: ClaimedControlPlaneJob,
  dependencies: ControlPlaneWorkerDependencies,
): Promise<ProcessControlPlaneJobResult> {
  try {
    const context: GitHubAppLifecycleContext = {
      deliveryId: job.deliveryId,
      eventType: job.eventType,
      ...(job.eventAction ? { eventAction: job.eventAction } : {}),
    };
    await processLifecycleActions(job.actions, dependencies, context);
    const status = await dependencies.jobs.completeJob({
      jobId: job.jobId,
      workerId: dependencies.workerId,
    });
    return { jobId: job.jobId, deliveryId: job.deliveryId, status };
  } catch (error) {
    const status = await dependencies.jobs.failJob({
      jobId: job.jobId,
      workerId: dependencies.workerId,
      ...errorDetails(error),
    });
    return { jobId: job.jobId, deliveryId: job.deliveryId, status };
  }
}
