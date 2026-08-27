import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type ReviewPolicyScope = "organization" | "team" | "repository";
export type ReviewPolicySeverityGate = "error" | "high" | "medium";

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

export class ReviewPolicyStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async createPolicy(input: CreateReviewPolicyInput): Promise<ReviewPolicyRecord> {
    const id = `rpol_${randomUUID()}`;
    const raw = await this.executor.query(
      `INSERT INTO review_policies (
        id, tenant_id, scope, scope_id, name, description,
        required_checklist, required_roles, severity_gate,
        require_evidence_pack, require_external_review, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, NOW(), NOW())
      RETURNING ${SELECT_COLUMNS}`,
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

  async updatePolicy(id: string, input: UpdateReviewPolicyInput): Promise<ReviewPolicyRecord | undefined> {
    const existing = await this.getPolicyById(id);
    if (!existing) {
      return undefined;
    }
    const next: ReviewPolicyRecord = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      requiredChecklist: input.requiredChecklist ?? existing.requiredChecklist,
      requiredRoles: input.requiredRoles ?? existing.requiredRoles,
      severityGate: input.severityGate !== undefined ? input.severityGate : existing.severityGate,
      requireEvidencePack: input.requireEvidencePack ?? existing.requireEvidencePack,
      requireExternalReview: input.requireExternalReview ?? existing.requireExternalReview,
    };
    const raw = await this.executor.query(
      `UPDATE review_policies
       SET name = $2, description = $3, required_checklist = $4::jsonb, required_roles = $5::jsonb,
           severity_gate = $6, require_evidence_pack = $7, require_external_review = $8, updated_at = NOW()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        next.name,
        next.description,
        JSON.stringify(next.requiredChecklist),
        JSON.stringify(next.requiredRoles),
        next.severityGate,
        next.requireEvidencePack,
        next.requireExternalReview,
      ],
    );
    return extractRows<ReviewPolicyRecord>(raw)[0];
  }

  async deletePolicy(id: string): Promise<boolean> {
    const raw = await this.executor.query(`DELETE FROM review_policies WHERE id = $1 RETURNING id`, [id]);
    return extractRows<{ id: string }>(raw).length > 0;
  }
}
