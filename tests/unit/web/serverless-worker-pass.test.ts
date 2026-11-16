import { describe, expect, it, vi } from "vitest";
import {
  detectBoundedReconciliationCandidates,
  drainBoundedQueues,
} from "../../../apps/web/lib/serverless-worker-pass.js";

describe("serverless bounded worker", () => {
  it("detects missing lifecycle/workflow/Check Run recovery candidates using one bounded snapshot", async () => {
    const operations = {
      detectLifecycleReconciliationCandidates: vi.fn(async () => 1),
      detectWorkflowReconciliationCandidates: vi.fn(async () => 2),
      detectCheckRunReconciliationCandidates: vi.fn(async () => 3),
    };
    const result = await detectBoundedReconciliationCandidates(operations, 300);
    expect(result).toEqual({ lifecycle: 1, workflow: 2, checkRun: 3 });
    for (const detect of Object.values(operations)) {
      expect(detect).toHaveBeenCalledWith({
        observationDelaySeconds: 300,
        terminalDeadlineSeconds: 1800,
        limit: 16,
      });
    }
  });

  it("processes durable lifecycle jobs before GitHub outbox effects and reconciliation in bounded batches", async () => {
    const order: string[] = [];
    const makeQueue = (name: string, count: number) => ({
      claim: vi.fn(async (limit: number) => {
        expect(limit).toBeLessThanOrEqual(4);
        order.push(`claim:${name}`);
        return Array.from({ length: count }, (_, i) => i);
      }),
      process: vi.fn(async (item: number) => {
        order.push(`${name}:${item}`);
        return { status: "completed" };
      }),
    });
    const jobs = makeQueue("jobs", 2);
    const outbox = makeQueue("outbox", 1);
    const lifecycle = makeQueue("lifecycle", 0);

    const result = await drainBoundedQueues({ jobs, outbox, lifecycle }, { batchSize: 2 });

    expect(result).toEqual({
      jobs: 2,
      outbox: 1,
      lifecycle: 0,
      workflow: 0,
      checkRun: 0,
    });
    expect(order).toEqual(["claim:jobs", "jobs:0", "jobs:1", "claim:outbox", "outbox:0", "claim:lifecycle"]);
  });

  it("caps externally supplied batch sizes and does not claim downstream effects when a processor fails", async () => {
    const failure = new Error("secret-provider-internal-failure");
    const jobs = {
      claim: vi.fn(async () => [1]),
      process: vi.fn(async () => {
        throw failure;
      }),
    };
    const outbox = {
      claim: vi.fn(async () => [2]),
      process: vi.fn(async () => ({ status: "completed" })),
    };

    await expect(drainBoundedQueues({ jobs, outbox }, { batchSize: 500 })).rejects.toThrow(failure);
    expect(jobs.claim).toHaveBeenCalledWith(4);
    expect(outbox.claim).not.toHaveBeenCalled();
  });

  it("does not claim a disabled queue or execute any unrequested maintenance work", async () => {
    const jobs = {
      claim: vi.fn(async () => []),
      process: vi.fn(),
    };
    const result = await drainBoundedQueues({ jobs });
    expect(result).toMatchObject({ jobs: 0, outbox: 0, lifecycle: 0, workflow: 0, checkRun: 0 });
    expect(jobs.claim).toHaveBeenCalledWith(2);
  });
});
