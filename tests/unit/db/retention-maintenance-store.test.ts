import { describe, expect, it, vi } from "vitest";
import { createSqlRetentionMaintenanceStore } from "../../../packages/db/src/retention-maintenance-store.js";

const now = new Date("2026-07-31T05:00:00.000Z");

describe("retention maintenance store", () => {
  it("purges expired runner request nonces in a bounded skip-locked batch", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ purged: 12 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeExpiredRunnerRequestNonces({ limit: 50_000 })).resolves.toBe(12);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /runner_request_nonces[\s\S]*for update skip locked[\s\S]*delete from runner_request_nonces/u,
      ),
      [now.toISOString(), 10_000],
    );
  });

  it("uses a safe default batch and normalizes malformed result counts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ purged: "not-a-number" }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeExpiredRunnerRequestNonces()).resolves.toBe(0);
    expect(query.mock.calls[0]?.[1]).toEqual([now.toISOString(), 1_000]);
  });

  it("rejects invalid configured batch limits before querying", () => {
    expect(() => createSqlRetentionMaintenanceStore({ query: vi.fn() }, { defaultBatchSize: 0 })).toThrow(
      "defaultBatchSize must be a positive integer",
    );
    expect(() => createSqlRetentionMaintenanceStore({ query: vi.fn() }, { defaultBatchSize: 1.5 })).toThrow(
      "defaultBatchSize must be a positive integer",
    );
  });
});
