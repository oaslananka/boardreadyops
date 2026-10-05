import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type ReviewPolicyScope = "organization" | "team" | "repository";
export type ReviewPolicySeverityGate = "error" | "high" | "medium";
export type ReviewPolicyAuditAction = "create" | "update" | "delete";

export interface ReviewPolicyRecord {
  id: string;
  tenantId: string;
  scope: ReviewPolicyScope;
  scopeId: string | null;
  name: string;
  description: string | null;
  requiredChecklist: string[];
  requiredRoles: string[];
  severityGate: ReviewPolicySeverityGate | null;
  requireEvidencePack: boolean;
  requireExternalReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewPolicyMutationActor {
  githubUserId: number;
  login: string;
}

export interface ReviewPolicyAuditEventRecord {
  id: string;
  tenantId: string;
  policyId: string;
  action: ReviewPolicyAuditAction;
  scope: ReviewPolicyScope;
  scopeId: string | null;
  actorGithubUserId: string;
  actorLogin: string;
  beforePolicy: ReviewPolicyRecord | null;
  afterPolicy: ReviewPolicyRecord | null;
  createdAt: string;
}

export interface CreateReviewPolicyInput {
  tenantId: string;
  scope: ReviewPolicyScope;
  scopeId?: string | null | undefined;
  name: string;
  description?: string | null | undefined;
  requiredChecklist?: string[] | undefined;
  requiredRoles?: string[] | undefined;
  severityGate?: ReviewPolicySeverityGate | null | undefined;
  requireEvidencePack?: boolean | undefined;
  requireExternalReview?: boolean | undefined;
}

export interface UpdateReviewPolicyInput {
  name?: string | undefined;
  description?: string | null | undefined;
  requiredChecklist?: string[] | undefined;
  requiredRoles?: string[] | undefined;
  severityGate?: ReviewPolicySeverityGate | null | undefined;
  requireEvidencePack?: boolean | undefined;
  requireExternalReview?: boolean | undefined;
}

function extractRows<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  if (Array.isArray(result)) {
    return result as T[];
  }
  return [];
}

