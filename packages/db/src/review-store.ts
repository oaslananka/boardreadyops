import { randomUUID } from "node:crypto";
import type { Review, ReviewDecision, ReviewRevision, ReviewStatus } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type StoredReviewRow = {
  id: string;
  repository_id: string;
  pull_request_number: number | null;
  title: string;
  status: ReviewStatus;
  decision: ReviewDecision;
  base_run_id: string | null;
  head_run_id: string;
  current_revision_id: string;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

export type StoredReviewRevisionRow = {
  id: string;
  review_id: string;
  sequence: number;
  base_run_id: string | null;
  head_run_id: string;
  base_commit_sha: string | null;
  head_commit_sha: string;
  evidence_digest: string;
  created_at: string | Date;
};

export type StoredFindingRow = {
  id: string;
  run_id: string;
  rule_id: string;
  severity: "error" | "high" | "medium" | "low" | "info";
  message: string;
  path: string | null;
  kind: string | null;
  fingerprint: string | null;
  waived_at: string | Date | null;
};

export interface UpsertReviewInput {
  repositoryId: string;
  pullRequestNumber?: number;
  title: string;
  headRunId: string;
  headCommitSha: string;
  baseRunId?: string;
  baseCommitSha?: string;
  evidenceDigest: string;
  createdBy?: string;
}

export interface ListReviewsFilter {
  status?: ReviewStatus;
  decision?: ReviewDecision;
  limit?: number;
  cursor?: string; // Base64 encoded { updatedAt, id }
}

function mapReview(row: StoredReviewRow): Review {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    ...(row.pull_request_number !== null ? { pullRequestNumber: row.pull_request_number } : {}),
    title: row.title,
    status: row.status,
    decision: row.decision,
    ...(row.base_run_id !== null ? { baseRunId: row.base_run_id } : {}),
    headRunId: row.head_run_id,
    currentRevisionId: row.current_revision_id,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.completed_at !== null ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
  };
}

