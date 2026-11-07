import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assessHistoricalUserTenantOnlyLifecycleCandidates } from "../../packages/db/src/data-export-historical-tenant-lifecycle-candidates.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const databaseUrl = getPostgresTestConnectionString();
const suite = databaseUrl ? describe : describe.skip;
const db = databaseUrl ? createPgQueryExecutor({ connectionString: databaseUrl }) : null;
const tenant = ["historical-tenant-scope-", randomUUID().slice(0, 12)].join("");
const foreignTenant = ["other-tenant-", randomUUID().slice(0, 12)].join("");
const originalUser = 8_001_543_210;
const otherUser = originalUser + 1;
const exportId = randomUUID();
const originalInstallation = randomUUID();
const otherInstallation = randomUUID();
const retentionId = randomUUID();
const otherRetentionId = randomUUID();
const holdId = randomUUID();
const otherHoldId = randomUUID();
const erasureId = randomUUID();
const otherErasureId = randomUUID();
const productId = randomUUID();
const otherProductId = randomUUID();
const externalInstallation = () => Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
const identity = { exportId, verifiedGitHubUserId: originalUser };

suite("disposable PostgreSQL: four tenant-login classes are never immutable USER owner proof", () => {
  afterAll(async () => {
    if (!db) return;
    try {
      await db.query("DELETE FROM product_events WHERE tenant_id IN ($1,$2)", [tenant, foreignTenant]);
      await db.query("DELETE FROM legal_holds WHERE id=ANY($1::text[])", [[holdId, otherHoldId]]);
      await db.query("DELETE FROM erasure_requests WHERE id=ANY($1::text[])", [[erasureId, otherErasureId]]);
      await db.query("DELETE FROM retention_policies WHERE id=ANY($1::text[])", [[retentionId, otherRetentionId]]);
      await db.query("DELETE FROM data_exports WHERE id=$1", [exportId]);
      await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [[originalInstallation, otherInstallation]]);
    } finally {
      await db.close();
    }
  });

  it("counts only four same-login classes, never reads row contents and never grants disclosure", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
      VALUES($1,$2,$3,'User',$4,NOW())`,
      [originalInstallation, externalInstallation(), tenant, originalUser],
    );
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
      VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
      [exportId, tenant, originalUser],
    );
    await db.query(`INSERT INTO retention_policies(id,tenant_id,tier) VALUES($1,$2,'free'),($3,$4,'free')`, [
      retentionId,
      tenant,
      otherRetentionId,
      foreignTenant,
    ]);
    await db.query(
      `INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id,active)
      VALUES($1,$2,'internal-private-actor','Private design legal hold','user',$2,FALSE),
            ($3,$4,'foreign-actor','Other design legal hold','user',$4,FALSE)`,
      [holdId, tenant, otherHoldId, foreignTenant],
    );
    await db.query(
      `INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run)
      VALUES($1,$2,'github_app_uninstall','user',$2,'preview',TRUE),
            ($3,$4,'external','user',$4,'preview',TRUE)`,
      [erasureId, tenant, otherErasureId, foreignTenant],
    );
    await db.query(
      `INSERT INTO product_events(id,event_name,tenant_id,actor_class)
      VALUES($1,'local_run_succeeded',$2,'system'),
            ($3,'local_run_succeeded',$4,'system')`,
      [productId, tenant, otherProductId, foreignTenant],
    );

    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(db, identity)).toEqual({
      status: "tenant-login-lifecycle-candidates-unattributable",
      releaseDecision: "NO_GO",
      reviewedUnlinkedClasses: 4,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tenantLoginAloneProvesNothing: true,
      competingOrUnboundInstallationIdentity: false,
      loginOnlyCandidateCounts: {
        retentionPolicies: 1,
        legalHolds: 1,
        erasureRequests: 1,
        productEvents: 1,
      },
    });

    // A second suspended numeric GitHub USER can own the *same* login.
    // Structural tenant string is NOT a safe attribution to the original USER.
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
      VALUES($1,$2,$3,'User',$4,NOW())`,
      [otherInstallation, externalInstallation(), tenant, otherUser],
    );
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(db, identity)).toMatchObject({
      competingOrUnboundInstallationIdentity: true,
      originalUserOwnershipVerified: false,
      customerDeliveryAllowed: false,
      loginOnlyCandidateCounts: {
        retentionPolicies: 1,
        legalHolds: 1,
        erasureRequests: 1,
        productEvents: 1,
      },
    });
    expect(
      await assessHistoricalUserTenantOnlyLifecycleCandidates(db, {
        exportId,
        verifiedGitHubUserId: otherUser,
      }),
    ).toBeNull();
  });

  it("disallows active legal hold and active destructive erasure before source counts", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query("UPDATE legal_holds SET active=TRUE WHERE id=$1", [holdId]);
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(db, identity)).toBeNull();
    await db.query("UPDATE legal_holds SET active=FALSE WHERE id=$1", [holdId]);

    await db.query("UPDATE erasure_requests SET status='running',dry_run=FALSE WHERE id=$1", [erasureId]);
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(db, identity)).toBeNull();
    await db.query("UPDATE erasure_requests SET status='preview',dry_run=TRUE WHERE id=$1", [erasureId]);
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(db, identity)).toMatchObject({
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
    });
  });
  it("denies a tenant with more than 100 candidate events instead of silently truncating", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO product_events(id,event_name,tenant_id,actor_class)
       SELECT gen_random_uuid()::text, 'local_run_succeeded',$1,'system'
         FROM generate_series(1,100)`,
      [tenant],
    );
    expect(await assessHistoricalUserTenantOnlyLifecycleCandidates(db, identity)).toBeNull();
  });
});
