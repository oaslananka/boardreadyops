import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProductionBatchInput } from "../../packages/cloud-core/src/production-outcomes.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlProductionOutcomeStore } from "../../packages/db/src/production-outcome-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "7e000000-0000-4000-8000-000000000001";
const otherInstallationId = "7e000000-0000-4000-8000-000000000002";
const repositoryId = "7e000000-0000-4000-8000-000000000003";
const runId = "7e000000-0000-4000-8000-000000000004";
const sourceSha256 = "b".repeat(64);
const now = new Date("2026-10-05T00:40:00.000Z");

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function batch(): ProductionBatchInput {
  return {
    externalBatchId: "PILOT-42",
    manufacturer: "Acme EMS",
    manufacturedOn: "2026-10-01",
    quantity: 750,
    firstPassYieldBps: 9875,
    reworkCount: 6,
    scrapCount: 2,
    notes: "Design-partner pilot",
    correctiveAction: "Tighten paste inspection on U3",
    defects: [
      { category: "aoi", code: "QFN_BRIDGE", count: 3, notes: "U3" },
      { category: "functional_test", code: "BOOT_TIMEOUT", count: 2 },
    ],
  };
}

beforeAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = any($1::text[])", [
    [installationId, otherInstallationId],
  ]);
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
     values ($1, 48301, 'production-outcome', 'Organization', 'team'),
            ($2, 48302, 'production-outcome-other', 'Organization', 'team')`,
    [installationId, otherInstallationId],
  );
  await database().query(
    `insert into repositories (id, installation_id, github_repo_id, owner, name, default_branch)
     values ($1, $2, 48303, 'acme', 'hardware', 'main')`,
    [repositoryId, installationId],
  );
  await database().query(
    `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
     values ($1, $2, $3, 'refs/heads/main', 'pr', 'completed')`,
    [runId, repositoryId, "e".repeat(40)],
  );
});

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where id = any($1::text[])", [
    [installationId, otherInstallationId],
  ]);
  await executor.close();
});

describeDatabase("production outcome store", () => {
  it("imports one release-linked batch and its normalized defects", async () => {
    const store = createSqlProductionOutcomeStore(database(), { now: () => now });

    const imported = await store.importBatch({
      installationId,
      releaseRunId: runId,
      batch: batch(),
      sourceKind: "csv",
      sourceSha256,
      sourceName: "pilot-outcomes.csv",
    });

    expect(imported.created).toBe(true);

    const batchRows = await database().query(
      `select release_run_id, external_batch_id, manufacturer, manufactured_on::text, quantity,
              first_pass_yield_bps, rework_count, scrap_count, source_kind, source_sha256
         from production_batches where id = $1`,
      [imported.id],
    );
    expect((batchRows as { rows?: unknown[] }).rows).toEqual([
      expect.objectContaining({
        release_run_id: runId,
        external_batch_id: "PILOT-42",
        manufacturer: "Acme EMS",
        manufactured_on: "2026-10-01",
        quantity: 750,
        first_pass_yield_bps: 9875,
        rework_count: 6,
        scrap_count: 2,
        source_kind: "csv",
        source_sha256: sourceSha256,
      }),
    ]);

    const defectRows = await database().query(
      "select category, code, defect_count, notes from production_batch_defects where production_batch_id = $1 order by category, code",
      [imported.id],
    );
    expect((defectRows as { rows?: unknown[] }).rows).toEqual([
      { category: "aoi", code: "QFN_BRIDGE", defect_count: 3, notes: "U3" },
      { category: "functional_test", code: "BOOT_TIMEOUT", defect_count: 2, notes: null },
    ]);
  });

  it("is idempotent for the same source digest and refuses cross-tenant or conflicting imports", async () => {
    const store = createSqlProductionOutcomeStore(database(), { now: () => now });

    const replay = await store.importBatch({
      installationId,
      releaseRunId: runId,
      batch: batch(),
      sourceKind: "csv",
      sourceSha256,
      sourceName: "renamed-copy.csv",
    });
    expect(replay.created).toBe(false);

    await expect(
      store.importBatch({
        installationId: otherInstallationId,
        releaseRunId: runId,
        batch: batch(),
        sourceKind: "csv",
        sourceSha256,
      }),
    ).rejects.toThrow("release is not accessible");

    await expect(
      store.importBatch({
        installationId,
        releaseRunId: runId,
        batch: batch(),
        sourceKind: "csv",
        sourceSha256: "c".repeat(64),
      }),
    ).rejects.toThrow("conflicts with an existing batch");
  });
});
