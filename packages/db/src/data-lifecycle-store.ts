import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type RetentionPolicy = {
  id: string;
  tenantId: string;
  tier: string;
  retentionDays: number | null;
  sourceRetentionHours: number;
};

export type DataExport = {
  id: string;
  tenantId: string;
  requestedBy: string;
  status: "pending" | "running" | "completed" | "failed";
  scope: string;
  scopeId: string | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type ErasureRequest = {
  id: string;
  tenantId: string;
  requestedBy: string;
  scope: string;
  scopeId: string | null;
  status: string;
  dryRun: boolean;
  createdAt: string;
};

export type LegalHold = {
  id: string;
  tenantId: string;
  createdBy: string;
  reason: string;
  scope: string;
  scopeId: string | null;
  active: boolean;
  createdAt: string;
};

export class DataLifecycleStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async getRetentionPolicy(tenantId: string): Promise<RetentionPolicy | null> {
    const r = (await this.db.query(`SELECT * FROM retention_policies WHERE tenant_id=$1 LIMIT 1`, [tenantId])) as {
      rows?: Array<Record<string, unknown>>;
    };
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      tier: String(row.tier),
      retentionDays: row.retention_days === null ? null : Number(row.retention_days),
      sourceRetentionHours: Number(row.source_retention_hours),
    };
  }

  async createExport(input: {
    tenantId: string;
    requestedBy: string;
    scope: string;
    scopeId?: string | null;
  }): Promise<DataExport> {
    const id = randomUUID();
    const r = (await this.db.query(
      `INSERT INTO data_exports (id, tenant_id, requested_by, status, scope, scope_id, created_at) VALUES ($1,$2,$3,'pending',$4,$5,NOW()) RETURNING *`,
      [id, input.tenantId, input.requestedBy, input.scope, input.scopeId ?? null],
    )) as { rows?: Array<Record<string, unknown>> };
    const row = r.rows?.[0];
    if (!row) throw new Error("insert failed");
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      requestedBy: String(row.requested_by),
      status: String(row.status) as DataExport["status"],
      scope: String(row.scope),
      scopeId: (row.scope_id as string | null) ?? null,
      downloadUrl: (row.download_url as string | null) ?? null,
      expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async getExport(tenantId: string, exportId: string): Promise<DataExport | null> {
    const r = (await this.db.query(`SELECT * FROM data_exports WHERE id=$1 AND tenant_id=$2 LIMIT 1`, [
      exportId,
      tenantId,
    ])) as { rows?: Array<Record<string, unknown>> };
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      requestedBy: String(row.requested_by),
      status: String(row.status) as DataExport["status"],
      scope: String(row.scope),
      scopeId: (row.scope_id as string | null) ?? null,
      downloadUrl: (row.download_url as string | null) ?? null,
      expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async createErasure(input: {
    tenantId: string;
    requestedBy: string;
    scope: string;
    scopeId?: string | null;
    dryRun?: boolean;
  }): Promise<ErasureRequest> {
    // Block if active legal hold exists for same scope
    const holdCheck = (await this.db.query(
      `SELECT id FROM legal_holds WHERE tenant_id=$1 AND active=TRUE AND (scope='organization' OR (scope=$2 AND (scope_id=$3 OR scope_id IS NULL))) LIMIT 1`,
      [input.tenantId, input.scope, input.scopeId ?? null],
    )) as { rows?: Array<Record<string, unknown>> };
    const blocked = (holdCheck.rows?.length ?? 0) > 0;
    const status = blocked ? "blocked_by_hold" : input.dryRun ? "preview" : "pending";
    const id = randomUUID();
    const r = (await this.db.query(
      `INSERT INTO erasure_requests (id, tenant_id, requested_by, scope, scope_id, status, dry_run, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [id, input.tenantId, input.requestedBy, input.scope, input.scopeId ?? null, status, Boolean(input.dryRun)],
    )) as { rows?: Array<Record<string, unknown>> };
    const row = r.rows?.[0];
    if (!row) throw new Error("insert failed");
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      requestedBy: String(row.requested_by),
      scope: String(row.scope),
      scopeId: (row.scope_id as string | null) ?? null,
      status: String(row.status),
      dryRun: Boolean(row.dry_run),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async createLegalHold(input: {
    tenantId: string;
    createdBy: string;
    reason: string;
    scope: string;
    scopeId?: string | null;
  }): Promise<LegalHold> {
    if (input.reason.trim().length < 10) throw new Error("Legal hold reason must be at least 10 characters");
    const id = randomUUID();
    const r = (await this.db.query(
      `INSERT INTO legal_holds (id, tenant_id, created_by, reason, scope, scope_id, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW()) RETURNING *`,
      [id, input.tenantId, input.createdBy, input.reason.trim(), input.scope, input.scopeId ?? null],
    )) as { rows?: Array<Record<string, unknown>> };
    const row = r.rows?.[0];
    if (!row) throw new Error("insert failed");
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      createdBy: String(row.created_by),
      reason: String(row.reason),
      scope: String(row.scope),
      scopeId: (row.scope_id as string | null) ?? null,
      active: Boolean(row.active),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  async releaseLegalHold(tenantId: string, holdId: string, releasedBy: string): Promise<boolean> {
    const r = (await this.db.query(
      `UPDATE legal_holds SET active=FALSE, released_at=NOW(), released_by=$3 WHERE id=$1 AND tenant_id=$2 AND active=TRUE`,
      [holdId, tenantId, releasedBy],
    )) as { rowCount?: number };
    return (r.rowCount ?? 0) > 0;
  }

  async hasActiveHold(tenantId: string, scope: string, scopeId?: string | null): Promise<boolean> {
    const r = (await this.db.query(
      `SELECT 1 FROM legal_holds WHERE tenant_id=$1 AND active=TRUE AND (scope='organization' OR (scope=$2 AND (scope_id=$3 OR scope_id IS NULL))) LIMIT 1`,
      [tenantId, scope, scopeId ?? null],
    )) as { rows?: unknown[] };
    return (r.rows?.length ?? 0) > 0;
  }

  async recordProductEvent(input: {
    eventName: string;
    tenantId: string;
    repositoryId?: string | null;
    reviewId?: string | null;
    actorClass: string;
  }): Promise<void> {
    // Content-free: never store PII, finding message, comment body, source path
    const allowed = new Set([
      "local_run_succeeded",
      "cloud_review_created",
      "review_second_user_acted",
      "finding_dispositioned",
      "review_approved",
      "review_changes_requested",
      "evidence_pack_created",
      "external_review_opened",
      "trial_started",
      "subscription_activated",
      "subscription_downgraded",
      "data_export_completed",
    ]);
    if (!allowed.has(input.eventName)) throw new Error(`Unknown product event ${input.eventName}`);
    await this.db.query(
      `INSERT INTO product_events (id, event_name, tenant_id, repository_id, review_id, actor_class, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [
        randomUUID(),
        input.eventName,
        input.tenantId,
        input.repositoryId ?? null,
        input.reviewId ?? null,
        input.actorClass,
      ],
    );
  }
}
