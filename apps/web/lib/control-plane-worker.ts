import {
  type GitHubAppDurableLifecycleStore,
  planGitHubAppLifecycleActions,
} from "@boardreadyops/cloud-core/durable-lifecycle-planner";
import type { GitHubAppLifecycleAction, GitHubAppLifecycleContext } from "@boardreadyops/cloud-core/lifecycle";
import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";

type SetupAction = Extract<GitHubAppLifecycleAction, { type: "setup_pr.create" }>;
type GitHubCommandAction = Extract<GitHubAppLifecycleAction, { type: "github_command.execute" }>;

type ControlPlaneInteractionExecutor = {
  createSetupPr?(action: SetupAction, context: GitHubAppLifecycleContext): Promise<void>;
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

async function processLifecycleActions(
  actions: readonly GitHubAppLifecycleAction[],
  dependencies: ControlPlaneWorkerDependencies,
  context: GitHubAppLifecycleContext,
): Promise<void> {
  await planGitHubAppLifecycleActions(actions, dependencies.lifecycle, context);
  for (const action of actions) {
    if (action.type === "setup_pr.create") {
      const createSetupPr = dependencies.interactions?.createSetupPr;
      if (!createSetupPr) throw new Error("setup lifecycle interaction executor is not configured");
      await createSetupPr(action, context);
      continue;
    }
    if (action.type === "github_command.execute") {
      const executeGitHubCommand = dependencies.interactions?.executeGitHubCommand;
      if (!executeGitHubCommand) throw new Error("GitHub command interaction executor is not configured");
      const followUpActions = await executeGitHubCommand(action, context);
      if (followUpActions.some((followUp) => followUp.type === "github_command.execute")) {
        throw new Error("GitHub command executor returned a recursive command action");
      }
      await processLifecycleActions(followUpActions, dependencies, context);
    }
  }
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
