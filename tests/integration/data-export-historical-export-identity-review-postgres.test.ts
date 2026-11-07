import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assessHistoricalUserExportIdentityReview } from "../../packages/db/src/data-export-historical-export-identity-review.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describePg = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString }) : null;
const tenant = ["historical-review-", randomUUID().slice(0, 8)].join("");
const alias = ["previous-", randomUUID().slice(0, 8)].join("");
const originalNumericId = 8_314_159_265;
const foreignNumericId = 7_271_828_182;
const originalInstallationId = randomUUID();
const foreignInstallationId = randomUUID();
const targetExportId = randomUUID();
const legacyId = randomUUID();
const foreignId = randomUUID();
const sameOwnerHistoricalId = randomUUID();
const sameOwnerAliasId = randomUUID();
const organizationId = randomUUID();
const candidateIds = [targetExportId, sameOwnerHistoricalId, sameOwnerAliasId, legacyId, foreignId, organizationId];
const externalInstallationIds = [
  Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
  Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
];

async function insertExport(
  id: string,
  login: string,
  status: "pending" | "completed" | "failed",
  scope: "user" | "organization",
  originalId: number | null,
  requestedBy = "github_app_uninstall",
) {
  if (!db) throw new Error("Disposable PostgreSQL is required");
  await db.query(
    `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, login, requestedBy, status, scope, scope === "user" ? login : null, originalId],
  );
}

describePg("disposable PostgreSQL: original USER export owner ID vs recycled login and legacy records", () => {
  afterAll(async () => {
    if (!db) return;
    try {
      await db.query("DELETE FROM legal_holds WHERE tenant_id=$1", [tenant]);
      await db.query("DELETE FROM erasure_requests WHERE tenant_id=$1", [tenant]);
      await db.query("DELETE FROM data_exports WHERE id=ANY($1::text[])", [candidateIds]);
      await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [
        [originalInstallationId, foreignInstallationId],
      ]);
    } finally {
      await db.close();
    }
  });

  it("separates numeric identity, changed alias, unbound legacy and other USER records", async () => {
    if (!db) throw new Error("Disposable PostgreSQL is required");
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW()),($5,$6,$3,'User',$7,NOW())`,
      [
        originalInstallationId,
        externalInstallationIds[0],
        tenant,
        originalNumericId,
        foreignInstallationId,
        externalInstallationIds[1],
        foreignNumericId,
      ],
    );
    await insertExport(targetExportId, tenant, "pending", "user", originalNumericId);
    await insertExport(sameOwnerHistoricalId, tenant, "completed", "user", originalNumericId);
    await insertExport(sameOwnerAliasId, alias, "failed", "user", originalNumericId);
    await insertExport(legacyId, tenant, "completed", "user", null);
    await insertExport(foreignId, tenant, "failed", "user", foreignNumericId);
    await insertExport(organizationId, tenant, "failed", "organization", null, "manual");

    const authority = { exportId: targetExportId, verifiedGitHubUserId: originalNumericId };
    const review = await assessHistoricalUserExportIdentityReview(db, authority);
    expect(review).toEqual({
      status: "historical-export-identity-review-only",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      attributedSameLoginCount: 2,
      sameNumericIdOtherLoginCount: 1,
      legacyLoginOnlyCount: 1,
      foreignNumericIdSameLoginCount: 1,
      otherSameLoginCount: 1,
      candidateCount: 6,
      independentOwnershipComplete: false,
    });

    expect(
      await assessHistoricalUserExportIdentityReview(db, {
        exportId: legacyId,
        verifiedGitHubUserId: originalNumericId,
      }),
    ).toBeNull();
    expect(
      await assessHistoricalUserExportIdentityReview(db, {
        exportId: foreignId,
        verifiedGitHubUserId: originalNumericId,
      }),
    ).toBeNull();
    expect(
      await assessHistoricalUserExportIdentityReview(db, {
        exportId: targetExportId,
        verifiedGitHubUserId: foreignNumericId,
      }),
    ).toBeNull();

    await db.query(
      `INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id,active)
       VALUES($1,$2,'test','Original account legal hold','user',$2,TRUE)`,
      [randomUUID(), tenant],
    );
    expect(await assessHistoricalUserExportIdentityReview(db, authority)).toBeNull();
    await db.query("DELETE FROM legal_holds WHERE tenant_id=$1", [tenant]);

    await db.query(
      `INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run)
       VALUES($1,$2,'test','user',$2,'running',FALSE)`,
      [randomUUID(), tenant],
    );
    expect(await assessHistoricalUserExportIdentityReview(db, authority)).toBeNull();
  });
});
