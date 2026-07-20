import {
  executeGitHubAppLifecycleActions,
  type GitHubAppCheckRunClient,
  type GitHubAppLifecycleStore,
  type GitHubAppWorkflowDispatchClient,
} from "@boardreadyops/cloud-core/lifecycle-executor";
import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";

export type ControlPlaneWorkerDependencies = {
  workerId: string;
  jobs: ControlPlaneJobStore;
  lifecycle: GitHubAppLifecycleStore;
  checkRuns?: GitHubAppCheckRunClient;
  workflowDispatch?: GitHubAppWorkflowDispatchClient;
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

export async function processControlPlaneJob(
  job: ClaimedControlPlaneJob,
  dependencies: ControlPlaneWorkerDependencies,
): Promise<ProcessControlPlaneJobResult> {
  try {
    await executeGitHubAppLifecycleActions(
      job.actions,
      dependencies.lifecycle,
      dependencies.checkRuns,
      dependencies.workflowDispatch,
    );
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
