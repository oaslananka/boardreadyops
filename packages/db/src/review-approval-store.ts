import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type ApprovalStatus = "approved" | "changes_requested" | "invalidated" | "dismissed";

export interface ReviewApprovalRecord {
  id: string;
  repositoryId: string;
  reviewId: string;
  revisionId: string;
  evidenceDigest: string;
  approverId: string;
  status: ApprovalStatus;
  reason: string | null;
  isBreakGlass: boolean;
  invalidatedAt: string | null;
  invalidatedBy: string | null;
  invalidationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordApprovalInput {
  repositoryId: string;
  reviewId: string;
  revisionId: string;
  evidenceDigest: string;
  approverId: string;
  status: ApprovalStatus;
  reason?: string | null | undefined;
  isBreakGlass?: boolean | undefined;
}

export interface ReviewChecklistItemRecord {
  id: string;
  repositoryId: string;
  reviewId: string;
  title: string;
  completed: boolean;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AddChecklistItemInput {
  repositoryId: string;
  reviewId: string;
  title: string;
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

export class ReviewApprovalStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async recordApproval(input: RecordApprovalInput): Promise<ReviewApprovalRecord> {
    const id = `rapp_${randomUUID()}`;
    const reason = input.reason ?? null;
    const isBreakGlass = input.isBreakGlass ?? false;

    const raw = await this.executor.query(
      `INSERT INTO review_approvals (
        id, repository_id, review_id, revision_id, evidence_digest,
        approver_id, status, reason, is_break_glass, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        revision_id AS "revisionId",
        evidence_digest AS "evidenceDigest",
        approver_id AS "approverId",
        status,
        reason,
        is_break_glass AS "isBreakGlass",
        invalidated_at AS "invalidatedAt",
        invalidated_by AS "invalidatedBy",
        invalidation_reason AS "invalidationReason",
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        id,
        input.repositoryId,
        input.reviewId,
        input.revisionId,
        input.evidenceDigest,
        input.approverId,
        input.status,
        reason,
        isBreakGlass,
      ],
    );

    const rows = extractRows<ReviewApprovalRecord>(raw);
    const record = rows[0];
    if (!record) {
      throw new Error("Failed to record approval");
    }
    return record;
  }

  async invalidateApprovalsOnDigestChange(
    reviewId: string,
    newEvidenceDigest: string,
    invalidatedBy = "system",
    invalidationReason = "Evidence digest changed on head commit",
  ): Promise<number> {
    const raw = await this.executor.query(
      `UPDATE review_approvals
      SET
        status = 'invalidated',
        invalidated_at = NOW(),
        invalidated_by = $3,
        invalidation_reason = $4,
        updated_at = NOW()
      WHERE review_id = $1
        AND evidence_digest != $2
        AND status = 'approved'
      RETURNING id`,
      [reviewId, newEvidenceDigest, invalidatedBy, invalidationReason],
    );

    const rows = extractRows<{ id: string }>(raw);
    return rows.length;
  }

  async listApprovalsForReview(reviewId: string): Promise<ReviewApprovalRecord[]> {
    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        revision_id AS "revisionId",
        evidence_digest AS "evidenceDigest",
        approver_id AS "approverId",
        status,
        reason,
        is_break_glass AS "isBreakGlass",
        invalidated_at AS "invalidatedAt",
        invalidated_by AS "invalidatedBy",
        invalidation_reason AS "invalidationReason",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM review_approvals
      WHERE review_id = $1
      ORDER BY created_at DESC`,
      [reviewId],
    );
    return extractRows<ReviewApprovalRecord>(raw);
  }

  async addChecklistItem(input: AddChecklistItemInput): Promise<ReviewChecklistItemRecord> {
    const id = `rchk_${randomUUID()}`;
    const raw = await this.executor.query(
      `INSERT INTO review_checklist_items (
        id, repository_id, review_id, title, completed, created_at
      ) VALUES ($1, $2, $3, $4, FALSE, NOW())
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        title,
        completed,
        completed_by AS "completedBy",
        completed_at AS "completedAt",
        created_at AS "createdAt"`,
      [id, input.repositoryId, input.reviewId, input.title],
    );

    const rows = extractRows<ReviewChecklistItemRecord>(raw);
    const record = rows[0];
    if (!record) {
      throw new Error("Failed to add checklist item");
    }
    return record;
  }

  async updateChecklistItem(
    id: string,
    completed: boolean,
    completedBy?: string | null | undefined,
  ): Promise<ReviewChecklistItemRecord | undefined> {
    const completedAt = completed ? new Date().toISOString() : null;
    const actor = completed ? (completedBy ?? null) : null;

    const raw = await this.executor.query(
      `UPDATE review_checklist_items
      SET
        completed = $2,
        completed_by = $3,
        completed_at = $4
      WHERE id = $1
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        title,
        completed,
        completed_by AS "completedBy",
        completed_at AS "completedAt",
        created_at AS "createdAt"`,
      [id, completed, actor, completedAt],
    );

    const rows = extractRows<ReviewChecklistItemRecord>(raw);
    return rows[0];
  }

  async listChecklistItems(reviewId: string): Promise<ReviewChecklistItemRecord[]> {
    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        title,
        completed,
        completed_by AS "completedBy",
        completed_at AS "completedAt",
        created_at AS "createdAt"
      FROM review_checklist_items
      WHERE review_id = $1
      ORDER BY created_at ASC`,
      [reviewId],
    );
    return extractRows<ReviewChecklistItemRecord>(raw);
  }
}
