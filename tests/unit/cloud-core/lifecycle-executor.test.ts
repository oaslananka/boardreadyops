import { describe, expect, it } from "vitest";
import type { GitHubAppLifecycleAction } from "../../../packages/cloud-core/src/lifecycle.js";
import {
  executeGitHubAppLifecycleActions,
  type GitHubAppLifecycleStore,
  releaseRunIdempotencyKey,
} from "../../../packages/cloud-core/src/lifecycle-executor.js";

const installation = {
  id: 12345,
  accountLogin: "octo-org",
  accountType: "Organization",
};

const repository = {
  id: 98765,
  owner: "octo-org",
  name: "hardware-board",
  fullName: "octo-org/hardware-board",
  private: true,
  defaultBranch: "main",
};

function recordingStore(calls: string[]): GitHubAppLifecycleStore {
  return {
    async upsertInstallation() {
      calls.push("installation.upsert");
    },
    async deleteInstallation() {
      calls.push("installation.deleted");
    },
    async upsertRepository() {
      calls.push("repository.upsert");
    },
    async removeRepository() {
      calls.push("repository.removed");
    },
    async enqueueReleaseRun() {
      calls.push("release_run.enqueue");
      return { idempotencyKey: "98765:12:0123456789abcdef", runId: "run-row-id" };
    },
    async attachGitHubCheckRun() {
      calls.push("release_run.attach_check_run");
    },
  };
}

describe("GitHub App lifecycle execution", () => {
  it("dispatches lifecycle actions to the configured store in order", async () => {
    const calls: string[] = [];
    const actions: GitHubAppLifecycleAction[] = [
      { type: "installation.upsert", installation },
      { type: "repository.upsert", installation, repository },
      {
        type: "release_run.enqueue",
        installation,
        repository,
        pullRequestNumber: 12,
        ref: "feature/ready",
        commitSha: "0123456789abcdef",
        triggerKind: "pr",
      },
    ];

    const result = await executeGitHubAppLifecycleActions(actions, recordingStore(calls));

    expect(calls).toEqual(["installation.upsert", "repository.upsert", "release_run.enqueue"]);
    expect(result).toEqual({
      total: 3,
      installationsUpserted: 1,
      installationsDeleted: 0,
      repositoriesUpserted: 1,
      repositoriesRemoved: 0,
      releaseRunsQueued: 1,
      checkRunsCreated: 0,
      checkRunsSkipped: 0,
    });
  });

  it("creates a stable release run idempotency key", () => {
    expect(
      releaseRunIdempotencyKey({
        type: "release_run.enqueue",
        installation,
        repository,
        pullRequestNumber: 12,
        ref: "feature/ready",
        commitSha: "0123456789abcdef",
        triggerKind: "pr",
      }),
    ).toBe("98765:12:0123456789abcdef");
  });
});
