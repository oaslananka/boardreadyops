import { randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type CommentAuthorType = "internal" | "guest";
export type CommentStatus = "open" | "resolved" | "stale";

export interface ReviewCommentRecord {
  id: string;
  repositoryId: string;
  reviewId: string;
  parentId: string | null;
  findingFingerprint: string | null;
  evidenceAnchor: string | null;
  authorId: string;
  authorType: CommentAuthorType;
  content: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  repositoryId: string;
  reviewId: string;
  parentId?: string | null | undefined;
  findingFingerprint?: string | null | undefined;
  evidenceAnchor?: string | null | undefined;
  authorId: string;
  authorType?: CommentAuthorType | undefined;
  content: string;
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

export class ReviewCommentStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async createComment(input: CreateCommentInput): Promise<ReviewCommentRecord> {
    const id = `rcmt_${randomUUID()}`;
    const parentId = input.parentId ?? null;
    const findingFingerprint = input.findingFingerprint ?? null;
    const evidenceAnchor = input.evidenceAnchor ?? null;
    const authorType = input.authorType ?? "internal";

    const raw = await this.executor.query(
      `INSERT INTO review_comments (
        id, repository_id, review_id, parent_id, finding_fingerprint,
        evidence_anchor, author_id, author_type, content, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', NOW(), NOW())
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        parent_id AS "parentId",
        finding_fingerprint AS "findingFingerprint",
        evidence_anchor AS "evidenceAnchor",
        author_id AS "authorId",
        author_type AS "authorType",
        content,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        id,
        input.repositoryId,
        input.reviewId,
        parentId,
        findingFingerprint,
        evidenceAnchor,
        input.authorId,
        authorType,
        input.content,
      ],
    );

    const rows = extractRows<ReviewCommentRecord>(raw);
    const record = rows[0];
    if (!record) {
      throw new Error("Failed to create review comment");
    }
    return record;
  }

  async updateCommentStatus(commentId: string, status: CommentStatus): Promise<ReviewCommentRecord | undefined> {
    const raw = await this.executor.query(
      `UPDATE review_comments
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        parent_id AS "parentId",
        finding_fingerprint AS "findingFingerprint",
        evidence_anchor AS "evidenceAnchor",
        author_id AS "authorId",
        author_type AS "authorType",
        content,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [commentId, status],
    );

    const rows = extractRows<ReviewCommentRecord>(raw);
    return rows[0];
  }

  async listCommentsForReview(reviewId: string): Promise<ReviewCommentRecord[]> {
    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        parent_id AS "parentId",
        finding_fingerprint AS "findingFingerprint",
        evidence_anchor AS "evidenceAnchor",
        author_id AS "authorId",
        author_type AS "authorType",
        content,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM review_comments
      WHERE review_id = $1
      ORDER BY created_at ASC`,
      [reviewId],
    );
    return extractRows<ReviewCommentRecord>(raw);
  }
}
