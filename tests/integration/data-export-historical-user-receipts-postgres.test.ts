import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DataLifecycleStore } from "../../packages/db/src/data-lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const login = `postuninstall-${randomUUID().slice(0, 10)}`;
const originalGitHubId = 900_000_000 + Math.floor(Math.random() * 100_000);
const exportsToDelete: string[] = [];
const erasuresToDelete: string[] = [];
function db() {
  if (!executor) throw new Error("Disposable PostgreSQL required");
  return executor;
}
const store = () => new DataLifecycleStore(db());

async function insertExport(
  input: {
    actorId?: number | null;
    requestedBy?: string;
    scope?: "user" | "organization";
    scopeId?: string | null;
    minutesAgo?: number;
    status?: "pending" | "failed";
  } = {},
) {
  const id = randomUUID();
  exportsToDelete.push(id);
  await db().query(
    `INSERT INTO data_exports(
      id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id,created_at
    ) VALUES($1,$2,$3,$8,$4,$5,$6,NOW()-($7::integer * interval '1 minute'))`,
    [
      id,
      login,
      input.requestedBy ?? "github_app_uninstall",
      input.scope ?? "user",
      input.scopeId === undefined ? login : input.scopeId,
      input.actorId === undefined ? originalGitHubId : input.actorId,
      input.minutesAgo ?? 0,
      input.status ?? "pending",
    ],
  );
  return id;
}

afterAll(async () => {
  if (!executor) return;
  try {
    if (erasuresToDelete.length)
      await executor.query("DELETE FROM erasure_requests WHERE id = ANY($1::text[])", [erasuresToDelete]);
    if (exportsToDelete.length)
      await executor.query("DELETE FROM data_exports WHERE id = ANY($1::text[])", [exportsToDelete]);
  } finally {
    await executor.close();
  }
});

describeDatabase("original-GitHub-account post-uninstall history (isolated PostgreSQL)", () => {
  it("returns latest 10 requester-bound USER uninstall records with no cross-identity or scope leakage", async () => {
    const owned: string[] = [];
    for (let i = 0; i < 12; i++) {
      owned.push(await insertExport({ minutesAgo: 70 - i, status: i === 11 ? "pending" : "failed" }));
    }
    const otherGitHubId = await insertExport({ actorId: originalGitHubId + 1, status: "failed" });
    const legacyUnbound = await insertExport({ actorId: null, status: "failed" });
    const differentReason = await insertExport({ requestedBy: "operator" });
    const differentScope = await insertExport({ scope: "organization", scopeId: null, actorId: null });
    const invalidOwnerScope = await insertExport({ scopeId: `renamed-${login}`, actorId: null, status: "failed" });
    const receipts = await store().listVerifiedHistoricalUserExportReceipts({
      verifiedGitHubUserId: originalGitHubId,
    });
    expect(receipts).toHaveLength(10);
    expect(receipts.map((r) => r.exportId)).toEqual(owned.slice(-10).reverse());
    for (const invisible of [otherGitHubId, legacyUnbound, differentReason, differentScope, invalidOwnerScope])
      expect(receipts.map((r) => r.exportId)).not.toContain(invisible);
    for (const record of receipts) {
      expect(Object.keys(record).sort()).toEqual(["createdAt", "exportId", "status"]);
      expect(["pending", "failed"]).toContain(record.status);
    }
    expect(
      await store().listVerifiedHistoricalUserExportReceipts({
        verifiedGitHubUserId: originalGitHubId + 91,
      }),
    ).toEqual([]);
  });

  it("excludes completed real erasure but not dry-run history (same as single-request recovery)", async () => {
    const request = exportsToDelete[0];
    if (!request) throw new Error("missing owned historical fixture");
    const erasure = randomUUID();
    erasuresToDelete.push(erasure);
    await db().query(
      `INSERT INTO erasure_requests
         (id,tenant_id,requested_by,scope,scope_id,status,dry_run,completed_at)
         VALUES($1,$2,'github_app_uninstall','user',$2,'completed',TRUE,NOW())`,
      [erasure, login],
    );
    const current = await store().listVerifiedHistoricalUserExportReceipts({
      verifiedGitHubUserId: originalGitHubId,
    });
    expect(current.length).toBeGreaterThan(0);
    await db().query("UPDATE erasure_requests SET dry_run=FALSE WHERE id=$1", [erasure]);
    expect(
      await store().listVerifiedHistoricalUserExportReceipts({
        verifiedGitHubUserId: originalGitHubId,
      }),
    ).toEqual([]);
    expect(
      await store().getVerifiedHistoricalUserExport({
        exportId: request,
        verifiedGitHubUserId: originalGitHubId,
      }),
    ).toBeNull();
  });
});
