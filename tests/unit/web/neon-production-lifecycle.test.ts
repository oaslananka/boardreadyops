import { describe, expect, it, vi } from "vitest";
import {
  createProductionNeonLifecycleHandler,
  runClaimedLifecycleBatch,
} from "../../../apps/web/lib/neon-production-lifecycle.js";
import type { ClaimedControlPlaneJob } from "../../../packages/db/src/control-plane-job-store.js";

const sampleJob = (id: string) =>
  ({
    jobId: id,
    deliveryId: `delivery-${id}`,
    jobType: "github_webhook.lifecycle",
    payloadVersion: 1,
    attemptCount: 1,
    eventType: "installation",
    actions: [
      { type: "installation.upsert", installation: { id: 111, accountLogin: "octo", accountType: "Organization" } },
    ],
  }) as ClaimedControlPlaneJob;

describe("Neon lifecycle work from durable GitHub webhook jobs", () => {
  const first = sampleJob("one");
  const second = sampleJob("two");

  it("claims a bounded batch and passes the original durable jobs to the canonical processor", async () => {
    const calls: string[] = [];
    const claimJobs = vi.fn(async () => [first, second]);
    const process = vi.fn(async (job: ClaimedControlPlaneJob) => {
      calls.push(job.jobId);
    });
    await runClaimedLifecycleBatch({
      workerId: "worker-1",
      limit: 2,
      claimJobs,
      process,
      signal: new AbortController().signal,
    });
    expect(claimJobs).toHaveBeenCalledWith({ workerId: "worker-1", limit: 2 });
    expect(calls).toEqual(["one", "two"]);
  });

  it("does not claim or process work after ownership has been aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const claimJobs = vi.fn(async () => [first]);
    const process = vi.fn();
    await expect(
      runClaimedLifecycleBatch({
        workerId: "worker-1",
        limit: 1,
        claimJobs,
        process,
        signal: controller.signal,
      }),
    ).rejects.toThrow("worker_ownership_lost");
    expect(claimJobs).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  it("stops before running the next claimed job after ownership is lost", async () => {
    const controller = new AbortController();
    const process = vi.fn(async () => {
      controller.abort();
    });
    await expect(
      runClaimedLifecycleBatch({
        workerId: "worker-1",
        limit: 2,
        claimJobs: async () => [first, second],
        process,
        signal: controller.signal,
      }),
    ).rejects.toThrow("worker_ownership_lost");
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("does not turn database claim failures into an idle success", async () => {
    const process = vi.fn();
    await expect(
      runClaimedLifecycleBatch({
        workerId: "worker-1",
        limit: 1,
        claimJobs: async () => {
          throw new Error("database-unavailable");
        },
        process,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("database-unavailable");
    expect(process).not.toHaveBeenCalled();
  });

  it("refuses enabled outbox operation when GitHub Actions execution is not configured", () => {
    expect(() =>
      createProductionNeonLifecycleHandler({
        triggerId: "trigger-1a2b3c4d-5e6f-7890-abcd-ef1234567890",
        connectionString: "postgresql://worker@localhost:5432/test",
        workerConnectionString: "postgresql://worker@localhost:5432/test",
        workerId: "neon-lifecycle-1",
        enableOutbox: true,
        environment: {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "test",
          BOARDREADYOPS_RUNNER_MODE: "self-hosted",
          BOARDREADYOPS_PUBLIC_URL: "https://example.com",
        },
      }),
    ).toThrow("github-actions");
  });
  it("requires a small bounded batch and authenticated GitHub App configuration", () => {
    const opts = {
      triggerId: "trigger-1a2b3c4d-5e6f-7890-abcd-ef1234567890",
      connectionString: "postgresql://worker@localhost:5432/test",
      workerConnectionString: "postgresql://worker@localhost:5432/test",
      workerId: "neon-lifecycle-1",
    };
    expect(() => createProductionNeonLifecycleHandler({ ...opts, batchLimit: 0 })).toThrow();
    expect(() => createProductionNeonLifecycleHandler({ ...opts, batchLimit: 100 })).toThrow();
    expect(() => createProductionNeonLifecycleHandler({ ...opts, environment: {} })).toThrow("GitHub App");
  });
});
