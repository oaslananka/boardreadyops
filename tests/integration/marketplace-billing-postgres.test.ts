import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadViewerRepositories } from "../../apps/web/lib/repository-dashboard.js";
import { loadViewerRuns } from "../../apps/web/lib/run-listing.js";
import { viewerInstallations } from "../../apps/web/lib/viewer-installations.js";
import { BillingStore } from "../../packages/db/src/billing-store.js";
import { createSqlControlPlaneJobStore } from "../../packages/db/src/control-plane-job-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const suffix = randomUUID().slice(0, 8);
const tenantId = `marketplace-${suffix}`;
const githubAccountId = 9_000_000 + Math.floor(Math.random() * 100_000);
const githubInstallationId = 8_000_000 + Math.floor(Math.random() * 100_000);
const installationId = randomUUID();
const repositoryId = randomUUID();
const apiTokenId = randomUUID();
const renamedApiTokenId = randomUUID();
const renameLegalHoldId = randomUUID();
const renamedTenantId = `${tenantId}-renamed`;
const reusedLoginInstallationId = githubInstallationId + 1_000_000;
const reusedLoginInternalId = randomUUID();
const reusedLoginRepositoryId = randomUUID();
const reusedLoginApiTokenId = randomUUID();
const userTenantId = `marketplace-user-${suffix}`;
const userGithubAccountId = githubAccountId + 2_000_000;
const userGithubInstallationId = githubInstallationId + 2_000_000;
const userInstallationId = randomUUID();
const userCurrentTenantId = `${userTenantId}-renamed`;
const userLegalHoldId = randomUUID();

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

afterAll(async () => {
  if (!executor) return;
  await database().query("DELETE FROM erasure_requests WHERE tenant_id = ANY($1::text[])", [
    [tenantId, renamedTenantId, userTenantId, userCurrentTenantId],
  ]);
  await database().query("DELETE FROM legal_holds WHERE id = ANY($1::text[])", [[renameLegalHoldId, userLegalHoldId]]);
  await database().query("DELETE FROM billing_events WHERE tenant_id=$1", [tenantId]);
  await database().query("DELETE FROM github_marketplace_subscriptions WHERE github_account_id = ANY($1::bigint[])", [
    [githubAccountId, userGithubAccountId],
  ]);
  await database().query("DELETE FROM billing_customers WHERE tenant_id=$1", [tenantId]);
  await database().query("DELETE FROM installations WHERE github_installation_id = ANY($1::bigint[])", [
    [githubInstallationId, reusedLoginInstallationId, userGithubInstallationId],
  ]);
  await executor.close();
});

