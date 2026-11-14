import { describe, expect, it, vi } from "vitest";
import type { WorkerSinglePassOperations } from "../../../apps/web/lib/control-plane-worker-runtime.js";
import { createExclusiveNeonScheduledWorkerHandler } from "../../../apps/web/lib/neon-exclusive-worker-handler.js";

const triggerId = "trigger-1a2b3c4d-5e6f-7890-abcd-ef1234567890";
const invocationId = "abc123FUPHOw0Pl1ZooidgpJhvHaShi1aX40cQ0b321";

function request(): Request {
  return new Request("https://example.neon.tech/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-neon-trigger-invocation-id": invocationId,
    },
    body: JSON.stringify({
      version: 1,
      invocation_id: invocationId,
      trigger: { type: "schedule", id: triggerId, name: "control-plane-recovery" },
      data: { scheduled_at: "2026-11-14T17:00:00Z" },
      previous_attempts: [],
      previous_attempts_omitted: 0,
    }),
  });
}

function tasks(record: string[]): WorkerSinglePassOperations {
  const task = (name: string) => async () => {
    record.push(name);
  };
  return {
    lifecycle: task("lifecycle"),
    outbox: task("outbox"),
    artifactDeletion: task("artifactDeletion"),
    stripe: task("stripe"),
    lifecycleReconciliation: task("lifecycleReconciliation"),
    githubReconciliation: task("githubReconciliation"),
    maintenance: task("maintenance"),
  };
}

const connectionString = "postgresql://worker:ignored@localhost:5432/boardreadyops_test";

describe("Neon scheduled worker with exclusive database ownership", () => {
  it("claims the exclusive session BEFORE any processing and releases it afterward", async () => {
    const calls: string[] = [];
    const release = vi.fn(async () => {
      calls.push("release");
    });
    const acquireOwnership = vi.fn(async () => {
      calls.push("acquire");
      return { release };
    });
    const handler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString,
      acquireOwnership,
      createOperations: () => tasks(calls),
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(acquireOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString, onLost: expect.any(Function) }),
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "acquire",
      "lifecycle",
      "outbox",
      "artifactDeletion",
      "stripe",
      "lifecycleReconciliation",
      "githubReconciliation",
      "maintenance",
      "release",
    ]);
  });

  it("rejects a forged/unsupported request without opening a database session", async () => {
    const acquireOwnership = vi.fn(async () => ({ release: vi.fn() }));
    const handler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString,
      acquireOwnership,
      createOperations: () => tasks([]),
    });
    expect((await handler(new Request("https://example.neon.tech/", { method: "GET" }))).status).toBe(405);
    expect(acquireOwnership).not.toHaveBeenCalled();
  });

  it("fails closed when another worker holds the database lock", async () => {
    const acquireOwnership = vi.fn(async () => {
      throw new Error("exclusive_worker_ownership_unavailable");
    });
    const createOperations = vi.fn(() => tasks([]));
    const handler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString,
      acquireOwnership,
      createOperations,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(createOperations).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("exclusive_worker_ownership_unavailable");
  });

  it("releases ownership after failed operations and retries on a later request", async () => {
    const calls: string[] = [];
    const release = vi.fn(async () => undefined);
    const acquireOwnership = vi.fn(async () => ({ release }));
    let failed = false;
    const handler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString,
      acquireOwnership,
      createOperations: () => {
        const operations = tasks(calls);
        operations.outbox = async () => {
          if (!failed) {
            failed = true;
            throw new Error("credential=SECRET");
          }
          calls.push("outbox");
        };
        return operations;
      },
    });
    const first = await handler(request());
    expect(first.status).toBe(503);
    expect(JSON.stringify(await first.json())).not.toContain("SECRET");
    expect(release).toHaveBeenCalledTimes(1);
    expect((await handler(request())).status).toBe(200);
    expect(acquireOwnership).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("aborts and refuses later queue categories if the ownership session is lost", async () => {
    let loseLock: (() => void) | undefined;
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const record: string[] = [];
    const release = vi.fn(async () => undefined);
    const acquireOwnership = vi.fn(async (options: { onLost(): void }) => {
      loseLock = options.onLost;
      return { release };
    });
    let observedSignal: AbortSignal | undefined;
    const handler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString,
      acquireOwnership,
      createOperations: (signal) => {
        observedSignal = signal;
        const operations = tasks(record);
        operations.lifecycle = async () => {
          record.push("lifecycle_started");
          await work;
        };
        return operations;
      },
    });
    const pending = handler(request());
    await vi.waitFor(() => expect(record).toEqual(["lifecycle_started"]));
    expect(loseLock).toBeDefined();
    loseLock?.();
    expect(observedSignal?.aborted).toBe(true);
    finish();
    expect((await pending).status).toBe(503);
    expect(record).toEqual(["lifecycle_started"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects pooled Neon connections without exposing credentials", () => {
    expect(() =>
      createExclusiveNeonScheduledWorkerHandler({
        triggerId,
        connectionString: "postgresql://worker:secret@ep-a1-pooler.eu-central-1.aws.neon.tech/app",
        createOperations: () => tasks([]),
      }),
    ).toThrow("direct PostgreSQL connection");
  });
});
