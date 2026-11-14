import { describe, expect, it, vi } from "vitest";
import {
  createProductionNeonOutboxOperation,
  runClaimedOutboxBatch,
} from "../../../apps/web/lib/neon-production-outbox.js";
import type { ClaimedControlPlaneOutboxEffect } from "../../../packages/db/src/control-plane-outbox-store.js";

const effect = (id: string) =>
  ({
    outboxId: id,
    effectType: "github.workflow.dispatch",
    payloadVersion: 1,
    idempotencyKey: id,
    attemptCount: 1,
    payload: { version: 1, type: "github.workflow.dispatch" },
  }) as ClaimedControlPlaneOutboxEffect;

describe("Neon one-batch durable GitHub outbox", () => {
  it("claims at most two existing persisted effects and processes each once in order", async () => {
    const calls: string[] = [];
    const claimEffects = vi.fn(async () => [effect("one"), effect("two")]);
    await runClaimedOutboxBatch({
      workerId: "neon-worker",
      limit: 2,
      signal: new AbortController().signal,
      claimEffects,
      process: async (item) => {
        calls.push(item.outboxId);
      },
    });
    expect(claimEffects).toHaveBeenCalledWith({ workerId: "neon-worker", limit: 2 });
    expect(calls).toEqual(["one", "two"]);
  });

  it("refuses a queue claim if exclusive PostgreSQL ownership is already lost", async () => {
    const controller = new AbortController();
    controller.abort();
    const claimEffects = vi.fn(async () => [effect("one")]);
    await expect(
      runClaimedOutboxBatch({
        workerId: "neon-worker",
        limit: 1,
        signal: controller.signal,
        claimEffects,
        process: vi.fn(),
      }),
    ).rejects.toThrow("worker_ownership_lost");
    expect(claimEffects).not.toHaveBeenCalled();
  });

  it("does not process another already-claimed effect after ownership loss", async () => {
    const controller = new AbortController();
    const process = vi.fn(async () => {
      controller.abort();
    });
    await expect(
      runClaimedOutboxBatch({
        workerId: "neon-worker",
        limit: 2,
        signal: controller.signal,
        claimEffects: async () => [effect("one"), effect("two")],
        process,
      }),
    ).rejects.toThrow("worker_ownership_lost");
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("does not turn failed database claims into an idle 200 outcome", async () => {
    await expect(
      runClaimedOutboxBatch({
        workerId: "neon-worker",
        limit: 1,
        signal: new AbortController().signal,
        claimEffects: async () => {
          throw new Error("postgres-down");
        },
        process: vi.fn(),
      }),
    ).rejects.toThrow("postgres-down");
  });

  it("rejects an unsupported outbox runner mode and missing required URL before any DB work", () => {
    const common = {
      workerId: "neon-worker",
      connectionString: "postgresql://worker@localhost/db",
      signal: new AbortController().signal,
    };
    expect(() =>
      createProductionNeonOutboxOperation({
        ...common,
        environment: {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "test",
          BOARDREADYOPS_RUNNER_MODE: "self-hosted",
          BOARDREADYOPS_PUBLIC_URL: "https://example.com",
        },
      }),
    ).toThrow("github-actions");
    expect(() =>
      createProductionNeonOutboxOperation({
        ...common,
        environment: { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "test" },
      }),
    ).toThrow("public URL");
    expect(() =>
      createProductionNeonOutboxOperation({
        ...common,
        environment: { BOARDREADYOPS_PUBLIC_URL: "https://example.com" },
      }),
    ).toThrow("GitHub App");
  });

  it("rejects an insecure callback origin or invalid workflow before claiming work", () => {
    const common = {
      workerId: "neon-worker",
      connectionString: "postgresql://worker@localhost/db",
      environment: {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "test",
        BOARDREADYOPS_PUBLIC_URL: "http://example.com",
      },
    };
    expect(() => createProductionNeonOutboxOperation(common)).toThrow("HTTPS");
    expect(() =>
      createProductionNeonOutboxOperation({
        ...common,
        environment: {
          ...common.environment,
          BOARDREADYOPS_PUBLIC_URL: "https://example.com",
          BOARDREADYOPS_DISPATCH_WORKFLOW: "../../workflow.yml",
        },
      }),
    ).toThrow("workflow");
  });
  it("rejects unbounded batch sizes even if called internally", async () => {
    await expect(
      runClaimedOutboxBatch({
        workerId: "neon-worker",
        limit: 100,
        signal: new AbortController().signal,
        claimEffects: vi.fn(),
        process: vi.fn(),
      }),
    ).rejects.toThrow("outbox batch limit");
  });
});
