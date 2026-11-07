import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assessHistoricalUserBillingOwnershipCandidates } from "../../packages/db/src/data-export-historical-billing-ownership-candidates.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const suite = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString }) : null;
const tenant = ["historical-billing-", randomUUID().slice(0, 8)].join("");
const otherTenant = ["historical-foreign-", randomUUID().slice(0, 8)].join("");
const renamed = ["previous-login-", randomUUID().slice(0, 8)].join("");
const originalNumeric = 8_040_113_992;
const foreignNumeric = originalNumeric + 1;
const exportId = randomUUID();
const installationId = randomUUID();
const foreignInstallationId = randomUUID();
const customerId = randomUUID();
const foreignCustomerId = randomUUID();
const subscriptionId = randomUUID();
const activityId = randomUUID();
const billingEventId = randomUUID();
const foreignBillingEventId = randomUUID();
const unboundBillingEventId = randomUUID();
const marketplaceDeliveryId = randomUUID();
const foreignMarketplaceDeliveryId = randomUUID();
const authority = { exportId, verifiedGitHubUserId: originalNumeric };
const gitInstallation = () => Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);

suite("disposable PostgreSQL: five billing sources have distinct numeric USER and reused login identities", () => {
  afterAll(async () => {
    if (!db) return;
    try {
      await db.query("DELETE FROM erasure_requests WHERE tenant_id=$1", [tenant]);
      await db.query("DELETE FROM legal_holds WHERE tenant_id=$1", [tenant]);
      await db.query("DELETE FROM billing_subscriptions WHERE tenant_id=$1", [tenant]);
      await db.query("DELETE FROM billing_activity WHERE tenant_id=$1", [tenant]);
      await db.query("DELETE FROM billing_events WHERE tenant_id IN ($1,$2) OR id=$3", [
        tenant,
        otherTenant,
        unboundBillingEventId,
      ]);
      await db.query("DELETE FROM billing_customers WHERE tenant_id IN ($1,$2)", [tenant, otherTenant]);
      await db.query("DELETE FROM github_marketplace_subscriptions WHERE github_account_id IN ($1,$2)", [
        originalNumeric,
        foreignNumeric,
      ]);
      await db.query("DELETE FROM data_exports WHERE id=$1", [exportId]);
      await db.query("DELETE FROM installations WHERE id=ANY($1::text[])", [[installationId, foreignInstallationId]]);
    } finally {
      await db.close();
    }
  });

  it("separates four username-only billing classes from one exact Marketplace numeric account", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [installationId, gitInstallation(), tenant, originalNumeric],
    );
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
       VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
      [exportId, tenant, originalNumeric],
    );
    await db.query(
      `INSERT INTO billing_customers(id,tenant_id,tier,status)
       VALUES($1,$2,'free','trialing'),($3,$4,'free','trialing')`,
      [customerId, tenant, foreignCustomerId, otherTenant],
    );
    await db.query(
      `INSERT INTO billing_subscriptions(
         id,tenant_id,stripe_subscription_id,stripe_price_id,tier,interval,status,quantity,
         current_period_start,current_period_end
       ) VALUES($1,$2,$3,'synthetic-price','free','month','trialing',1,NOW(),NOW()+INTERVAL '30 days')`,
      [subscriptionId, tenant, ["sub_", randomUUID()].join("")],
    );
    await db.query(
      `INSERT INTO billing_events(id,stripe_event_id,tenant_id,type,payload)
       VALUES($1,$2,$3,'test.billing', '{"synthetic":true}'::jsonb),
             ($4,$5,$6,'test.foreign','{}'::jsonb),
             ($7,$8,NULL,'test.unbound','{}'::jsonb)`,
      [
        billingEventId,
        randomUUID(),
        tenant,
        foreignBillingEventId,
        randomUUID(),
        otherTenant,
        unboundBillingEventId,
        randomUUID(),
      ],
    );
    await db.query(
      `INSERT INTO billing_activity(id,tenant_id,actor_id,actor_type,action)
       VALUES($1,$2,'synthetic-actor','internal','policy_update')`,
      [activityId, tenant],
    );
    await db.query(
      `INSERT INTO github_marketplace_subscriptions(
         github_account_id,account_login,account_type,plan_tier,status,effective_at,last_delivery_id
       ) VALUES($1,$2,'User','free','canceled',NOW(),$3),
               ($4,$5,'User','free','canceled',NOW(),$6)`,
      [originalNumeric, renamed, marketplaceDeliveryId, foreignNumeric, tenant, foreignMarketplaceDeliveryId],
    );
    expect(await assessHistoricalUserBillingOwnershipCandidates(db, authority)).toEqual({
      status: "billing-provider-and-login-candidates-unapproved",
      releaseDecision: "NO_GO",
      reviewedUnlinkedClasses: 5,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      providerDisclosureRightsVerified: false,
      customerFinancialDataDisclosureVerified: false,
      billingEventsWithoutTenantUnresolved: true,
      competingOrUnboundInstallationIdentity: false,
      exactNumericMarketplaceAccountCount: 1,
      marketplaceSameLoginDifferentNumericAccounts: 1,
      exactNumericMarketplaceLoginChanged: true,
      loginOnlyBillingCandidateCounts: {
        customers: 1,
        subscriptions: 1,
        eventsWithTenant: 1,
        activity: 1,
      },
    });
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [foreignInstallationId, gitInstallation(), tenant, foreignNumeric],
    );
    expect(await assessHistoricalUserBillingOwnershipCandidates(db, authority)).toMatchObject({
      competingOrUnboundInstallationIdentity: true,
      exactNumericMarketplaceAccountCount: 1,
      marketplaceSameLoginDifferentNumericAccounts: 1,
      customerDeliveryAllowed: false,
    });
    expect(
      await assessHistoricalUserBillingOwnershipCandidates(db, {
        exportId,
        verifiedGitHubUserId: foreignNumeric,
      }),
    ).toBeNull();
  });

  it("refuses active legal hold and running non-dry-run erasure before querying billing candidates", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    const holdId = randomUUID();
    const erasureId = randomUUID();
    try {
      await db.query(
        `INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id,active)
         VALUES($1,$2,'synthetic','Private provider contract hold','user',$2,TRUE)`,
        [holdId, tenant],
      );
      expect(await assessHistoricalUserBillingOwnershipCandidates(db, authority)).toBeNull();
      await db.query("UPDATE legal_holds SET active=FALSE WHERE id=$1", [holdId]);
      await db.query(
        `INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run)
         VALUES($1,$2,'synthetic','user',$2,'running',FALSE)`,
        [erasureId, tenant],
      );
      expect(await assessHistoricalUserBillingOwnershipCandidates(db, authority)).toBeNull();
      await db.query("UPDATE erasure_requests SET status='preview',dry_run=TRUE WHERE id=$1", [erasureId]);
      expect(await assessHistoricalUserBillingOwnershipCandidates(db, authority)).toMatchObject({
        originalUserOwnershipVerified: false,
        customerDeliveryAllowed: false,
      });
    } finally {
      await db.query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
      await db.query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
  });

  it("fails closed when 101 tenant billing events make the bounded review incomplete", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO billing_events(id,stripe_event_id,tenant_id,type,payload)
       SELECT gen_random_uuid()::text,gen_random_uuid()::text,$1,'synthetic.overflow','{}'::jsonb
         FROM generate_series(1,100)`,
      [tenant],
    );
    expect(await assessHistoricalUserBillingOwnershipCandidates(db, authority)).toBeNull();
  });
});
