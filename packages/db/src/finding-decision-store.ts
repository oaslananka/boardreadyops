import { randomUUID } from "node:crypto";
import type { FindingDisposition } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export interface FindingDecisionRecord {
  id: string;
  repositoryId: string;
  reviewId: string;
  findingFingerprint: string;
  disposition: FindingDisposition;
  reason: string;
  owner: string;
  expiresAt: string | null;
  evidenceDigest: string;
  actorId: string;
  createdAt: string;
}

export interface RecordDecisionInput {
  repositoryId: string;
  reviewId: string;
  findingFingerprint: string;
  disposition: FindingDisposition;
  reason: string;
  owner: string;
  expiresAt?: string | null | undefined;
  evidenceDigest: string;
  actorId: string;
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

export class FindingDecisionStore {
  constructor(private readonly executor: SqlQueryExecutor) {}

  async recordDecision(input: RecordDecisionInput): Promise<FindingDecisionRecord> {
    if (input.disposition === "accepted_risk" && input.reason.trim().length < 20) {
      throw new Error("Accepted risk disposition requires a justification reason of at least 20 characters");
    }

    const id = `fdec_${randomUUID()}`;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;

    const raw = await this.executor.query(
      `INSERT INTO finding_decisions (
        id, repository_id, review_id, finding_fingerprint, disposition,
        reason, owner, expires_at, evidence_digest, actor_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        disposition,
        reason,
        owner,
        expires_at AS "expiresAt",
        evidence_digest AS "evidenceDigest",
        actor_id AS "actorId",
        created_at AS "createdAt"`,
      [
        id,
        input.repositoryId,
        input.reviewId,
        input.findingFingerprint,
        input.disposition,
        input.reason,
        input.owner,
        expiresAt,
        input.evidenceDigest,
        input.actorId,
      ],
    );

    const rows = extractRows<FindingDecisionRecord>(raw);
    const record = rows[0];
    if (!record) {
      throw new Error("Failed to insert finding decision");
    }
    return record;
  }

  async listDecisionsForReview(reviewId: string): Promise<FindingDecisionRecord[]> {
    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        disposition,
        reason,
        owner,
        expires_at AS "expiresAt",
        evidence_digest AS "evidenceDigest",
        actor_id AS "actorId",
        created_at AS "createdAt"
      FROM finding_decisions
      WHERE review_id = $1
      ORDER BY created_at DESC`,
      [reviewId],
    );
    return extractRows<FindingDecisionRecord>(raw);
  }

  async getLatestDecisionsByReviewId(reviewId: string): Promise<Map<string, FindingDecisionRecord>> {
    const raw = await this.executor.query(
      `SELECT DISTINCT ON (finding_fingerprint)
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        disposition,
        reason,
        owner,
        expires_at AS "expiresAt",
        evidence_digest AS "evidenceDigest",
        actor_id AS "actorId",
        created_at AS "createdAt"
      FROM finding_decisions
      WHERE review_id = $1
      ORDER BY finding_fingerprint, created_at DESC`,
      [reviewId],
    );

    const rows = extractRows<FindingDecisionRecord>(raw);
    const map = new Map<string, FindingDecisionRecord>();
    for (const row of rows) {
      map.set(row.findingFingerprint, row);
    }
    return map;
  }

  async getDecisionHistory(reviewId: string, findingFingerprint: string): Promise<FindingDecisionRecord[]> {
    const raw = await this.executor.query(
      `SELECT
        id,
        repository_id AS "repositoryId",
        review_id AS "reviewId",
        finding_fingerprint AS "findingFingerprint",
        disposition,
        reason,
        owner,
        expires_at AS "expiresAt",
        evidence_digest AS "evidenceDigest",
        actor_id AS "actorId",
        created_at AS "createdAt"
      FROM finding_decisions
      WHERE review_id = $1 AND finding_fingerprint = $2
      ORDER BY created_at DESC`,
      [reviewId, findingFingerprint],
    );
    return extractRows<FindingDecisionRecord>(raw);
  }
}
