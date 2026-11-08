import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assessHistoricalUserUnlinkedSnapshot } from "../../packages/db/src/data-export-historical-unlinked-snapshot.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const databaseUrl = getPostgresTestConnectionString();
const suite = databaseUrl ? describe : describe.skip;
const db = databaseUrl ? createPgQueryExecutor({ connectionString: databaseUrl }) : null;
const tenant = `historical-unlinked-${randomUUID().slice(0, 8)}`;
const numericUserId = 8_712_340_555;
const installationId = randomUUID();
const exportId = randomUUID();
const secondExportId = randomUUID();
const holdId = randomUUID();
const externalInstallationId = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
const original = { exportId, verifiedGitHubUserId: numericUserId };

suite("disposable PostgreSQL: original USER no-FK count-only snapshot integrity", () => {
  afterAll(async () => {
    if (!db) return;
    try {
      await db.query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
      await db.query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [[exportId, secondExportId]]);
      await db.query("DELETE FROM installations WHERE id=$1", [installationId]);
    } finally {
      await db.close();
    }
  });

  it("binds all 26 candidate classes and three platform exclusions in one read-only PG snapshot", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [installationId, externalInstallationId, tenant, numericUserId],
    );
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
       VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
      [exportId, tenant, numericUserId],
    );
    const first = await assessHistoricalUserUnlinkedSnapshot(db, original);
    expect(first).toEqual({
      status: "unlinked-source-candidates-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      reviewedCandidateClasses: 26,
      excludedPlatformClasses: 3,
      countOnlySnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(await assessHistoricalUserUnlinkedSnapshot(db, original)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(tenant);
    expect(JSON.stringify(first)).not.toContain(exportId);
    expect(JSON.stringify(first)).not.toContain(String(numericUserId));
  });

  it("changes its internal count fingerprint on new original USER candidate without authorizing delivery", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    const before = await assessHistoricalUserUnlinkedSnapshot(db, original);
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
       VALUES($1,$2,'github_app_uninstall','completed','user',$2,$3)`,
      [secondExportId, tenant, numericUserId],
    );
    const after = await assessHistoricalUserUnlinkedSnapshot(db, original);
    expect(before?.countOnlySnapshotSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(after?.countOnlySnapshotSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(after?.countOnlySnapshotSha256).not.toBe(before?.countOnlySnapshotSha256);
    expect(after?.customerDeliveryAllowed).toBe(false);
  });

  it("denies other numeric USER, active hold and expired original export", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    expect(
      await assessHistoricalUserUnlinkedSnapshot(db, {
        ...original,
        verifiedGitHubUserId: numericUserId + 1,
      }),
    ).toBeNull();
    await db.query(
      `INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id,active)
       VALUES($1,$2,'test','Synthetic historical provenance hold','user',$2,TRUE)`,
      [holdId, tenant],
    );
    expect(await assessHistoricalUserUnlinkedSnapshot(db, original)).toBeNull();
    await db.query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    await db.query("UPDATE data_exports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [exportId]);
    expect(await assessHistoricalUserUnlinkedSnapshot(db, original)).toBeNull();
  });
});
