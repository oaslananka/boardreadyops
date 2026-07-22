import { describe, expect, it, vi } from "vitest";
import { processControlPlaneJob } from "../../../apps/web/lib/control-plane-worker.js";
import type { GitHubAppDurableLifecycleStore } from "../../../packages/cloud-core/src/durable-lifecycle-planner.js";
import type {
  ClaimedControlPlaneJob,
  ControlPlaneJobStore,
} from "../../../packages/db/src/control-plane-job-store.js";

function lifecycleStore(): GitHubAppDurableLifecycleStore {
  return {
    upsertInstallation: vi.fn(async () => undefined),
    deleteInstallation: vi.fn(async () => undefined),
    upsertRepository: vi.fn(async () => undefined),
    removeRepository: vi.fn(async () => undefined),
    enqueueReleaseRunWithOutbox: vi.fn(async () => ({
      idempotencyKey: "key",
      runId: "run-1",
      outboxId: "outbox-1",
    })),
  };
}

function jobStore(overrides: Partial<ControlPlaneJobStore> = {}): ControlPlaneJobStore {
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
    ...overrides,
  };
}

const job: ClaimedControlPlaneJob = {
  jobId: "job-1",
  inboxId: "inbox-1",
  jobType: "github_webhook.lifecycle",
  payloadVersion: 1,
  attemptCount: 1,
  eventType: "installation",
  eventAction: "created",
  deliveryId: "delivery-1",
  actions: [
    {
      type: "installation.upsert",
      installation: { id: 123, accountLogin: "octo", accountType: "Organization" },
    },
  ],
};

describe("control-plane worker", () => {
  it("completes a durable job only after database lifecycle planning finishes", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();

    const result = await processControlPlaneJob(job, {
      workerId: "worker-1",
      jobs,
      lifecycle,
    });

    expect(result).toMatchObject({ status: "completed", jobId: "job-1" });
    expect(lifecycle.upsertInstallation).toHaveBeenCalledOnce();
    expect(jobs.completeJob).toHaveBeenCalledWith({ jobId: "job-1", workerId: "worker-1" });
    expect(jobs.failJob).not.toHaveBeenCalled();
  });

  it("plans release-run and outbox state without a direct GitHub client", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const releaseJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "pull_request",
      actions: [
        {
          type: "release_run.enqueue",
          installation: { id: 123 },
          repository: {
            id: 456,
            owner: "octo",
            name: "board",
            fullName: "octo/board",
            private: false,
            defaultBranch: "main",
          },
          pullRequestNumber: 7,
          ref: "refs/pull/7/head",
          commitSha: "a".repeat(40),
          triggerKind: "pull_request",
        },
      ],
    };

    await expect(
      processControlPlaneJob(releaseJob, { workerId: "worker-1", jobs, lifecycle }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(lifecycle.enqueueReleaseRunWithOutbox).toHaveBeenCalledOnce();
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("requeues a failed database plan with a bounded redacted error", async () => {
    const lifecycle = lifecycleStore();
    vi.mocked(lifecycle.upsertInstallation).mockRejectedValue(
      new Error(`secret=${"x".repeat(1200)}`),
    );
    const jobs = jobStore();

    const result = await processControlPlaneJob(job, {
      workerId: "worker-1",
      jobs,
      lifecycle,
    });

    expect(result).toMatchObject({ status: "retry", jobId: "job-1" });
    expect(jobs.completeJob).not.toHaveBeenCalled();
    expect(jobs.failJob).toHaveBeenCalledOnce();
    const failure = vi.mocked(jobs.failJob).mock.calls[0]?.[0];
    expect(failure?.errorClass).toBe("Error");
    expect(failure?.errorMessage.length).toBeLessThanOrEqual(500);
    expect(failure?.errorMessage).not.toContain("secret=");
  });
});
