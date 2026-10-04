import { describe, expect, it, vi } from "vitest";
import type { ProductionBatchInput } from "../../../packages/cloud-core/src/production-outcomes.js";
import { createSqlProductionOutcomeStore } from "../../../packages/db/src/production-outcome-store.js";

const now = new Date("2026-10-05T00:30:00.000Z");
const sourceSha256 = "a".repeat(64);

function batch(overrides: Partial<ProductionBatchInput> = {}): ProductionBatchInput {
  return {
    externalBatchId: "LOT-2026-10-A",
    manufacturer: "Acme EMS",
    manufacturedOn: "2026-10-01",
    quantity: 1000,
    firstPassYieldBps: 9825,
    reworkCount: 12,
    scrapCount: 3,
    notes: "Pilot batch",
    correctiveAction: "Inspect QFN stencil",
    defects: [
      { category: "aoi", code: "BRIDGE", count: 4, notes: "U3" },
      { category: "functional_test", code: "BOOT_FAIL", count: 2 },
    ],
    ...overrides,
  };
}

describe("production outcome store", () => {
  it("scopes release import through repository installation and writes normalized defects", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "batch-db-1", created: true, defects_written: 2 }] }));
    const store = createSqlProductionOutcomeStore({ query }, { now: () => now });

    await expect(
      store.importBatch({
        installationId: "inst-1",
        releaseRunId: "run-1",
        batch: batch(),
        sourceKind: "csv",
        sourceSha256,
        sourceName: " outcomes.csv ",
      }),
    ).resolves.toEqual({ id: "batch-db-1", created: true });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain("join repositories on repositories.id = release_runs.repository_id");
    expect(sql).toContain("repositories.installation_id = $2");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("production_batches.source_sha256 = $14");
    expect(params.slice(0, 6)).toEqual(["run-1", "inst-1", "LOT-2026-10-A", "Acme EMS", "2026-10-01", 1000]);
    expect(params[12]).toBe("outcomes.csv");
    expect(params[13]).toBe(sourceSha256);
    expect(params[14]).toBe(now.toISOString());
    expect(JSON.parse(String(params[15]))).toEqual([
      { category: "aoi", code: "BRIDGE", defect_count: 4, notes: "U3" },
      { category: "functional_test", code: "BOOT_FAIL", defect_count: 2, notes: null },
    ]);
  });

  it("reports an exact repeated import as idempotent", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "batch-db-1", created: false, defects_written: 0 }] }));
    const store = createSqlProductionOutcomeStore({ query }, { now: () => now });

    await expect(
      store.importBatch({
        installationId: "inst-1",
        releaseRunId: "run-1",
        batch: batch(),
        sourceKind: "csv",
        sourceSha256,
      }),
    ).resolves.toEqual({ id: "batch-db-1", created: false });
  });

  it("fails closed when the release is outside the installation or the logical batch conflicts", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createSqlProductionOutcomeStore({ query }, { now: () => now });

    await expect(
      store.importBatch({
        installationId: "other-installation",
        releaseRunId: "run-1",
        batch: batch(),
        sourceKind: "csv",
        sourceSha256,
      }),
    ).rejects.toThrow("conflicts with an existing batch or the release is not accessible");
  });

  it("rejects malformed provenance before database access", async () => {
    const query = vi.fn();
    const store = createSqlProductionOutcomeStore({ query });

    await expect(
      store.importBatch({
        installationId: "inst-1",
        releaseRunId: "run-1",
        batch: batch(),
        sourceKind: "csv",
        sourceSha256: "ABC",
      }),
    ).rejects.toThrow("lowercase SHA-256");
    expect(query).not.toHaveBeenCalled();
  });

  it("bounds defect fan-out before database access", async () => {
    const query = vi.fn();
    const store = createSqlProductionOutcomeStore({ query });
    const defects = Array.from({ length: 1001 }, (_, index) => ({
      category: "aoi" as const,
      code: `CODE_${index}`,
      count: 1,
    }));

    await expect(
      store.importBatch({
        installationId: "inst-1",
        releaseRunId: "run-1",
        batch: batch({ defects }),
        sourceKind: "api",
        sourceSha256,
      }),
    ).rejects.toThrow("1000-defect import limit");
    expect(query).not.toHaveBeenCalled();
  });
});
