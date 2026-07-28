import type { GitHubAppLifecycleAction, GitHubAppLifecycleContext } from "./lifecycle.js";
import type { EnqueuedReleaseRun, EnqueueReleaseRunInput, GitHubAppLifecycleStore } from "./lifecycle-executor.js";

export type EnqueuedReleaseRunWithOutbox = EnqueuedReleaseRun & {
  outboxId?: string;
};

export type GitHubAppDurableLifecycleStore = Pick<
  GitHubAppLifecycleStore,
  | "deleteInstallation"
  | "removeRepository"
  | "suspendInstallation"
  | "unsuspendInstallation"
  | "upsertInstallation"
  | "upsertRepository"
> & {
  enqueueReleaseRunWithOutbox(action: EnqueueReleaseRunInput): Promise<EnqueuedReleaseRunWithOutbox>;
};

export type DurableLifecyclePlanResult = {
  total: number;
  installationsUpserted: number;
  installationsDeleted: number;
  installationsSuspended: number;
  installationsUnsuspended: number;
  repositoriesUpserted: number;
  repositoriesRemoved: number;
  releaseRunsPlanned: number;
  outboxEffectsPlanned: number;
};

export async function planGitHubAppLifecycleActions(
  actions: readonly GitHubAppLifecycleAction[],
  store: GitHubAppDurableLifecycleStore,
  context?: GitHubAppLifecycleContext,
): Promise<DurableLifecyclePlanResult> {
  const result: DurableLifecyclePlanResult = {
    total: actions.length,
    installationsUpserted: 0,
    installationsDeleted: 0,
    installationsSuspended: 0,
    installationsUnsuspended: 0,
    repositoriesUpserted: 0,
    repositoriesRemoved: 0,
    releaseRunsPlanned: 0,
    outboxEffectsPlanned: 0,
  };

  for (const action of actions) {
    switch (action.type) {
      case "installation.upsert":
        await store.upsertInstallation(action, context);
        result.installationsUpserted += 1;
        break;
      case "installation.deleted":
        await store.deleteInstallation(action, context);
        result.installationsDeleted += 1;
        break;
      case "installation.suspended":
        await store.suspendInstallation(action, context);
        result.installationsSuspended += 1;
        break;
      case "installation.unsuspended":
        await store.unsuspendInstallation(action, context);
        result.installationsUnsuspended += 1;
        break;
      case "repository.upsert":
        await store.upsertRepository(action, context);
        result.repositoriesUpserted += 1;
        break;
      case "repository.removed":
        await store.removeRepository(action, context);
        result.repositoriesRemoved += 1;
        break;
      case "release_run.enqueue": {
        const planned = await store.enqueueReleaseRunWithOutbox(action);
        if (planned.runId) result.releaseRunsPlanned += 1;
        if (planned.outboxId) result.outboxEffectsPlanned += 1;
        break;
      }
      default: {
        const exhaustive: never = action;
        throw new Error(`Unsupported durable lifecycle action: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return result;
}
