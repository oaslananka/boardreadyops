import { describe, expect, it, vi } from "vitest";
import { processControlPlaneJob } from "../../../apps/web/lib/control-plane-worker.js";
import type { GitHubAppDurableLifecycleStore } from "../../../packages/cloud-core/src/lifecycle-executor.js";
import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "../../../packages/db/src/control-plane-job-store.js";

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

const job: ClaimedControlPlaneJob = {
  jobId: "job-1",
  inboxId: "inbox-1",
  jobType: "github_webhook.lifecycle",
  payloadVersion: 1,
  attemptCount: 1,
  eventType: "pull_request",
  eventAction: "synchronize",
  deliveryId: "delivery-1",
  actions: [releaseAction],
};

function lifecycle(): GitHubAppDurableLifecycleStore {
  return {
    upsertInstallation: vi.fn(async () => undefined),
    deleteInstallation: vi.fn(async () => undefined),
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

function jobs(): ControlPlaneJobStore {
  return {
    acceptGitHubWebhook: vi.fn(),
    claimJobs: vi.fn(async () => []),
    completeJob: vi.fn(async () => "completed" as const),
    failJob: vi.fn(async () => "retry" as const),
    purgeExpired: vi.fn(async () => 0),
    collectMetrics: vi.fn(async () => ({
      availableJobs: 0,
      leasedJobs: 0,
      deadLetterJobs: 0,
      duplicateDeliveries: 0,
      oldestUnprocessedAgeSeconds: 0,
    })),
  };
}

describe("durable control-plane outbox planning", () => {
  it("commits release state plus outbox before completing the webhook job", async () => {
    const lifecycleStore = lifecycle();
    const jobStore = jobs();

    await expect(
      processControlPlaneJob(job, {
        workerId: "worker-1",
        jobs: jobStore,
        lifecycle: lifecycleStore,
      }),
    ).resolves.toMatchObject({ status: "completed" });

    expect(lifecycleStore.enqueueReleaseRunWithOutbox).toHaveBeenCalledWith(releaseAction);
    expect(jobStore.completeJob).toHaveBeenCalledAfter(
      vi.mocked(lifecycleStore.enqueueReleaseRunWithOutbox),
    );
  });
});
