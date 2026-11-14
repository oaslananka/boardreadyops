import { describe, expect, it, vi } from "vitest";
import type { WorkerSinglePassOperations } from "../../apps/web/lib/control-plane-worker-runtime.js";
import { createExclusiveNeonScheduledWorkerHandler } from "../../apps/web/lib/neon-exclusive-worker-handler.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
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
    }),
  });
}

function tasks(onLifecycle: () => Promise<void>): WorkerSinglePassOperations {
  const noop = async () => undefined;
  return {
    lifecycle: onLifecycle,
    outbox: noop,
    artifactDeletion: noop,
    stripe: noop,
    lifecycleReconciliation: noop,
    githubReconciliation: noop,
    maintenance: noop,
  };
}

describeDatabase("Neon request admission and real exclusive PostgreSQL ownership", () => {
  const url = connectionString ?? "";

  it("prevents overlapping database writes across separate Function isolates and permits a successor", async () => {
    let start!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const firstOperations = vi.fn(() =>
      tasks(async () => {
        start();
        await hold;
      }),
    );
    const secondOperations = vi.fn(() => tasks(async () => undefined));

    const firstHandler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString: url,
      createOperations: firstOperations,
    });
    const separateIsolateHandler = createExclusiveNeonScheduledWorkerHandler({
      triggerId,
      connectionString: url,
      createOperations: secondOperations,
    });

    const firstRun = firstHandler(request());
    try {
      await started;
      const contending = await separateIsolateHandler(request());
      expect(contending.status).toBe(503);
      expect(contending.headers.get("retry-after")).toBe("60");
      expect(secondOperations).not.toHaveBeenCalled();
    } finally {
      finish();
    }
    expect((await firstRun).status).toBe(200);
    expect((await separateIsolateHandler(request())).status).toBe(200);
    expect(firstOperations).toHaveBeenCalledTimes(1);
    expect(secondOperations).toHaveBeenCalledTimes(1);
  });
});
