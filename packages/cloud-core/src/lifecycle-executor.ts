import type { GitHubAppLifecycleAction } from "./lifecycle.js";

export type EnqueueReleaseRunInput = Extract<GitHubAppLifecycleAction, { type: "release_run.enqueue" }>;

export type GitHubAppLifecycleStore = {
  upsertInstallation(action: Extract<GitHubAppLifecycleAction, { type: "installation.upsert" }>): Promise<void>;
  deleteInstallation(action: Extract<GitHubAppLifecycleAction, { type: "installation.deleted" }>): Promise<void>;
  upsertRepository(action: Extract<GitHubAppLifecycleAction, { type: "repository.upsert" }>): Promise<void>;
  removeRepository(action: Extract<GitHubAppLifecycleAction, { type: "repository.removed" }>): Promise<void>;
  enqueueReleaseRun(action: EnqueueReleaseRunInput): Promise<void>;
};

export type GitHubAppLifecycleExecutionResult = {
  total: number;
  installationsUpserted: number;
  installationsDeleted: number;
  repositoriesUpserted: number;
  repositoriesRemoved: number;
  releaseRunsQueued: number;
};

export const emptyGitHubAppLifecycleExecutionResult = {
  total: 0,
  installationsUpserted: 0,
  installationsDeleted: 0,
  repositoriesUpserted: 0,
  repositoriesRemoved: 0,
  releaseRunsQueued: 0,
} as const satisfies GitHubAppLifecycleExecutionResult;

export function releaseRunIdempotencyKey(action: EnqueueReleaseRunInput): string {
  return [action.repository.id, action.pullRequestNumber, action.commitSha].join(":");
}

export async function executeGitHubAppLifecycleActions(
  actions: readonly GitHubAppLifecycleAction[],
  store: GitHubAppLifecycleStore,
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
      case "release_run.enqueue":
        await store.enqueueReleaseRun(action);
        result.releaseRunsQueued += 1;
        break;
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
    async enqueueReleaseRun() {},
  };
}
