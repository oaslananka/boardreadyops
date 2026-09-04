import { randomUUID } from "node:crypto";
import type { BillingActivity, BillingCustomer, BillingEvent, BillingSubscription } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type StoredBillingCustomerRow = {
  id: string;
  tenant_id: string;
  stripe_customer_id: string | null;
  tier: string;
  status: string;
  trial_ends_at: string | Date | null;
  grace_ends_at: string | Date | null;
  current_period_end: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function toIsoStringOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function mapCustomer(row: StoredBillingCustomerRow): BillingCustomer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stripeCustomerId: row.stripe_customer_id,
    tier: row.tier as BillingCustomer["tier"],
    status: row.status as BillingCustomer["status"],
    trialEndsAt: toIsoStringOrNull(row.trial_ends_at),
    graceEndsAt: toIsoStringOrNull(row.grace_ends_at),
    currentPeriodEnd: toIsoStringOrNull(row.current_period_end),
    createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(),
  };
}

export class BillingStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async getCustomer(tenantId: string): Promise<BillingCustomer | null> {
    const r = (await this.db.query(`SELECT * FROM billing_customers WHERE tenant_id=$1 LIMIT 1`, [tenantId])) as {
      rows?: StoredBillingCustomerRow[];
    };
    const row = r.rows?.[0];
    return row ? mapCustomer(row) : null;
  }

  async upsertCustomer(input: {
    tenantId: string;
    tier: string;
    status?: string;
    stripeCustomerId?: string | null;
  }): Promise<BillingCustomer> {
    const id = randomUUID();
    const q = `
      INSERT INTO billing_customers (id, tenant_id, stripe_customer_id, tier, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET tier=EXCLUDED.tier, stripe_customer_id=COALESCE(EXCLUDED.stripe_customer_id, billing_customers.stripe_customer_id), status=EXCLUDED.status, updated_at=NOW()
      RETURNING *
    `;
    const r = (await this.db.query(q, [
      id,
      input.tenantId,
      input.stripeCustomerId ?? null,
      input.tier,
      input.status ?? "active",
    ])) as { rows?: StoredBillingCustomerRow[] };
    const row = r.rows?.[0];
    if (!row) throw new Error("upsert failed");
    return mapCustomer(row);
  }

  /**
   * Links a Stripe customer id to this repo's tenant id.
   *
   * `checkout.session.completed` is the only handled Stripe event that carries both, via
   * `client_reference_id` (tenant id) and `customer` (Stripe customer id) -- every later
   * `customer.subscription.*` / `invoice.*` event only carries the Stripe customer id, so this
   * is the sole place the mapping is established. Deliberately leaves tier/status untouched
   * when the row already exists: checkout completion does not by itself say which price was
   * selected, so it must not clobber a tier that a subscription event already set.
   */
  async linkStripeCustomer(input: { tenantId: string; stripeCustomerId: string }): Promise<BillingCustomer> {
    const id = randomUUID();
    const q = `
      INSERT INTO billing_customers (id, tenant_id, stripe_customer_id, tier, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'free', 'incomplete', NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        updated_at = NOW()
      RETURNING *
    `;
    const r = (await this.db.query(q, [id, input.tenantId, input.stripeCustomerId])) as {
      rows?: StoredBillingCustomerRow[];
    };
    const row = r.rows?.[0];
    if (!row) throw new Error("linkStripeCustomer upsert failed");
    return mapCustomer(row);
  }

  /** The tenant a Stripe customer id was linked to via `linkStripeCustomer`, if any. */
  async resolveTenantIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
    const r = (await this.db.query(`SELECT tenant_id FROM billing_customers WHERE stripe_customer_id=$1 LIMIT 1`, [
      stripeCustomerId,
    ])) as { rows?: Array<{ tenant_id: string }> };
    return r.rows?.[0]?.tenant_id ?? null;
  }

  /**
   * Projects a `customer.subscription.created|updated|deleted` event onto `billing_customers`
   * and `billing_subscriptions`, and mirrors the resulting tier onto `installations.plan_tier`
   * -- the same column the GitHub Marketplace path writes, so a repository's entitlement check
   * (`entitlement-store.ts`) does not need to know which billing provider is active.
   *
   * Guarded against out-of-order delivery: `stripe_subscription_id` is the upsert conflict
   * target, and the write only applies when the incoming Stripe event's own `created` timestamp
   * is at least as new as the last event already applied to that subscription. A tenant that
   * has not yet been linked via `linkStripeCustomer` (i.e. `checkout.session.completed` has not
   * been processed yet) yields `applied: false` rather than throwing -- the projection is
   * deferred, not lost, since the underlying event is already durably recorded by `recordEvent`.
   */
  async applyStripeSubscriptionEvent(input: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripePriceId: string;
    tier: string;
    interval: string;
    status: string;
    customerStatus: string;
    quantity: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    trialEndsAt: string | null;
    eventCreatedAt: string;
  }): Promise<{ tenantId: string | null; applied: boolean }> {
    const q = `
      WITH target_customer AS (
        SELECT tenant_id FROM billing_customers WHERE stripe_customer_id = $1
      ),
      upserted_subscription AS (
        INSERT INTO billing_subscriptions (
          id, tenant_id, stripe_subscription_id, stripe_price_id, tier, interval, status,
          quantity, current_period_start, current_period_end, cancel_at_period_end,
          last_event_created_at, created_at, updated_at
        )
        SELECT $2, target_customer.tenant_id, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12::timestamptz, NOW(), NOW()
        FROM target_customer
        ON CONFLICT (stripe_subscription_id) DO UPDATE SET
          stripe_price_id = EXCLUDED.stripe_price_id,
          tier = EXCLUDED.tier,
          interval = EXCLUDED.interval,
          status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          last_event_created_at = EXCLUDED.last_event_created_at,
          updated_at = NOW()
        WHERE billing_subscriptions.last_event_created_at IS NULL
           OR EXCLUDED.last_event_created_at >= billing_subscriptions.last_event_created_at
        RETURNING tenant_id
      ),
      updated_customer AS (
        UPDATE billing_customers
        SET tier = $5, status = $13, trial_ends_at = $14::timestamptz, current_period_end = $10::timestamptz, updated_at = NOW()
        WHERE tenant_id IN (SELECT tenant_id FROM upserted_subscription)
        RETURNING tenant_id
      ),
      updated_installation AS (
        UPDATE installations SET plan_tier = $5
        WHERE account_login IN (SELECT tenant_id FROM updated_customer)
        RETURNING id
      )
      SELECT
        (SELECT tenant_id FROM target_customer) AS tenant_id,
        EXISTS (SELECT 1 FROM upserted_subscription) AS applied
    `;
    const r = (await this.db.query(q, [
      input.stripeCustomerId,
      randomUUID(),
      input.stripeSubscriptionId,
      input.stripePriceId,
      input.tier,
      input.interval,
      input.status,
      input.quantity,
      input.currentPeriodStart,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd,
      input.eventCreatedAt,
      input.customerStatus,
      input.trialEndsAt,
    ])) as { rows?: Array<{ tenant_id: string | null; applied: boolean }> };
    const row = r.rows?.[0];
    return { tenantId: row?.tenant_id ?? null, applied: row?.applied ?? false };
  }

  /** Reverses `applyGraceOnPaymentFailure` once an `invoice.paid` event clears the grace period. */
  async clearGraceOnPaymentSuccess(tenantId: string): Promise<void> {
    await this.db.query(
      `UPDATE billing_customers SET status='active', grace_ends_at=NULL, updated_at=NOW() WHERE tenant_id=$1 AND status='past_due'`,
      [tenantId],
    );
  }

  async recordEvent(input: {
    stripeEventId: string;
    type: string;
    tenantId?: string | null;
    payload: unknown;
  }): Promise<{ inserted: boolean; event: BillingEvent | null }> {
    const q = `
      INSERT INTO billing_events (id, stripe_event_id, tenant_id, type, payload, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING *
    `;
    const r = (await this.db.query(q, [
      randomUUID(),
      input.stripeEventId,
      input.tenantId ?? null,
      input.type,
      JSON.stringify(input.payload),
    ])) as { rows?: Array<Record<string, unknown>> };
    if (!r.rows || r.rows.length === 0) return { inserted: false, event: null };
    const row = r.rows[0] as unknown as BillingEvent & {
      stripe_event_id: string;
      tenant_id: string | null;
      processed_at: string | null;
      created_at: string;
    };
    return {
      inserted: true,
      event: {
        id: String(row.id),
        provider: "stripe",
        stripeEventId: String((row as unknown as Record<string, unknown>).stripe_event_id),
        deliveryId: null,
        tenantId: (row as unknown as Record<string, unknown>).tenant_id as string | null,
        type: String(row.type),
        payload: row.payload,
        processedAt: (row as unknown as Record<string, unknown>).processed_at as string | null,
        createdAt: String((row as unknown as Record<string, unknown>).created_at),
      },
    };
  }

  async markEventProcessed(stripeEventId: string): Promise<void> {
    await this.db.query(`UPDATE billing_events SET processed_at=NOW() WHERE stripe_event_id=$1`, [stripeEventId]);
  }

  async recordMarketplaceEvent(input: {
    deliveryId: string;
    action: string;
    tenantId?: string | null;
    payload: unknown;
  }): Promise<{ inserted: boolean; event: BillingEvent | null }> {
    const q = `
      INSERT INTO billing_events (id, provider, delivery_id, tenant_id, type, payload, created_at)
      VALUES ($1, 'github_marketplace', $2, $3, $4, $5, NOW())
      ON CONFLICT (delivery_id) WHERE delivery_id IS NOT NULL DO NOTHING
      RETURNING *
    `;
    const r = (await this.db.query(q, [
      randomUUID(),
      input.deliveryId,
      input.tenantId ?? null,
      `marketplace_purchase.${input.action}`,
      JSON.stringify(input.payload),
    ])) as { rows?: Array<Record<string, unknown>> };
    if (!r.rows || r.rows.length === 0) return { inserted: false, event: null };
    const row = r.rows[0] as unknown as Record<string, unknown>;
    return {
      inserted: true,
      event: {
        id: String(row.id),
        provider: "github_marketplace",
        stripeEventId: null,
        deliveryId: String(row.delivery_id),
        tenantId: (row.tenant_id as string | null) ?? null,
        type: String(row.type),
        payload: row.payload,
        processedAt: (row.processed_at as string | null) ?? null,
        createdAt: String(row.created_at),
      },
    };
  }

  async markMarketplaceEventProcessed(deliveryId: string): Promise<void> {
    await this.db.query(`UPDATE billing_events SET processed_at=NOW() WHERE delivery_id=$1`, [deliveryId]);
  }

  async applyMarketplacePurchase(input: {
    tenantId: string;
    tier: string;
    status?: string | undefined;
    effectiveDate?: string | null | undefined;
  }): Promise<BillingCustomer> {
    const id = randomUUID();
    const status = input.status ?? "active";
    const q = `
      INSERT INTO billing_customers (id, tenant_id, tier, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *
    `;
    const r = (await this.db.query(q, [id, input.tenantId, input.tier, status])) as {
      rows?: StoredBillingCustomerRow[];
    };
    const row = r.rows?.[0];
    if (!row) throw new Error("applyMarketplacePurchase customer upsert failed");

    await this.db.query(`UPDATE installations SET plan_tier = $1 WHERE account_login = $2`, [
      input.tier,
      input.tenantId,
    ]);

    return mapCustomer(row);
  }

  async applyMarketplaceCancellation(input: {
    tenantId: string;
    effectiveDate?: string | null | undefined;
  }): Promise<BillingCustomer | null> {
    const q = `
      UPDATE billing_customers
      SET tier = 'free', status = 'canceled', updated_at = NOW()
      WHERE tenant_id = $1
      RETURNING *
    `;
    const r = (await this.db.query(q, [input.tenantId])) as {
      rows?: StoredBillingCustomerRow[];
    };
    await this.db.query(`UPDATE installations SET plan_tier = 'free' WHERE account_login = $1`, [input.tenantId]);
    const row = r.rows?.[0];
    return row ? mapCustomer(row) : null;
  }

  async processMarketplaceEvent(input: {
    deliveryId: string;
    action: string;
    githubAccountId: number;
    accountLogin: string;
    accountType?: string | null;
    githubInstallationId?: number | null;
    planId?: number | null;
    planName?: string | null;
    planTier: "free";
    effectiveDate: string;
    payload: unknown;
  }): Promise<{
    outcome: "applied" | "duplicate" | "recorded" | "stale";
    stateChanged: boolean;
    erasureQueued: boolean;
  }> {
    const stateful = input.action === "purchased" || input.action === "cancelled";
    const canceled = input.action === "cancelled";
    const status = canceled ? "canceled" : "active";
    const erasureScope = input.accountType?.toLowerCase() === "user" ? "user" : "organization";
    const q = `
      WITH inserted_event AS (
        INSERT INTO billing_events (id, provider, delivery_id, tenant_id, type, payload, created_at)
        VALUES ($1, 'github_marketplace', $2, $3, $4, $5::jsonb, NOW())
        ON CONFLICT (delivery_id) WHERE delivery_id IS NOT NULL DO NOTHING
        RETURNING id
      ),
      upserted_state AS (
        INSERT INTO github_marketplace_subscriptions (
          github_account_id, account_login, account_type, github_installation_id,
          plan_id, plan_name, plan_tier, status, effective_at, last_delivery_id,
          created_at, updated_at
        )
        SELECT $6, $3, $7, $8, $9, $10, $11, $12, $13::timestamptz, $2, NOW(), NOW()
        FROM inserted_event
        WHERE $14::boolean
        ON CONFLICT (github_account_id) DO UPDATE SET
          account_login = EXCLUDED.account_login,
          account_type = EXCLUDED.account_type,
          github_installation_id = COALESCE(EXCLUDED.github_installation_id, github_marketplace_subscriptions.github_installation_id),
          plan_id = EXCLUDED.plan_id,
          plan_name = EXCLUDED.plan_name,
          plan_tier = EXCLUDED.plan_tier,
          status = EXCLUDED.status,
          effective_at = EXCLUDED.effective_at,
          last_delivery_id = EXCLUDED.last_delivery_id,
          updated_at = NOW()
        WHERE EXCLUDED.effective_at > github_marketplace_subscriptions.effective_at
           OR (
             EXCLUDED.effective_at = github_marketplace_subscriptions.effective_at
             AND (
               EXCLUDED.status = github_marketplace_subscriptions.status
               OR EXCLUDED.status = 'canceled'
             )
           )
        RETURNING github_account_id, account_login, github_installation_id
      ),
      resolved_erasure_tenant AS (
        SELECT COALESCE(
          (
            SELECT installations.account_login
              FROM installations
             WHERE upserted_state.github_installation_id IS NOT NULL
               AND installations.github_installation_id = upserted_state.github_installation_id
             LIMIT 1
          ),
          upserted_state.account_login
        ) AS tenant_id
        FROM upserted_state
      ),
      queued_erasure AS (
        INSERT INTO erasure_requests (
          id, tenant_id, requested_by, scope, scope_id, status, dry_run, created_at, due_at
        )
        SELECT
          gen_random_uuid()::text,
          (SELECT tenant_id FROM resolved_erasure_tenant),
          'github_marketplace',
          $16::text,
          CASE
            WHEN $16::text = 'user' THEN (SELECT tenant_id FROM resolved_erasure_tenant)
            ELSE NULL
          END,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM legal_holds
              WHERE tenant_id = (SELECT tenant_id FROM resolved_erasure_tenant)
                AND active = TRUE
                AND (
                  scope = 'organization'
                  OR (
                    scope = $16::text
                    AND (
                      scope_id = CASE
                        WHEN $16::text = 'user' THEN (SELECT tenant_id FROM resolved_erasure_tenant)
                        ELSE NULL
                      END
                      OR scope_id IS NULL
                    )
                  )
                )
            ) THEN 'blocked_by_hold'
            ELSE 'pending'
          END,
          FALSE,
          NOW(),
          $13::timestamptz + INTERVAL '30 days'
        FROM upserted_state
        WHERE $15::boolean
          AND NOT EXISTS (
            SELECT 1 FROM erasure_requests
            WHERE tenant_id = (SELECT tenant_id FROM resolved_erasure_tenant)
              AND requested_by = 'github_marketplace'
              AND scope = $16::text
              AND status IN ('pending', 'running', 'blocked_by_hold')
          )
        ON CONFLICT (tenant_id, scope)
          WHERE requested_by = 'github_marketplace'
            AND scope IN ('organization', 'user')
            AND status IN ('pending', 'running', 'blocked_by_hold')
        DO NOTHING
        RETURNING id
      ),
      revoked_tokens AS (
        UPDATE api_tokens
        SET revoked_at = NOW()
        WHERE revoked_at IS NULL
          AND $15::boolean
          AND EXISTS (SELECT 1 FROM upserted_state)
          AND repository_id IN (
            SELECT repositories.id
              FROM repositories
              JOIN installations ON installations.id = repositories.installation_id
             WHERE installations.github_installation_id = (SELECT github_installation_id FROM upserted_state)
                OR (
                  (SELECT github_installation_id FROM upserted_state) IS NULL
                  AND lower(installations.account_login) = lower((SELECT account_login FROM upserted_state))
                )
          )
        RETURNING id
      ),
      marked_event AS (
        UPDATE billing_events
        SET processed_at = NOW()
        WHERE delivery_id = $2
          AND EXISTS (SELECT 1 FROM inserted_event)
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM inserted_event) AS inserted,
        EXISTS (SELECT 1 FROM upserted_state) AS state_changed,
        ($14::boolean
          AND EXISTS (SELECT 1 FROM inserted_event)
          AND NOT EXISTS (SELECT 1 FROM upserted_state)) AS stale,
        EXISTS (SELECT 1 FROM queued_erasure) AS erasure_queued
    `;
    const r = (await this.db.query(q, [
      randomUUID(),
      input.deliveryId,
      input.accountLogin,
      `marketplace_purchase.${input.action}`,
      JSON.stringify(input.payload),
      input.githubAccountId,
      input.accountType ?? null,
      input.githubInstallationId ?? null,
      input.planId ?? null,
      input.planName ?? null,
      input.planTier,
      status,
      input.effectiveDate,
      stateful,
      canceled,
      erasureScope,
    ])) as {
      rows?: Array<{
        inserted: boolean;
        state_changed: boolean;
        stale: boolean;
        erasure_queued: boolean;
      }>;
    };
    const row = r.rows?.[0];
    if (!row) throw new Error("Marketplace event processing returned no result");
    if (!row.inserted) return { outcome: "duplicate", stateChanged: false, erasureQueued: false };
    if (row.stale) return { outcome: "stale", stateChanged: false, erasureQueued: false };
    if (stateful) {
      return { outcome: "applied", stateChanged: row.state_changed, erasureQueued: row.erasure_queued };
    }
    return { outcome: "recorded", stateChanged: false, erasureQueued: false };
  }

  async recordActivity(input: {
    tenantId: string;
    actorId: string;
    actorType: "internal" | "guest" | "system";
    action: BillingActivity["action"];
  }): Promise<void> {
    // Idempotent per actor per minute to avoid double counting on retries
    const q = `
      INSERT INTO billing_activity (id, tenant_id, actor_id, actor_type, action, created_at)
      SELECT $1,$2,$3,$4,$5,NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_activity WHERE tenant_id=$2 AND actor_id=$3 AND action=$5 AND created_at > NOW() - INTERVAL '1 minute'
      )
    `;
    await this.db.query(q, [randomUUID(), input.tenantId, input.actorId, input.actorType, input.action]);
  }

  async countActiveContributors(tenantId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const q = `
      SELECT COUNT(DISTINCT actor_id) as cnt FROM billing_activity
      WHERE tenant_id=$1 AND actor_type='internal' AND action IN ('policy_update','disposition','release_create','workspace_manage')
      AND created_at >= $2 AND created_at < $3
    `;
    const r = (await this.db.query(q, [tenantId, periodStart.toISOString(), periodEnd.toISOString()])) as {
      rows?: Array<{ cnt: string | number }>;
    };
    const cnt = r.rows?.[0]?.cnt;
    return typeof cnt === "string" ? Number.parseInt(cnt, 10) : Number(cnt ?? 0);
  }

  async forecastContributors(tenantId: string): Promise<{ current: number; forecast: number }> {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const current = await this.countActiveContributors(tenantId, startOfMonth, endOfMonth);
    // Forecast = current + 20% buffer capped, for display only
    const forecast = Math.max(current, Math.ceil(current * 1.2));
    return { current, forecast };
  }

  async startTrialIfNeeded(tenantId: string): Promise<BillingCustomer | null> {
    const customer = await this.getCustomer(tenantId);
    if (!customer) return null;
    if (customer.trialEndsAt || customer.tier !== "free") return customer;
    // Check if second distinct internal actor exists
    const q = `SELECT COUNT(DISTINCT actor_id) as cnt FROM billing_activity WHERE tenant_id=$1 AND actor_type='internal' AND created_at > NOW() - INTERVAL '30 days'`;
    const r = (await this.db.query(q, [tenantId])) as { rows?: Array<{ cnt: string | number }> };
    const cnt = Number(r.rows?.[0]?.cnt ?? 0);
    if (cnt >= 2) {
      const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await this.db.query(
        `UPDATE billing_customers SET status='trialing', trial_ends_at=$2, updated_at=NOW() WHERE tenant_id=$1`,
        [tenantId, trialEnds],
      );
      return this.getCustomer(tenantId);
    }
    return customer;
  }

  async applyGraceOnPaymentFailure(tenantId: string): Promise<void> {
    const graceEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await this.db.query(
      `UPDATE billing_customers SET status='past_due', grace_ends_at=$2, updated_at=NOW() WHERE tenant_id=$1`,
      [tenantId, graceEnds],
    );
  }

  async getSubscription(tenantId: string): Promise<BillingSubscription | null> {
    const r = (await this.db.query(
      `SELECT * FROM billing_subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    )) as { rows?: Array<Record<string, unknown>> };
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      stripeSubscriptionId: String(row.stripe_subscription_id),
      stripePriceId: String(row.stripe_price_id),
      tier: String(row.tier) as BillingSubscription["tier"],
      interval: String(row.interval) as BillingSubscription["interval"],
      status: String(row.status),
      quantity: Number(row.quantity),
      currentPeriodStart: new Date(row.current_period_start as string).toISOString(),
      currentPeriodEnd: new Date(row.current_period_end as string).toISOString(),
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(),
    };
  }
}
