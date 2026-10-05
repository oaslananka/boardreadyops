import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type RetentionPolicy = {
  id: string;
  tenantId: string;
  tier: string;
  retentionDays: number | null;
  sourceRetentionHours: number;
};

export type RepositoryRetentionPolicy = {
  repositoryId: string;
  owner: string;
  name: string;
  hasOverride: boolean;
  retentionDays: number | null;
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
  releasedAt: string | null;
  releasedBy: string | null;
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

  async upsertRetentionPolicy(input: {
    tenantId: string;
    installationId: string;
    actorId: string;
    actorLogin: string;
    tier: string;
    retentionDays: number | null;
    sourceRetentionHours: number;
  }): Promise<RetentionPolicy> {
    if (
      input.retentionDays !== null &&
      (!Number.isSafeInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3_650)
    ) {
      throw new Error("retentionDays must be null or an integer between 1 and 3650");
    }
    if (!Number.isSafeInteger(input.sourceRetentionHours) || input.sourceRetentionHours < 1) {
      throw new Error("sourceRetentionHours must be a positive integer");
    }
    const id = randomUUID();
    const r = (await this.db.query(
      `WITH selected_installation AS MATERIALIZED (
         SELECT installations.id
           FROM installations
          WHERE installations.id = $6
            AND lower(installations.account_login) = lower($2)
       ), previous_policy AS MATERIALIZED (
         SELECT retention_policies.retention_days,
                retention_policies.source_retention_hours
           FROM retention_policies
          WHERE retention_policies.tenant_id = $2
            AND EXISTS (SELECT 1 FROM selected_installation)
       ), upserted AS (
         INSERT INTO retention_policies (
           id, tenant_id, tier, retention_days, source_retention_hours, created_at, updated_at
         )
         SELECT $1, $2, $3, $4, $5, NOW(), NOW()
           FROM selected_installation
         ON CONFLICT (tenant_id) DO UPDATE
           SET tier = EXCLUDED.tier,
               retention_days = EXCLUDED.retention_days,
               source_retention_hours = EXCLUDED.source_retention_hours,
               updated_at = NOW()
         RETURNING *
       ), audited AS (
         INSERT INTO audit_events (
           installation_id, event_type, actor_type, actor_id, actor_login,
           subject_type, subject_id, metadata, created_at
         )
         SELECT selected_installation.id,
                'retention.policy.updated',
                'user',
                $7,
                $8,
                'retention_policy',
                $2,
                jsonb_build_object(
                  'previousRetentionDays', (SELECT previous_policy.retention_days FROM previous_policy),
                  'retentionDays', upserted.retention_days,
                  'previousSourceRetentionHours',
                    (SELECT previous_policy.source_retention_hours FROM previous_policy),
                  'sourceRetentionHours', upserted.source_retention_hours
                ),
                NOW()
           FROM upserted
           CROSS JOIN selected_installation
       )
       SELECT upserted.* FROM upserted`,
      [
        id,
        input.tenantId,
        input.tier,
        input.retentionDays,
        input.sourceRetentionHours,
        input.installationId,
        input.actorId,
        input.actorLogin,
      ],
    )) as { rows?: Array<Record<string, unknown>> };
    const row = r.rows?.[0];
    if (!row) throw new Error("upsert failed");
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      tier: String(row.tier),
      retentionDays: row.retention_days === null ? null : Number(row.retention_days),
      sourceRetentionHours: Number(row.source_retention_hours),
    };
  }

  async listRepositoryRetentionPolicies(installationId: string): Promise<RepositoryRetentionPolicy[]> {
    const r = (await this.db.query(
      `SELECT repositories.id AS repository_id,
              repositories.owner,
              repositories.name,
              repository_retention_policies.repository_id IS NOT NULL AS has_override,
              repository_retention_policies.retention_days
         FROM repositories
         LEFT JOIN repository_retention_policies
           ON repository_retention_policies.repository_id = repositories.id
        WHERE repositories.installation_id = $1
          AND repositories.disabled_at IS NULL
        ORDER BY lower(repositories.owner), lower(repositories.name), repositories.id`,
      [installationId],
    )) as { rows?: Array<Record<string, unknown>> };

    return (r.rows ?? []).map((row) => ({
      repositoryId: String(row.repository_id),
      owner: String(row.owner),
      name: String(row.name),
      hasOverride: row.has_override === true,
      retentionDays:
        row.retention_days === null || row.retention_days === undefined ? null : Number(row.retention_days),
    }));
  }

  async upsertRepositoryRetentionPolicy(input: {
    installationId: string;
    repositoryId: string;
    retentionDays: number | null;
    actorId: string;
    actorLogin: string;
  }): Promise<RepositoryRetentionPolicy | null> {
    if (
      input.retentionDays !== null &&
      (!Number.isSafeInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3_650)
    ) {
      throw new Error("retentionDays must be null or an integer between 1 and 3650");
    }

    const r = (await this.db.query(
      `WITH selected_repository AS MATERIALIZED (
         SELECT repositories.id, repositories.owner, repositories.name
           FROM repositories
          WHERE repositories.id = $1
            AND repositories.installation_id = $2
            AND repositories.disabled_at IS NULL
       ), previous_policy AS MATERIALIZED (
         SELECT repository_retention_policies.retention_days
           FROM repository_retention_policies
           JOIN selected_repository
             ON selected_repository.id = repository_retention_policies.repository_id
       ), upserted AS (
         INSERT INTO repository_retention_policies (repository_id, retention_days, created_at, updated_at)
         SELECT selected_repository.id, $3, NOW(), NOW()
           FROM selected_repository
         ON CONFLICT (repository_id) DO UPDATE
           SET retention_days = EXCLUDED.retention_days,
               updated_at = NOW()
         RETURNING repository_id, retention_days
       ), audited AS (
         INSERT INTO audit_events (
           installation_id, event_type, actor_type, actor_id, actor_login,
           subject_type, subject_id, repository_id, metadata, created_at
         )
         SELECT $2,
                'retention.repository.override_set',
                'user',
                $4,
                $5,
                'repository',
                upserted.repository_id,
                upserted.repository_id,
                jsonb_build_object(
                  'previousOverride', EXISTS (SELECT 1 FROM previous_policy),
                  'previousRetentionDays', (SELECT previous_policy.retention_days FROM previous_policy),
                  'retentionDays', upserted.retention_days
                ),
                NOW()
           FROM upserted
       )
       SELECT upserted.repository_id,
              selected_repository.owner,
              selected_repository.name,
              upserted.retention_days
         FROM upserted
         JOIN selected_repository ON selected_repository.id = upserted.repository_id`,
      [input.repositoryId, input.installationId, input.retentionDays, input.actorId, input.actorLogin],
    )) as { rows?: Array<Record<string, unknown>> };

    const row = r.rows?.[0];
    if (!row) return null;

    return {
      repositoryId: String(row.repository_id),
      owner: String(row.owner),
      name: String(row.name),
      hasOverride: true,
      retentionDays: row.retention_days === null ? null : Number(row.retention_days),
    };
  }

  async clearRepositoryRetentionPolicy(input: {
    installationId: string;
    repositoryId: string;
    actorId: string;
    actorLogin: string;
  }): Promise<boolean> {
    const r = (await this.db.query(
      `WITH selected_repository AS MATERIALIZED (
         SELECT repositories.id
           FROM repositories
          WHERE repositories.id = $1
            AND repositories.installation_id = $2
            AND repositories.disabled_at IS NULL
       ), deleted AS (
         DELETE FROM repository_retention_policies
         USING selected_repository
         WHERE repository_retention_policies.repository_id = selected_repository.id
         RETURNING repository_retention_policies.repository_id,
                   repository_retention_policies.retention_days
       ), audited AS (
         INSERT INTO audit_events (
           installation_id, event_type, actor_type, actor_id, actor_login,
           subject_type, subject_id, repository_id, metadata, created_at
         )
         SELECT $2,
                'retention.repository.override_cleared',
                'user',
                $3,
                $4,
                'repository',
                deleted.repository_id,
                deleted.repository_id,
                jsonb_build_object('previousRetentionDays', deleted.retention_days),
                NOW()
           FROM deleted
       )
       SELECT deleted.repository_id FROM deleted`,
      [input.repositoryId, input.installationId, input.actorId, input.actorLogin],
    )) as { rows?: Array<Record<string, unknown>> };
    return (r.rows?.length ?? 0) > 0;
  }

  async listLegalHolds(tenantId: string): Promise<LegalHold[]> {
    const r = (await this.db.query(`SELECT * FROM legal_holds WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [
      tenantId,
    ])) as { rows?: Array<Record<string, unknown>> };
    return (r.rows ?? []).map((row) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      createdBy: String(row.created_by),
      reason: String(row.reason),
      scope: String(row.scope),
      scopeId: (row.scope_id as string | null) ?? null,
      active: Boolean(row.active),
      createdAt: new Date(row.created_at as string).toISOString(),
      releasedAt: row.released_at ? new Date(row.released_at as string).toISOString() : null,
      releasedBy: (row.released_by as string | null) ?? null,
    }));
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
    let status = "pending";
    if (blocked) status = "blocked_by_hold";
    else if (input.dryRun) status = "preview";
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
      releasedAt: null,
      releasedBy: null,
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
