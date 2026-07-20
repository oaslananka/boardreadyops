import { describe, expect, it, vi } from "vitest";
import { processControlPlaneJob } from "../../../apps/web/lib/control-plane-worker.js";
import type { GitHubAppLifecycleStore } from "../../../packages/cloud-core/src/lifecycle-executor.js";
import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "../../../packages/db/src/control-plane-job-store.js";

function lifecycleStore(): GitHubAppLifecycleStore {
  return {
    upsertInstallation: vi.fn(async () => undefined),
    deleteInstallation: vi.fn(async () => undefined),
    upsertRepository: vi.fn(async () => undefined),
    removeRepository: vi.fn(async () => undefined),
    enqueueReleaseRun: vi.fn(async () => ({ idempotencyKey: "key" })),
    attachGitHubCheckRun: vi.fn(async () => undefined),
    bindReleaseRunExecutionAttempt: vi.fn(async () => false),
    markReleaseRunDispatched: vi.fn(async () => undefined),
    markReleaseRunSkipped: vi.fn(async () => undefined),
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
  it("completes a durable job only after lifecycle actions finish", async () => {
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

  it("requeues a failed job with a bounded redacted error", async () => {
    const lifecycle = lifecycleStore();
    vi.mocked(lifecycle.upsertInstallation).mockRejectedValue(new Error(`secret=${"x".repeat(1200)}`));
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
