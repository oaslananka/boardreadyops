import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import {
  ExportRecordSnapshotUnavailableError,
  prepareClaimedRunFindingSnapshot,
} from "../../packages/db/src/data-export-record-snapshot.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `export-snapshot-${randomUUID()}`;
const installation: [string, string] = [randomUUID(), randomUUID()];
const repository: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const runId: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const findingId: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
let exportId: string;
let token: string;

function executor() {
  if (!db) throw new Error("Test requires isolated PostgreSQL");
  return db;
}

beforeAll(async () => {
  if (!db) return;
  for (let index = 0; index < installation.length; index++) {
    await db.query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
      [installation[index], Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
    );
  }
  for (const [index, repoId] of repository.entries()) {
    await db.query(
      "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,$5,'main')",
      [
        repoId,
        installation[index === 2 ? 1 : 0],
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        tenant,
        `board-${index}`,
      ],
    );
    await db.query(
      "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
      [runId[index], repoId, "a".repeat(40)],
    );
    await db.query(
      "INSERT INTO findings(id,run_id,rule_id,severity,message,path,kind) VALUES($1,$2,$3,'warning',$4,'board.kicad_pcb','erc')",
      [findingId[index], runId[index], `rule-${index}`, `private finding ${index}`],
    );
  }
  const id = await new DataExportPreparationStore(db).createBoundPendingExport({
    tenantId: tenant,
    installationId: installation[0],
    requestedBy: "operator",
    scope: "repository",
    scopeId: repository[0],
  });
  if (!id) throw new Error("Expected bound export");
  exportId = id;
  const claim = await new DataExportPreparationStore(db).claimNext({
    installationId: installation[0],
    workerId: "snapshot-worker",
  });
  if (!claim || claim.exportId !== id) throw new Error("Expected original lease");
  token = claim.token;
});

afterAll(async () => {
  if (!db) return;
  try {
    if (exportId) await db.query("DELETE FROM data_exports WHERE id=$1", [exportId]);
    await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [installation]);
  } finally {
    await db.close();
  }
});

describeDatabase("claimed run/finding snapshot PostgreSQL isolation", () => {
  it("excludes other repositories and other installations sharing the same tenant", async () => {
    const input = {
      exportId,
      tenantId: tenant,
      installationId: installation[0],
      workerId: "snapshot-worker",
      token,
    };
    const record = await prepareClaimedRunFindingSnapshot(executor(), input);
    expect(record?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record?.byteLength).toBeGreaterThan(0);
    const decoded = JSON.parse(record?.bytes.toString("utf8") ?? "{}");
    expect(decoded).toMatchObject({
      exportId,
      coverage: "active-installation-release-runs-and-findings-only",
      runs: [{ id: runId[0], repositoryId: repository[0] }],
      findings: [{ id: findingId[0], runId: runId[0], message: "private finding 0" }],
    });
    for (const phrase of [runId[1], runId[2], findingId[1], findingId[2], "storage_path"]) {
      expect(record?.bytes.toString("utf8")).not.toContain(phrase);
    }
    expect(await prepareClaimedRunFindingSnapshot(executor(), { ...input, token: "stolen-token" })).toBeNull();
    expect(
      await prepareClaimedRunFindingSnapshot(executor(), { ...input, installationId: installation[1] }),
    ).toBeNull();
    expect(await prepareClaimedRunFindingSnapshot(executor(), { ...input, tenantId: "different-tenant" })).toBeNull();
  });

  it("denies disabled repository, suspended installation, and expired original lease", async () => {
    const input = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await executor().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repository[0]]);
    try {
      expect(await prepareClaimedRunFindingSnapshot(executor(), input)).toBeNull();
    } finally {
      await executor().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repository[0]]);
    }
    await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installation[0]]);
    try {
      expect(await prepareClaimedRunFindingSnapshot(executor(), input)).toBeNull();
    } finally {
      await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installation[0]]);
    }
    await executor().query("UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1", [
      exportId,
    ]);
    expect(await prepareClaimedRunFindingSnapshot(executor(), input)).toBeNull();
  });

  it("fails instead of silently dropping 101 authorized records", async () => {
    const input = { exportId, tenantId: tenant, installationId: installation[0], workerId: "snapshot-worker", token };
    await executor().query("UPDATE data_exports SET preparation_lease_until=NOW()+interval '2 minutes' WHERE id=$1", [
      exportId,
    ]);
    await executor().query(
      `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
        SELECT gen_random_uuid()::text,$1,$2,'refs/heads/main','manual','completed'
        FROM generate_series(1,101)`,
      [repository[0], "b".repeat(40)],
    );
    await expect(prepareClaimedRunFindingSnapshot(executor(), input)).rejects.toThrow(
      ExportRecordSnapshotUnavailableError,
    );
    const state = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((state as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });
});
