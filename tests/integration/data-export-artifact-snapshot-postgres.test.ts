import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareClaimedArtifactMetadataSnapshot } from "../../packages/db/src/data-export-artifact-snapshot.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `artifact-snapshot-${randomUUID()}`;
const installations: [string, string] = [randomUUID(), randomUUID()];
const repositories: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const runs = repositories.map(() => randomUUID());
const artifacts = repositories.map(() => randomUUID());
let exportId: string;
let token: string;

function executor() {
  if (!db) throw new Error("Requires isolated disposable PostgreSQL");
  return db;
}

function originalClaim() {
  return { exportId, tenantId: tenant, installationId: installations[0], workerId: "artifact-worker", token };
}

beforeAll(async () => {
  if (!db) return;
  for (let index = 0; index < 2; index++) {
    await db.query(
      "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
      [installations[index], Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
    );
  }
  for (let i = 0; i < repositories.length; i++) {
    await db.query(
      "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,$5,'main')",
      [
        repositories[i],
        installations[i === 2 ? 1 : 0],
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
        tenant,
        `board-${i}`,
      ],
    );
    await db.query(
      "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
      [runs[i], repositories[i], "a".repeat(40)],
    );
    await db.query(
      "INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type) VALUES($1,$2,'manufacturing',$3,'package',$4,$5,$6,'application/zip')",
      [artifacts[i], runs[i], `package-${i}.zip`, `private-path-${i}`, "b".repeat(64), 512 + i],
    );
  }
  const prepared = await new DataExportPreparationStore(db).createBoundPendingExport({
    tenantId: tenant,
    installationId: installations[0],
    requestedBy: "operator",
    scope: "repository",
    scopeId: repositories[0],
  });
  if (!prepared) throw new Error("Expected installation-bound claim");
  exportId = prepared;
  const claimed = await new DataExportPreparationStore(db).claimNext({
    installationId: installations[0],
    workerId: "artifact-worker",
  });
  if (!claimed || claimed.exportId !== prepared) throw new Error("Expected original worker claim");
  token = claimed.token;
});

afterAll(async () => {
  if (!db) return;
  try {
    if (exportId) await db.query("DELETE FROM data_exports WHERE id=$1", [exportId]);
    await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [installations]);
  } finally {
    await db.close();
  }
});

describeDatabase("claimed artifact metadata PostgreSQL isolation", () => {
  it("includes only original repository artifacts and never exposes storage paths or bytes", async () => {
    const output = await prepareClaimedArtifactMetadataSnapshot(executor(), originalClaim());
    const data = JSON.parse(output?.bytes.toString("utf8") ?? "{}");
    expect(data.artifacts).toEqual([expect.objectContaining({ id: artifacts[0], runId: runs[0], byteLength: 512 })]);
    for (const forbidden of [artifacts[1], artifacts[2], "private-path-", "storagePath", "storage_path"]) {
      expect(output?.bytes.toString("utf8")).not.toContain(forbidden);
    }
    expect(
      await prepareClaimedArtifactMetadataSnapshot(executor(), { ...originalClaim(), token: "invalid" }),
    ).toBeNull();
    expect(
      await prepareClaimedArtifactMetadataSnapshot(executor(), {
        ...originalClaim(),
        installationId: installations[1],
      }),
    ).toBeNull();
    const current = await executor().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect((current as { rows: unknown[] }).rows[0]).toMatchObject({
      status: "running",
      download_url: null,
      completed_at: null,
    });
  });

  it("rejects suspended or disabled scopes and expired worker leases", async () => {
    await executor().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repositories[0]]);
    try {
      expect(await prepareClaimedArtifactMetadataSnapshot(executor(), originalClaim())).toBeNull();
    } finally {
      await executor().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositories[0]]);
    }
    await executor().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installations[0]]);
    try {
      expect(await prepareClaimedArtifactMetadataSnapshot(executor(), originalClaim())).toBeNull();
    } finally {
      await executor().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installations[0]]);
    }
    await executor().query("UPDATE data_exports SET preparation_lease_until=NOW()-interval '1 second' WHERE id=$1", [
      exportId,
    ]);
    expect(await prepareClaimedArtifactMetadataSnapshot(executor(), originalClaim())).toBeNull();
  });
});