function mapRevision(row: StoredReviewRevisionRow): ReviewRevision {
  return {
    id: row.id,
    reviewId: row.review_id,
    sequence: row.sequence,
    ...(row.base_run_id !== null ? { baseRunId: row.base_run_id } : {}),
    headRunId: row.head_run_id,
    ...(row.base_commit_sha !== null ? { baseCommitSha: row.base_commit_sha } : {}),
    headCommitSha: row.head_commit_sha,
    evidenceDigest: row.evidence_digest,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class ReviewStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async upsertReviewForRun(input: UpsertReviewInput): Promise<{ review: Review; revision: ReviewRevision }> {
    const now = new Date().toISOString();
    const createdBy = input.createdBy ?? "system";

    let reviewId: string;
    let title = input.title;

    // Check if an existing review exists for this PR (or branch run)
    if (input.pullRequestNumber !== undefined) {
      const existingPr = await this.db.query(
        `select * from reviews where repository_id = $1 and pull_request_number = $2 limit 1`,
        [input.repositoryId, input.pullRequestNumber],
      );
      const rows = ((existingPr as { rows?: StoredReviewRow[] }).rows ?? []) as StoredReviewRow[];
      if (rows.length > 0 && rows[0]) {
        reviewId = rows[0].id;
        title = rows[0].title;
      } else {
        reviewId = randomUUID();
      }
    } else {
      const existingRun = await this.db.query(
        `select * from reviews where repository_id = $1 and head_run_id = $2 limit 1`,
        [input.repositoryId, input.headRunId],
      );
      const rows = ((existingRun as { rows?: StoredReviewRow[] }).rows ?? []) as StoredReviewRow[];
      if (rows.length > 0 && rows[0]) {
        reviewId = rows[0].id;
        title = rows[0].title;
      } else {
        reviewId = randomUUID();
      }
    }

    // Determine current sequence
    const seqResult = await this.db.query(
      `select coalesce(max(sequence), 0) + 1 as next_seq from review_revisions where review_id = $1`,
      [reviewId],
    );
    const nextSeq = Number(((seqResult as { rows?: { next_seq: number }[] }).rows ?? [])[0]?.next_seq ?? 1);

    const revisionId = randomUUID();

    // Upsert the review record first: review_revisions.review_id has a foreign key to
    // reviews.id, so the review must exist before a revision can reference it (there is no
    // FK the other way — reviews.current_revision_id is set here even though that revision
    // row doesn't exist until the next statement).
    const reviewResult = await this.db.query(
      `insert into reviews (
        id, repository_id, pull_request_number, title, status, decision, base_run_id, head_run_id, current_revision_id, created_by, created_at, updated_at
      ) values ($1, $2, $3, $4, 'active', 'pending', $5, $6, $7, $8, $9, $9)
      on conflict (id) do update set
        title = excluded.title,
        base_run_id = excluded.base_run_id,
        head_run_id = excluded.head_run_id,
        current_revision_id = excluded.current_revision_id,
        updated_at = excluded.updated_at
      returning *`,
      [
        reviewId,
        input.repositoryId,
        input.pullRequestNumber ?? null,
        title,
        input.baseRunId ?? null,
        input.headRunId,
        revisionId,
        createdBy,
        now,
      ],
    );

    await this.db.query(
      `insert into review_revisions (
        id, review_id, sequence, base_run_id, head_run_id, base_commit_sha, head_commit_sha, evidence_digest, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        revisionId,
        reviewId,
        nextSeq,
        input.baseRunId ?? null,
        input.headRunId,
        input.baseCommitSha ?? null,
        input.headCommitSha,
        input.evidenceDigest,
        now,
      ],
    );

    const reviewRows = ((reviewResult as { rows?: StoredReviewRow[] }).rows ?? []) as StoredReviewRow[];
    const firstReviewRow = reviewRows[0];
    if (!firstReviewRow) {
      throw new Error("Failed to insert or update review record");
    }
    const review = mapReview(firstReviewRow);

    const revision: ReviewRevision = {
      id: revisionId,
      reviewId,
      sequence: nextSeq,
      ...(input.baseRunId !== undefined ? { baseRunId: input.baseRunId } : {}),
      headRunId: input.headRunId,
      ...(input.baseCommitSha !== undefined ? { baseCommitSha: input.baseCommitSha } : {}),
      headCommitSha: input.headCommitSha,
      evidenceDigest: input.evidenceDigest,
      createdAt: now,
    };

    return { review, revision };
  }

  async getReviewById(repositoryId: string, reviewId: string): Promise<Review | undefined> {
    const result = await this.db.query(`select * from reviews where id = $1 and repository_id = $2 limit 1`, [
      reviewId,
      repositoryId,
    ]);
    const rows = ((result as { rows?: StoredReviewRow[] }).rows ?? []) as StoredReviewRow[];
    const first = rows[0];
    return first ? mapReview(first) : undefined;
  }

  async getReviewByRunId(repositoryId: string, runId: string): Promise<Review | undefined> {
    const result = await this.db.query(
      `select * from reviews where repository_id = $1 and (head_run_id = $2 or base_run_id = $2) limit 1`,
      [repositoryId, runId],
    );
    const rows = ((result as { rows?: StoredReviewRow[] }).rows ?? []) as StoredReviewRow[];
    const first = rows[0];
    return first ? mapReview(first) : undefined;
  }

  async listReviews(
    repositoryId: string,
    filter: ListReviewsFilter = {},
  ): Promise<{ reviews: Review[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    const params: unknown[] = [repositoryId];
    let query = `select * from reviews where repository_id = $1`;

    if (filter.status) {
      params.push(filter.status);
      query += ` and status = $${params.length}`;
    }

    if (filter.decision) {
      params.push(filter.decision);
      query += ` and decision = $${params.length}`;
    }

    if (filter.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8")) as {
          updatedAt: string;
          id: string;
        };
        params.push(decoded.updatedAt, decoded.id);
        query += ` and (updated_at, id) < ($${params.length - 1}, $${params.length})`;
      } catch {
        // Invalid cursor ignored
      }
    }

    params.push(limit + 1);
    query += ` order by updated_at desc, id desc limit $${params.length}`;

    const result = await this.db.query(query, params);
    const rows = ((result as { rows?: StoredReviewRow[] }).rows ?? []) as StoredReviewRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | undefined;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      if (last) {
        nextCursor = Buffer.from(
          JSON.stringify({ updatedAt: new Date(last.updated_at).toISOString(), id: last.id }),
        ).toString("base64url");
      }
    }

    return {
      reviews: items.map(mapReview),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async listReviewRevisions(repositoryId: string, reviewId: string): Promise<ReviewRevision[]> {
    // Validate review belongs to tenant
    const review = await this.getReviewById(repositoryId, reviewId);
    if (!review) return [];

    const result = await this.db.query(`select * from review_revisions where review_id = $1 order by sequence asc`, [
      reviewId,
    ]);
    const rows = ((result as { rows?: StoredReviewRevisionRow[] }).rows ?? []) as StoredReviewRevisionRow[];
    return rows.map(mapRevision);
  }

  async getFindingsForRun(repositoryId: string, runId: string): Promise<StoredFindingRow[]> {
    // Check run belongs to repository
    const runCheck = await this.db.query(`select id from release_runs where id = $1 and repository_id = $2 limit 1`, [
      runId,
      repositoryId,
    ]);
    const runRows = ((runCheck as { rows?: { id: string }[] }).rows ?? []) as { id: string }[];
    if (runRows.length === 0) return [];

    const result = await this.db.query(`select * from findings where run_id = $1`, [runId]);
    return ((result as { rows?: StoredFindingRow[] }).rows ?? []) as StoredFindingRow[];
  }
}
