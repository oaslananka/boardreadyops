import type { GitHubAppLifecycleAction } from "./lifecycle.js";

export type EnqueueReleaseRunInput = Extract<GitHubAppLifecycleAction, { type: "release_run.enqueue" }>;

export type EnqueuedReleaseRun = {
  idempotencyKey: string;
  runId?: string;
  githubCheckRunId?: number | string | null;
};

export type AttachGitHubCheckRunInput = {
  idempotencyKey: string;
  githubCheckRunId: number;
};

export type MarkReleaseRunDispatchedInput = {
  runId: string;
  workflowDispatchId?: string | undefined;
};

export type CreatePullRequestCheckRunInput = {
  action: EnqueueReleaseRunInput;
  runId: string;
  idempotencyKey: string;
};

export type DispatchReleaseRunWorkflowInput = CreatePullRequestCheckRunInput & {
  githubCheckRunId: number;
};

export type GitHubAppCheckRunClient = {
  createPullRequestCheckRun(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
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

        if (checkRunClient && !releaseRun.githubCheckRunId) {
          const checkRun = await checkRunClient.createPullRequestCheckRun({
            action,
            runId: releaseRun.runId,
            idempotencyKey: releaseRun.idempotencyKey,
          });
          await store.attachGitHubCheckRun({
            idempotencyKey: releaseRun.idempotencyKey,
            githubCheckRunId: checkRun.id,
          });
          result.checkRunsCreated += 1;

          if (workflowDispatchClient) {
            const workflowDispatch = await workflowDispatchClient.dispatchReleaseRunWorkflow({
              action,
              runId: releaseRun.runId,
              idempotencyKey: releaseRun.idempotencyKey,
              githubCheckRunId: checkRun.id,
            });
            await store.markReleaseRunDispatched({
              runId: releaseRun.runId,
              workflowDispatchId: workflowDispatch.workflowDispatchId,
            });
            result.workflowDispatchesCreated += 1;
          } else {
            result.workflowDispatchesSkipped += 1;
          }
        } else if (releaseRun.githubCheckRunId) {
          result.checkRunsSkipped += 1;
          result.workflowDispatchesSkipped += 1;
        } else {
          result.workflowDispatchesSkipped += 1;
        }
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
  };
}
