import { describe, expect, it, vi } from "vitest";
import {
  type GitHubAppDurableLifecycleStore,
  planGitHubAppLifecycleActions,
} from "../../../packages/cloud-core/src/durable-lifecycle-planner.js";

const releaseAction = {
  type: "release_run.enqueue" as const,
  installation: { id: 12345 },
  repository: {
    id: 1283305324,
    owner: "oaslananka",
    name: "boardreadyops",
    fullName: "oaslananka/boardreadyops",
    private: false,
    defaultBranch: "main",
  },
  pullRequestNumber: 42,
  ref: "feature/ready",
  commitSha: "0123456789abcdef",
  triggerKind: "pr" as const,
};

function store(): GitHubAppDurableLifecycleStore {
  return {
    upsertInstallation: vi.fn(async () => undefined),
    deleteInstallation: vi.fn(async () => undefined),
    suspendInstallation: vi.fn(async () => undefined),
    unsuspendInstallation: vi.fn(async () => undefined),
    upsertRepository: vi.fn(async () => undefined),
    removeRepository: vi.fn(async () => undefined),
    enqueueReleaseRunWithOutbox: vi.fn(async () => ({
      idempotencyKey: "1283305324:42:0123456789abcdef",
      runId: "run-row-id",
      status: "queued",
      outboxId: "outbox-row-id",
    })),
  };
}

describe("durable lifecycle planner", () => {
  it("plans release state and an outbox effect without external clients", async () => {
    const lifecycle = store();

    await expect(planGitHubAppLifecycleActions([releaseAction], lifecycle)).resolves.toEqual({
      total: 1,
      installationsUpserted: 0,
      installationsDeleted: 0,
      installationsSuspended: 0,
      installationsUnsuspended: 0,
      repositoriesUpserted: 0,
      repositoriesRemoved: 0,
      releaseRunsPlanned: 1,
      outboxEffectsPlanned: 1,
    });
    expect(lifecycle.enqueueReleaseRunWithOutbox).toHaveBeenCalledWith(releaseAction);
  });

  it("plans installation suspension transitions with webhook audit context", async () => {
    const lifecycle = store();
    const installation = { id: 12345, accountLogin: "oaslananka", accountType: "User" };
    const suspended = { type: "installation.suspended" as const, installation };
    const unsuspended = { type: "installation.unsuspended" as const, installation };
    const context = {
      deliveryId: "delivery-suspension",
      eventType: "installation",
      eventAction: "suspend",
    };

    await expect(planGitHubAppLifecycleActions([suspended, unsuspended], lifecycle, context)).resolves.toEqual({
      total: 2,
      installationsUpserted: 0,
      installationsDeleted: 0,
      installationsSuspended: 1,
      installationsUnsuspended: 1,
      repositoriesUpserted: 0,
      repositoriesRemoved: 0,
      releaseRunsPlanned: 0,
      outboxEffectsPlanned: 0,
    });
    expect(lifecycle.suspendInstallation).toHaveBeenCalledWith(suspended, context);
    expect(lifecycle.unsuspendInstallation).toHaveBeenCalledWith(unsuspended, context);
  });

  it("preserves action order for replay-safe database changes", async () => {
    const lifecycle = store();
    const installationAction = {
      type: "installation.upsert" as const,
      installation: { id: 12345, accountLogin: "oaslananka", accountType: "User" },
    };
    const repositoryAction = {
      type: "repository.upsert" as const,
      installation: installationAction.installation,
      repository: releaseAction.repository,
    };

    await planGitHubAppLifecycleActions([installationAction, repositoryAction, releaseAction], lifecycle);

    expect(vi.mocked(lifecycle.upsertInstallation).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(lifecycle.upsertRepository).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(vi.mocked(lifecycle.upsertRepository).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(lifecycle.enqueueReleaseRunWithOutbox).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
  it("passes webhook audit context only to lifecycle metadata mutations", async () => {
    const lifecycle = store();
    const installationAction = {
      type: "installation.upsert" as const,
      installation: { id: 12345, accountLogin: "oaslananka", accountType: "User" },
    };
    const repositoryAction = {
      type: "repository.upsert" as const,
      installation: installationAction.installation,
      repository: releaseAction.repository,
    };
    const context = {
      deliveryId: "delivery-123",
      eventType: "installation",
      eventAction: "created",
    };

    await planGitHubAppLifecycleActions([installationAction, repositoryAction, releaseAction], lifecycle, context);

    expect(lifecycle.upsertInstallation).toHaveBeenCalledWith(installationAction, context);
    expect(lifecycle.upsertRepository).toHaveBeenCalledWith(repositoryAction, context);
    expect(lifecycle.enqueueReleaseRunWithOutbox).toHaveBeenCalledWith(releaseAction);
  });
});
