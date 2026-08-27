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

function mapCustomer(row: StoredBillingCustomerRow): BillingCustomer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stripeCustomerId: row.stripe_customer_id,
    tier: row.tier as BillingCustomer["tier"],
    status: row.status as BillingCustomer["status"],
    trialEndsAt: row.trial_ends_at
      ? typeof row.trial_ends_at === "string"
        ? row.trial_ends_at
        : row.trial_ends_at.toISOString()
      : null,
    graceEndsAt: row.grace_ends_at
      ? typeof row.grace_ends_at === "string"
        ? row.grace_ends_at
        : row.grace_ends_at.toISOString()
      : null,
    currentPeriodEnd: row.current_period_end
      ? typeof row.current_period_end === "string"
        ? row.current_period_end
        : row.current_period_end.toISOString()
      : null,
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
        stripeEventId: String((row as unknown as Record<string, unknown>).stripe_event_id),
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
