import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareClaimedLocalArchiveZip } from "../../apps/web/lib/data-export-local-archive.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `postzip-${randomUUID()}`;
const installationId = randomUUID();
const repositoryId = randomUUID();
const createdExports: string[] = [];
let storageRoot = "";

function executor() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}

async function claimedExport() {
  const claimStore = new DataExportPreparationStore(executor());
  const exportId = await claimStore.createBoundPendingExport({
    tenantId: tenant,
    installationId,
    requestedBy: "original-requester",
    scope: "repository",
    scopeId: repositoryId,
  });
  if (!exportId) throw new Error("Expected an authorized bound export");
  createdExports.push(exportId);
  const claim = await claimStore.claimNext({ installationId, workerId: "postzip-integration" });
  if (!claim || claim.exportId !== exportId) throw new Error("Expected an active lease");
  return {
    exportId,
    claim: {
      exportId,
      tenantId: tenant,
      installationId,
      workerId: claim.workerId,
      token: claim.token,
    },
  };
}

beforeAll(async () => {
  if (!db) return;
  storageRoot = await mkdtemp(path.join(tmpdir(), "boardreadyops-postzip-pg-"));
  await db.query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  await db.query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'local-test','main')",
    [repositoryId, installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
});

afterAll(async () => {
  if (!db) return;
  try {
    await db.query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [createdExports]);
    await db.query("DELETE FROM installations WHERE id=$1", [installationId]);
  } finally {
    await db.close();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  }
});

describeDatabase("local export post-packaging PostgreSQL admission", () => {
  it("returns only an internal metadata ZIP with an active installation-bound claim", async () => {
    const { exportId, claim } = await claimedExport();
    const result = await prepareClaimedLocalArchiveZip({
      db: executor(),
      claim,
      storageRoot,
      storageDriver: "local",
    });
    expect(result?.files).toBe(7);
    expect(result?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const status = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((status as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it.each(["installation-suspended", "lease-expired"] as const)(
    "rejects an internally packed ZIP when %s before final authorization",
    async (change) => {
      const { exportId, claim } = await claimedExport();
      let manifestReads = 0;
      const wrapped = {
        ...executor(),
        async query(sql: string, params?: readonly unknown[]) {
          if (sql.includes("WITH allowed_request AS MATERIALIZED")) {
            manifestReads += 1;
            if (manifestReads === 2) {
              if (change === "installation-suspended") {
                await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]);
              } else {
                await executor().query(
                  "UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1",
                  [exportId],
                );
              }
            }
          }
          return await executor().query(sql, params);
        },
      };
      try {
        const result = await prepareClaimedLocalArchiveZip({
          db: wrapped,
          claim,
          storageRoot,
          storageDriver: "local",
        });
        expect(manifestReads).toBe(2);
        expect(result).toBeNull();
        const status = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
          exportId,
        ]);
        expect((status as { rows: unknown[] }).rows[0]).toMatchObject({
          status: "running",
          download_url: null,
          completed_at: null,
        });
      } finally {
        if (change === "installation-suspended") {
          await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
        }
      }
    },
  );
});
