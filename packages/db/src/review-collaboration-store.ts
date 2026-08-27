import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export interface FindingAssignmentRecord {
  id: string;
  repositoryId: string;
  reviewId: string;
  findingFingerprint: string;
  assignee: string;
  assignedBy: string;
  createdAt: string;
}

export interface AssignFindingInput {
  repositoryId: string;
  reviewId: string;
  findingFingerprint: string;
  assignee: string;
  assignedBy: string;
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

export class ReviewCollaborationStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async assignFinding(input: AssignFindingInput): Promise<FindingAssignmentRecord> {
    const id = `fasn_${randomUUID()}`;
    const raw = await this.executor.query(
      `INSERT INTO finding_assignments (
        id, repository_id, review_id, finding_fingerprint, assignee, assigned_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (review_id, finding_fingerprint, assignee)
      DO UPDATE SET assigned_by = EXCLUDED.assigned_by, created_at = NOW()
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        assignee,
        assigned_by AS "assignedBy",
        created_at AS "createdAt"`,
      [id, input.repositoryId, input.reviewId, input.findingFingerprint, input.assignee, input.assignedBy],
    );

    const rows = extractRows<FindingAssignmentRecord>(raw);
    const record = rows[0];
    if (!record) {
      throw new Error("Failed to assign finding");
    }
    return record;
  }

  async unassignFinding(reviewId: string, findingFingerprint: string, assignee: string): Promise<boolean> {
    const raw = await this.executor.query(
      `DELETE FROM finding_assignments
      WHERE review_id = $1 AND finding_fingerprint = $2 AND assignee = $3
      RETURNING id`,
      [reviewId, findingFingerprint, assignee],
    );
    const rows = extractRows<{ id: string }>(raw);
    return rows.length > 0;
  }

  async listAssignmentsForReview(reviewId: string): Promise<FindingAssignmentRecord[]> {
    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        assignee,
        assigned_by AS "assignedBy",
        created_at AS "createdAt"
      FROM finding_assignments
      WHERE review_id = $1
      ORDER BY created_at ASC`,
      [reviewId],
    );
    return extractRows<FindingAssignmentRecord>(raw);
  }

  async getAssignmentsGroupedByFinding(reviewId: string): Promise<Map<string, string[]>> {
    const rows = await this.listAssignmentsForReview(reviewId);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const existing = map.get(row.findingFingerprint) ?? [];
      existing.push(row.assignee);
      map.set(row.findingFingerprint, existing);
    }
    return map;
  }

  async getAssignmentsForAssignee(assignee: string, repositoryId?: string): Promise<FindingAssignmentRecord[]> {
    if (repositoryId) {
      const raw = await this.executor.query(
        `SELECT
          id,
          repository_id AS "repositoryId",
          review_id AS "reviewId",
          finding_fingerprint AS "findingFingerprint",
          assignee,
          assigned_by AS "assignedBy",
          created_at AS "createdAt"
        FROM finding_assignments
        WHERE assignee = $1 AND repository_id = $2
        ORDER BY created_at DESC`,
        [assignee, repositoryId],
      );
      return extractRows<FindingAssignmentRecord>(raw);
    }

    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        assignee,
        assigned_by AS "assignedBy",
        created_at AS "createdAt"
      FROM finding_assignments
      WHERE assignee = $1
      ORDER BY created_at DESC`,
      [assignee],
    );
    return extractRows<FindingAssignmentRecord>(raw);
  }
}
