import type { GitHubAppLifecycleAction } from "./lifecycle.js";

export type EnqueueReleaseRunInput = Extract<GitHubAppLifecycleAction, { type: "release_run.enqueue" }>;

export type EnqueuedReleaseRun = {
  idempotencyKey: string;
  runId?: string;
  githubCheckRunId?: number | string | null;
  status?: string;
};

export type AttachGitHubCheckRunInput = {
  idempotencyKey: string;
  githubCheckRunId: number;
};

export type MarkReleaseRunDispatchedInput = {
  runId: string;
};

export type MarkReleaseRunSkippedInput = {
  runId: string;
  completedAt: string;
};

export type CreatePullRequestCheckRunInput = {
  action: EnqueueReleaseRunInput;
  runId: string;
  idempotencyKey: string;
};

export type DispatchReleaseRunWorkflowInput = CreatePullRequestCheckRunInput & {
  githubCheckRunId: number | string;
};

export type CompleteGitHubCheckRunInput = {
  installationId: string | number;
  repositoryOwner: string;
  repositoryName: string;
  checkRunId: string | number;
  runId: string;
  conclusion: "failure" | "neutral" | "success" | "timed_out";
  title: string;
  summary: string;
  completedAt?: string | undefined;
};

export type GitHubAppCheckRunClient = {
  createPullRequestCheckRun(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
  completeCheckRun?: (input: CompleteGitHubCheckRunInput) => Promise<void>;
};

export type GitHubAppWorkflowDispatchClient = {
  dispatchReleaseRunWorkflow(input: DispatchReleaseRunWorkflowInput): Promise<{ workflowDispatchId?: string }>;
};

export type GitHubAppLifecycleStore = {
  upsertInstallation(action: Extract<GitHubAppLifecycleAction, { type: "installation.upsert" }>): Promise<void>;
  deleteInstallation(action: Extract<GitHubAppLifecycleAction, { type: "installation.deleted" }>): Promise<void>;
  upsertRepository(action: Extract<GitHubAppLifecycleAction, { type: "repository.upsert" }>): Promise<void>;
  removeRepository(action: Extract<GitHubAppLifecycleAction, { type: "repository.removed" }>): Promise<void>;
  enqueueReleaseRun(action: EnqueueReleaseRunInput): Promise<EnqueuedReleaseRun>;
  attachGitHubCheckRun(input: AttachGitHubCheckRunInput): Promise<void>;
  markReleaseRunDispatched(input: MarkReleaseRunDispatchedInput): Promise<void>;
  markReleaseRunSkipped(input: MarkReleaseRunSkippedInput): Promise<void>;
};

export type GitHubAppLifecycleExecutionResult = {
  total: number;
  installationsUpserted: number;
  installationsDeleted: number;
  repositoriesUpserted: number;
  repositoriesRemoved: number;
  releaseRunsQueued: number;
  checkRunsCreated: number;
  checkRunsSkipped: number;
  workflowDispatchesCreated: number;
  workflowDispatchesSkipped: number;
};

export const emptyGitHubAppLifecycleExecutionResult = {
  total: 0,
  installationsUpserted: 0,
  installationsDeleted: 0,
  repositoriesUpserted: 0,
  repositoriesRemoved: 0,
  releaseRunsQueued: 0,
  checkRunsCreated: 0,
  checkRunsSkipped: 0,
  workflowDispatchesCreated: 0,
  workflowDispatchesSkipped: 0,
} as const satisfies GitHubAppLifecycleExecutionResult;

export function releaseRunIdempotencyKey(action: EnqueueReleaseRunInput): string {
  return [action.repository.id, action.pullRequestNumber, action.commitSha].join(":");
}

function dispatchSkipReason(action: EnqueueReleaseRunInput): string | undefined {
  if (action.pullRequestDraft) {
    return "draft pull request";
  }

  if (action.pullRequestFromFork) {
    return "fork pull request safe mode";
  }

  return undefined;
}

async function completeSkippedCheckRun(
  action: EnqueueReleaseRunInput,
  runId: string,
  checkRunId: number | string,
  reason: string,
  completedAt: string,
  checkRunClient: GitHubAppCheckRunClient,
): Promise<void> {
  if (!checkRunClient.completeCheckRun) {
    return;
  }

  await checkRunClient.completeCheckRun({
    installationId: action.installation.id,
    repositoryOwner: action.repository.owner,
    repositoryName: action.repository.name,
    checkRunId,
    runId,
    conclusion: "neutral",
    title: "BoardReadyOps release readiness skipped",
    summary: `Runner dispatch was skipped by BoardReadyOps safe mode: ${reason}.`,
    completedAt,
  });
}

async function executeReleaseRun(
  action: EnqueueReleaseRunInput,
  releaseRun: EnqueuedReleaseRun & { runId: string },
  store: GitHubAppLifecycleStore,
  result: GitHubAppLifecycleExecutionResult,
  checkRunClient?: GitHubAppCheckRunClient,
  workflowDispatchClient?: GitHubAppWorkflowDispatchClient,
): Promise<void> {
  let checkRunId = releaseRun.githubCheckRunId ?? undefined;
  let checkRunCreated = false;

  if (checkRunId === undefined || checkRunId === null) {
    if (!checkRunClient) {
      result.workflowDispatchesSkipped += 1;
      return;
    }

    const checkRun = await checkRunClient.createPullRequestCheckRun({
      action,
      runId: releaseRun.runId,
      idempotencyKey: releaseRun.idempotencyKey,
    });
    await store.attachGitHubCheckRun({
      idempotencyKey: releaseRun.idempotencyKey,
      githubCheckRunId: checkRun.id,
    });
    checkRunId = checkRun.id;
    checkRunCreated = true;
    result.checkRunsCreated += 1;
  } else {
    result.checkRunsSkipped += 1;
  }

  const skipReason = dispatchSkipReason(action);
  if (skipReason) {
    if (releaseRun.status === undefined || releaseRun.status === "queued") {
      const completedAt = new Date().toISOString();
      await store.markReleaseRunSkipped({ runId: releaseRun.runId, completedAt });
      if (checkRunClient) {
        await completeSkippedCheckRun(action, releaseRun.runId, checkRunId, skipReason, completedAt, checkRunClient);
      }
    } else if (releaseRun.status === "completed" && checkRunClient) {
      await completeSkippedCheckRun(
        action,
        releaseRun.runId,
        checkRunId,
        skipReason,
        new Date().toISOString(),
        checkRunClient,
      );
    }

    result.workflowDispatchesSkipped += 1;
    return;
  }

  if (!workflowDispatchClient) {
    result.workflowDispatchesSkipped += 1;
    return;
  }

  if (!checkRunCreated && releaseRun.status !== undefined && releaseRun.status !== "queued") {
    result.workflowDispatchesSkipped += 1;
    return;
  }

  await workflowDispatchClient.dispatchReleaseRunWorkflow({
    action,
    runId: releaseRun.runId,
    idempotencyKey: releaseRun.idempotencyKey,
    githubCheckRunId: checkRunId,
  });
  await store.markReleaseRunDispatched({ runId: releaseRun.runId });
  result.workflowDispatchesCreated += 1;
}

export async function executeGitHubAppLifecycleActions(
  actions: readonly GitHubAppLifecycleAction[],
  store: GitHubAppLifecycleStore,
  checkRunClient?: GitHubAppCheckRunClient,
  workflowDispatchClient?: GitHubAppWorkflowDispatchClient,
): Promise<GitHubAppLifecycleExecutionResult> {
  const result: GitHubAppLifecycleExecutionResult = {
    ...emptyGitHubAppLifecycleExecutionResult,
    total: actions.length,
  };

  for (const action of actions) {
    switch (action.type) {
      case "installation.upsert":
        await store.upsertInstallation(action);
        result.installationsUpserted += 1;
        break;
      case "installation.deleted":
        await store.deleteInstallation(action);
        result.installationsDeleted += 1;
        break;
      case "repository.upsert":
        await store.upsertRepository(action);
        result.repositoriesUpserted += 1;
        break;
      case "repository.removed":
        await store.removeRepository(action);
        result.repositoriesRemoved += 1;
        break;
      case "release_run.enqueue": {
        const releaseRun = await store.enqueueReleaseRun(action);

        if (!releaseRun.runId) {
          result.checkRunsSkipped += 1;
          result.workflowDispatchesSkipped += 1;
          break;
        }

        result.releaseRunsQueued += 1;
        await executeReleaseRun(
          action,
          { ...releaseRun, runId: releaseRun.runId },
          store,
          result,
          checkRunClient,
          workflowDispatchClient,
        );
        break;
      }
      default: {
        const exhaustive: never = action;
        throw new Error(`Unsupported GitHub App lifecycle action: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return result;
}

export function createNoopGitHubAppLifecycleStore(): GitHubAppLifecycleStore {
  return {
    async upsertInstallation() {},
    async deleteInstallation() {},
    async upsertRepository() {},
    async removeRepository() {},
    async enqueueReleaseRun() {
      return { idempotencyKey: "noop" };
    },
    async attachGitHubCheckRun() {},
    async markReleaseRunDispatched() {},
    async markReleaseRunSkipped() {},
  };
}