const SELECT_COLUMNS = `
  id,
  tenant_id AS "tenantId",
  scope,
  scope_id AS "scopeId",
  name,
  description,
  required_checklist AS "requiredChecklist",
  required_roles AS "requiredRoles",
  severity_gate AS "severityGate",
  require_evidence_pack AS "requireEvidencePack",
  require_external_review AS "requireExternalReview",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const AUDIT_SELECT_COLUMNS = `
  id,
  tenant_id AS "tenantId",
  policy_id AS "policyId",
  action,
  scope,
  scope_id AS "scopeId",
  actor_github_user_id::text AS "actorGithubUserId",
  actor_login AS "actorLogin",
  before_policy AS "beforePolicy",
  after_policy AS "afterPolicy",
  created_at AS "createdAt"`;

function policySnapshot(alias: string): string {
  return `jsonb_build_object(
    'id', ${alias}.id,
    'tenantId', ${alias}.tenant_id,
    'scope', ${alias}.scope,
    'scopeId', ${alias}.scope_id,
    'name', ${alias}.name,
    'description', ${alias}.description,
    'requiredChecklist', ${alias}.required_checklist,
    'requiredRoles', ${alias}.required_roles,
    'severityGate', ${alias}.severity_gate,
    'requireEvidencePack', ${alias}.require_evidence_pack,
    'requireExternalReview', ${alias}.require_external_review,
    'createdAt', ${alias}.created_at,
    'updatedAt', ${alias}.updated_at
  )`;
}

export class ReviewPolicyStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async createPolicy(input: CreateReviewPolicyInput, actor: ReviewPolicyMutationActor): Promise<ReviewPolicyRecord> {
    const id = `rpol_${randomUUID()}`;
    const raw = await this.executor.query(
      `WITH inserted AS (
         INSERT INTO review_policies (
           id, tenant_id, scope, scope_id, name, description,
           required_checklist, required_roles, severity_gate,
           require_evidence_pack, require_external_review, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, NOW(), NOW())
         RETURNING *
       ), audited AS (
         INSERT INTO review_policy_audit_events (
           id, tenant_id, policy_id, action, scope, scope_id,
           actor_github_user_id, actor_login, before_policy, after_policy, created_at
         )
         SELECT gen_random_uuid()::text, inserted.tenant_id, inserted.id, 'create',
                inserted.scope, inserted.scope_id, $12::bigint, $13::text,
                NULL, ${policySnapshot("inserted")}, NOW()
           FROM inserted
       )
       SELECT ${SELECT_COLUMNS}
         FROM inserted`,
      [
        id,
        input.tenantId,
        input.scope,
        input.scopeId ?? null,
        input.name,
        input.description ?? null,
        JSON.stringify(input.requiredChecklist ?? []),
        JSON.stringify(input.requiredRoles ?? []),
        input.severityGate ?? null,
        input.requireEvidencePack ?? false,
        input.requireExternalReview ?? false,
        actor.githubUserId,
        actor.login,
      ],
    );
    const rows = extractRows<ReviewPolicyRecord>(raw);
    const record = rows[0];
    if (!record) {
      throw new Error("Failed to create review policy");
    }
    return record;
  }

  async getPolicy(
    tenantId: string,
    scope: ReviewPolicyScope,
    scopeId: string | null,
  ): Promise<ReviewPolicyRecord | undefined> {
    const raw = await this.executor.query(
      `SELECT ${SELECT_COLUMNS}
       FROM review_policies
       WHERE tenant_id = $1 AND scope = $2 AND scope_id IS NOT DISTINCT FROM $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, scope, scopeId],
    );
    return extractRows<ReviewPolicyRecord>(raw)[0];
  }

  async listPolicies(tenantId: string): Promise<ReviewPolicyRecord[]> {
    const raw = await this.executor.query(
      `SELECT ${SELECT_COLUMNS}
       FROM review_policies
       WHERE tenant_id = $1
       ORDER BY scope ASC, created_at DESC`,
      [tenantId],
    );
    return extractRows<ReviewPolicyRecord>(raw);
  }

  async getPolicyById(id: string): Promise<ReviewPolicyRecord | undefined> {
    const raw = await this.executor.query(`SELECT ${SELECT_COLUMNS} FROM review_policies WHERE id = $1`, [id]);
    return extractRows<ReviewPolicyRecord>(raw)[0];
  }

  async updatePolicy(
    id: string,
    input: UpdateReviewPolicyInput,
    actor: ReviewPolicyMutationActor,
  ): Promise<ReviewPolicyRecord | undefined> {
    const raw = await this.executor.query(
      `WITH existing AS (
         SELECT *
           FROM review_policies
          WHERE id = $1
          FOR UPDATE
       ), updated AS (
         UPDATE review_policies AS policy
            SET name = CASE WHEN $2::boolean THEN $3::text ELSE existing.name END,
                description = CASE WHEN $4::boolean THEN $5::text ELSE existing.description END,
                required_checklist = CASE WHEN $6::boolean THEN $7::jsonb ELSE existing.required_checklist END,
                required_roles = CASE WHEN $8::boolean THEN $9::jsonb ELSE existing.required_roles END,
                severity_gate = CASE WHEN $10::boolean THEN $11::text ELSE existing.severity_gate END,
                require_evidence_pack = CASE WHEN $12::boolean THEN $13::boolean ELSE existing.require_evidence_pack END,
                require_external_review = CASE WHEN $14::boolean THEN $15::boolean ELSE existing.require_external_review END,
                updated_at = NOW()
           FROM existing
          WHERE policy.id = existing.id
         RETURNING policy.*
       ), audited AS (
         INSERT INTO review_policy_audit_events (
           id, tenant_id, policy_id, action, scope, scope_id,
           actor_github_user_id, actor_login, before_policy, after_policy, created_at
         )
         SELECT gen_random_uuid()::text, updated.tenant_id, updated.id, 'update',
                updated.scope, updated.scope_id, $16::bigint, $17::text,
                ${policySnapshot("existing")}, ${policySnapshot("updated")}, NOW()
           FROM existing
           JOIN updated ON updated.id = existing.id
       )
       SELECT ${SELECT_COLUMNS}
         FROM updated`,
      [
        id,
        input.name !== undefined,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.requiredChecklist !== undefined,
        JSON.stringify(input.requiredChecklist ?? []),
        input.requiredRoles !== undefined,
        JSON.stringify(input.requiredRoles ?? []),
        input.severityGate !== undefined,
        input.severityGate ?? null,
        input.requireEvidencePack !== undefined,
        input.requireEvidencePack ?? false,
        input.requireExternalReview !== undefined,
        input.requireExternalReview ?? false,
        actor.githubUserId,
        actor.login,
      ],
    );
    return extractRows<ReviewPolicyRecord>(raw)[0];
  }

  async deletePolicy(id: string, actor: ReviewPolicyMutationActor): Promise<boolean> {
    const raw = await this.executor.query(
      `WITH deleted AS (
         DELETE FROM review_policies
          WHERE id = $1
         RETURNING *
       ), audited AS (
         INSERT INTO review_policy_audit_events (
           id, tenant_id, policy_id, action, scope, scope_id,
           actor_github_user_id, actor_login, before_policy, after_policy, created_at
         )
         SELECT gen_random_uuid()::text, deleted.tenant_id, deleted.id, 'delete',
                deleted.scope, deleted.scope_id, $2::bigint, $3::text,
                ${policySnapshot("deleted")}, NULL, NOW()
           FROM deleted
       )
       SELECT id
         FROM deleted`,
      [id, actor.githubUserId, actor.login],
    );
    return extractRows<{ id: string }>(raw).length > 0;
  }

  async listAuditEvents(tenantId: string, policyId: string, limit = 100): Promise<ReviewPolicyAuditEventRecord[]> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 250));
    const raw = await this.executor.query(
      `SELECT ${AUDIT_SELECT_COLUMNS}
         FROM review_policy_audit_events
        WHERE tenant_id = $1
          AND policy_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [tenantId, policyId, boundedLimit],
    );
    return extractRows<ReviewPolicyAuditEventRecord>(raw);
  }
}