describeDatabase("GitHub Marketplace billing PostgreSQL integration", () => {
  it("applies account state atomically without mutating Stripe or installation entitlements", async () => {
    await database().query(
      `INSERT INTO installations (id, github_installation_id, account_login, account_type, plan_tier)
       VALUES ($1,$2,$3,'Organization','business')`,
      [installationId, githubInstallationId, tenantId],
    );
    await database().query(
      `INSERT INTO billing_customers (id, tenant_id, stripe_customer_id, tier, status)
       VALUES ($1,$2,$3,'team','active')`,
      [randomUUID(), tenantId, `cus_${suffix}`],
    );
    await database().query(
      `INSERT INTO repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       VALUES ($1,$2,$3,$4,'board',FALSE,'main')`,
      [repositoryId, installationId, 7_000_000 + Math.floor(Math.random() * 100_000), tenantId],
    );
    await database().query(
      `INSERT INTO api_tokens (id, repository_id, name, token_prefix, token_hash, scopes, created_by)
       VALUES ($1,$2,'Marketplace integration token','bro_live_market',$3,ARRAY['runs:write'],'integration')`,
      [apiTokenId, repositoryId, "a".repeat(64)],
    );
    await database().query(
      `INSERT INTO release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at)
       VALUES ($1,$2,'abcdef1234567890','refs/heads/main','manual','completed',NOW())`,
      [randomUUID(), repositoryId],
    );

    const store = new BillingStore(database());
    const purchased = await store.processMarketplaceEvent({
      deliveryId: `marketplace-purchased-${suffix}`,
      action: "purchased",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-08-28T00:00:00.000Z",
      payload: { action: "purchased" },
    });

    expect(purchased).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: false });
    expect(
      rows(
        await database().query(
          `SELECT plan_tier, status, effective_at, last_delivery_id
             FROM github_marketplace_subscriptions
            WHERE github_account_id=$1`,
          [githubAccountId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        plan_tier: "free",
        status: "active",
        last_delivery_id: `marketplace-purchased-${suffix}`,
      }),
    ]);
    expect(
      rows(await database().query("SELECT tier, status FROM billing_customers WHERE tenant_id=$1", [tenantId])),
    ).toEqual([{ tier: "team", status: "active" }]);
    expect(
      rows(
        await database().query("SELECT plan_tier FROM installations WHERE github_installation_id=$1", [
          githubInstallationId,
        ]),
      ),
    ).toEqual([{ plan_tier: "business" }]);

    const session = {
      userId: 1,
      login: tenantId,
      installationIds: [githubInstallationId],
      issuedAt: "2026-08-28T00:00:00.000Z",
      expiresAt: "2026-08-29T00:00:00.000Z",
    };
    await expect(
      viewerInstallations(session, "nexar", { DATABASE_URL: connectionString as string }),
    ).resolves.toHaveLength(1);
    const activeRuns = await loadViewerRuns(session, {}, { DATABASE_URL: connectionString as string });
    expect(activeRuns.state).toBe("ok");
    if (activeRuns.state === "ok") expect(activeRuns.runs).toHaveLength(1);
    await expect(
      createSqlControlPlaneJobStore(database()).isMarketplaceAccountCanceled({
        installationExternalId: githubInstallationId,
        accountLogin: tenantId,
      }),
    ).resolves.toBe(false);
  });

  it("queues cancellation erasure and refuses a later-delivered stale purchase", async () => {
    const store = new BillingStore(database());
    const cancelled = await store.processMarketplaceEvent({
      deliveryId: `marketplace-cancelled-${suffix}`,
      action: "cancelled",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-08-30T00:00:00.000Z",
      payload: { action: "cancelled" },
    });
    expect(cancelled).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: true });

    const stale = await store.processMarketplaceEvent({
      deliveryId: `marketplace-stale-${suffix}`,
      action: "purchased",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-08-29T00:00:00.000Z",
      payload: { action: "purchased" },
    });
    expect(stale).toEqual({ outcome: "stale", stateChanged: false, erasureQueued: false });

    const duplicate = await store.processMarketplaceEvent({
      deliveryId: `marketplace-cancelled-${suffix}`,
      action: "cancelled",
      githubAccountId,
      accountLogin: tenantId,
      planTier: "free",
      effectiveDate: "2026-08-30T00:00:00.000Z",
      payload: { action: "cancelled" },
    });
    expect(duplicate).toEqual({ outcome: "duplicate", stateChanged: false, erasureQueued: false });

    expect(
      rows(
        await database().query(
          "SELECT status, effective_at FROM github_marketplace_subscriptions WHERE github_account_id=$1",
          [githubAccountId],
        ),
      ),
    ).toEqual([expect.objectContaining({ status: "canceled" })]);

    const erasures = rows(
      await database().query(
        `SELECT status, requested_by, due_at,
                EXTRACT(EPOCH FROM (due_at - TIMESTAMPTZ '2026-08-30T00:00:00.000Z'))::bigint AS due_seconds
           FROM erasure_requests
          WHERE tenant_id=$1 AND requested_by='github_marketplace'`,
        [tenantId],
      ),
    );
    expect(erasures).toEqual([
      expect.objectContaining({
        status: "pending",
        requested_by: "github_marketplace",
        due_at: expect.any(Date),
        due_seconds: "2592000",
      }),
    ]);

    expect(rows(await database().query("SELECT revoked_at FROM api_tokens WHERE id=$1", [apiTokenId]))).toEqual([
      { revoked_at: expect.any(Date) },
    ]);
    const session = {
      userId: 1,
      login: tenantId,
      installationIds: [githubInstallationId],
      issuedAt: "2026-08-30T00:00:00.000Z",
      expiresAt: "2026-08-31T00:00:00.000Z",
    };
    await expect(viewerInstallations(session, "nexar", { DATABASE_URL: connectionString as string })).resolves.toEqual(
      [],
    );
    const canceledRuns = await loadViewerRuns(session, {}, { DATABASE_URL: connectionString as string });
    expect(canceledRuns).toEqual({ state: "ok", runs: [], next: undefined });
    await expect(loadViewerRepositories(session, { DATABASE_URL: connectionString as string })).resolves.toEqual([]);
    await expect(
      createSqlControlPlaneJobStore(database()).isMarketplaceAccountCanceled({
        installationExternalId: githubInstallationId,
        accountLogin: tenantId,
      }),
    ).resolves.toBe(true);
  });

  it("keeps cancellation authoritative when a purchase has the same effective date", async () => {
    const store = new BillingStore(database());
    const equalTimestampPurchase = await store.processMarketplaceEvent({
      deliveryId: `marketplace-equal-purchase-${suffix}`,
      action: "purchased",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-08-30T00:00:00.000Z",
      payload: { action: "purchased" },
    });

    expect(equalTimestampPurchase).toEqual({ outcome: "stale", stateChanged: false, erasureQueued: false });
    expect(
      rows(
        await database().query(
          "SELECT status, last_delivery_id FROM github_marketplace_subscriptions WHERE github_account_id=$1",
          [githubAccountId],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        status: "canceled",
        last_delivery_id: `marketplace-cancelled-${suffix}`,
      }),
    ]);
  });

  it("enforces cancellation by stable installation id when the GitHub account login changed", async () => {
    const store = new BillingStore(database());
    const reactivated = await store.processMarketplaceEvent({
      deliveryId: `marketplace-reactivated-${suffix}`,
      action: "purchased",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-09-01T00:00:00.000Z",
      payload: { action: "purchased" },
    });
    expect(reactivated).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: false });

    await database().query(
      `INSERT INTO api_tokens (id, repository_id, name, token_prefix, token_hash, scopes, created_by)
       VALUES ($1,$2,'Renamed Marketplace token','bro_live_rename',$3,ARRAY['runs:write'],'integration')`,
      [renamedApiTokenId, repositoryId, "b".repeat(64)],
    );

    await database().query("DELETE FROM erasure_requests WHERE tenant_id = ANY($1::text[])", [
      [tenantId, renamedTenantId],
    ]);
    await database().query(
      `INSERT INTO legal_holds (id, tenant_id, created_by, reason, scope, active)
       VALUES ($1,$2,'integration','Marketplace rename cancellation hold','organization',TRUE)`,
      [renameLegalHoldId, tenantId],
    );

    const cancelledAfterRename = await store.processMarketplaceEvent({
      deliveryId: `marketplace-renamed-cancelled-${suffix}`,
      action: "cancelled",
      githubAccountId,
      accountLogin: renamedTenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-09-02T00:00:00.000Z",
      payload: { action: "cancelled" },
    });
    expect(cancelledAfterRename).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: true });

    expect(
      rows(
        await database().query(
          `SELECT tenant_id, status FROM erasure_requests
            WHERE requested_by='github_marketplace'
            ORDER BY created_at DESC
            LIMIT 1`,
        ),
      ),
    ).toEqual([{ tenant_id: tenantId, status: "blocked_by_hold" }]);

    expect(rows(await database().query("SELECT revoked_at FROM api_tokens WHERE id=$1", [renamedApiTokenId]))).toEqual([
      { revoked_at: expect.any(Date) },
    ]);

    const session = {
      userId: 1,
      login: tenantId,
      installationIds: [githubInstallationId],
      issuedAt: "2026-09-02T00:00:00.000Z",
      expiresAt: "2026-09-03T00:00:00.000Z",
    };
    await expect(viewerInstallations(session, "nexar", { DATABASE_URL: connectionString as string })).resolves.toEqual(
      [],
    );
    const canceledRuns = await loadViewerRuns(session, {}, { DATABASE_URL: connectionString as string });
    expect(canceledRuns).toEqual({ state: "ok", runs: [], next: undefined });
    await expect(loadViewerRepositories(session, { DATABASE_URL: connectionString as string })).resolves.toEqual([]);
    await expect(
      createSqlControlPlaneJobStore(database()).isMarketplaceAccountCanceled({
        installationExternalId: githubInstallationId,
        accountLogin: tenantId,
      }),
    ).resolves.toBe(true);
  });

  it("creates only one active erasure request for concurrent cancellation deliveries", async () => {
    await database().query("DELETE FROM legal_holds WHERE id = ANY($1::text[])", [
      [renameLegalHoldId, userLegalHoldId],
    ]);
    await database().query("DELETE FROM erasure_requests WHERE tenant_id = ANY($1::text[])", [
      [tenantId, renamedTenantId],
    ]);

    const reactivated = await new BillingStore(database()).processMarketplaceEvent({
      deliveryId: `marketplace-concurrency-reactivated-${suffix}`,
      action: "purchased",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-09-03T00:00:00.000Z",
      payload: { action: "purchased" },
    });
    expect(reactivated).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: false });

    const firstExecutor = createPgQueryExecutor({ connectionString: connectionString as string, max: 1 });
    const secondExecutor = createPgQueryExecutor({ connectionString: connectionString as string, max: 1 });
    try {
      const input = {
        action: "cancelled" as const,
        githubAccountId,
        accountLogin: tenantId,
        accountType: "Organization",
        githubInstallationId,
        planId: 101,
        planName: "Community",
        planTier: "free" as const,
        effectiveDate: "2026-09-04T00:00:00.000Z",
        payload: { action: "cancelled" },
      };
      const results = await Promise.all([
        new BillingStore(firstExecutor).processMarketplaceEvent({
          ...input,
          deliveryId: `marketplace-concurrent-a-${suffix}`,
        }),
        new BillingStore(secondExecutor).processMarketplaceEvent({
          ...input,
          deliveryId: `marketplace-concurrent-b-${suffix}`,
        }),
      ]);

      expect(results.filter((result) => result.erasureQueued)).toHaveLength(1);
      expect(
        rows(
          await database().query(
            `SELECT id FROM erasure_requests
              WHERE tenant_id=$1
                AND requested_by='github_marketplace'
                AND scope='organization'
                AND status IN ('pending','running','blocked_by_hold')`,
            [tenantId],
          ),
        ),
      ).toHaveLength(1);
    } finally {
      await Promise.all([firstExecutor.close(), secondExecutor.close()]);
    }
  });

  it("does not let a canceled account's stale login block a different stable installation", async () => {
    await database().query("UPDATE installations SET account_login=$2 WHERE github_installation_id=$1", [
      githubInstallationId,
      renamedTenantId,
    ]);
    await database().query(
      `INSERT INTO installations (id, github_installation_id, account_login, account_type, plan_tier)
       VALUES ($1,$2,$3,'Organization','free')`,
      [reusedLoginInternalId, reusedLoginInstallationId, tenantId],
    );
    await database().query(
      `INSERT INTO repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       VALUES ($1,$2,$3,$4,'reused-login-board',FALSE,'main')`,
      [reusedLoginRepositoryId, reusedLoginInternalId, 6_000_000 + Math.floor(Math.random() * 100_000), tenantId],
    );
    await database().query(
      `INSERT INTO release_runs (id, repository_id, commit_sha, ref, trigger_kind, status, started_at)
       VALUES ($1,$2,'1234567890abcdef','refs/heads/main','manual','completed',NOW())`,
      [randomUUID(), reusedLoginRepositoryId],
    );
    await database().query(
      `INSERT INTO api_tokens (id, repository_id, name, token_prefix, token_hash, scopes, created_by)
       VALUES ($1,$2,'Reused login token','bro_live_reused',$3,ARRAY['runs:write'],'integration')`,
      [reusedLoginApiTokenId, reusedLoginRepositoryId, "c".repeat(64)],
    );

    const repeatedCancellation = await new BillingStore(database()).processMarketplaceEvent({
      deliveryId: `marketplace-reused-login-cancelled-${suffix}`,
      action: "cancelled",
      githubAccountId,
      accountLogin: tenantId,
      accountType: "Organization",
      githubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-09-04T00:00:00.000Z",
      payload: { action: "cancelled" },
    });
    expect(repeatedCancellation).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: true });
    expect(
      rows(await database().query("SELECT revoked_at FROM api_tokens WHERE id=$1", [reusedLoginApiTokenId])),
    ).toEqual([{ revoked_at: null }]);

    const session = {
      userId: 2,
      login: tenantId,
      installationIds: [reusedLoginInstallationId],
      issuedAt: "2026-09-03T00:00:00.000Z",
      expiresAt: "2026-09-04T00:00:00.000Z",
    };

    await expect(
      viewerInstallations(session, "nexar", { DATABASE_URL: connectionString as string }),
    ).resolves.toHaveLength(1);
    const runs = await loadViewerRuns(session, {}, { DATABASE_URL: connectionString as string });
    expect(runs.state).toBe("ok");
    if (runs.state === "ok") expect(runs.runs).toHaveLength(1);
    await expect(loadViewerRepositories(session, { DATABASE_URL: connectionString as string })).resolves.toHaveLength(
      1,
    );

    await expect(
      createSqlControlPlaneJobStore(database()).isMarketplaceAccountCanceled({
        installationExternalId: reusedLoginInstallationId,
        accountLogin: tenantId,
      }),
    ).resolves.toBe(false);
  });
  it("uses the current user tenant for personal Marketplace erasure scope and legal holds after a rename", async () => {
    await database().query(
      `INSERT INTO installations (id, github_installation_id, account_login, account_type, plan_tier)
       VALUES ($1,$2,$3,'User','free')`,
      [userInstallationId, userGithubInstallationId, userCurrentTenantId],
    );
    await database().query(
      `INSERT INTO legal_holds (id, tenant_id, created_by, reason, scope, scope_id, active)
       VALUES ($1,$2,'integration','Personal Marketplace cancellation legal hold','user',$2,TRUE)`,
      [userLegalHoldId, userCurrentTenantId],
    );

    const cancelled = await new BillingStore(database()).processMarketplaceEvent({
      deliveryId: `marketplace-user-cancelled-${suffix}`,
      action: "cancelled",
      githubAccountId: userGithubAccountId,
      accountLogin: userTenantId,
      accountType: "User",
      githubInstallationId: userGithubInstallationId,
      planId: 101,
      planName: "Community",
      planTier: "free",
      effectiveDate: "2026-09-05T00:00:00.000Z",
      payload: { action: "cancelled" },
    });

    expect(cancelled).toEqual({ outcome: "applied", stateChanged: true, erasureQueued: true });
    expect(
      rows(
        await database().query(
          `SELECT scope, scope_id, status
             FROM erasure_requests
            WHERE tenant_id=$1 AND requested_by='github_marketplace'`,
          [userCurrentTenantId],
        ),
      ),
    ).toEqual([{ scope: "user", scope_id: userCurrentTenantId, status: "blocked_by_hold" }]);
  });
});
