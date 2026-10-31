import { createHash } from "node:crypto";
import type { ExportRecordClaim } from "./data-export-record-snapshot.js";
import { isValidExportTimestamp } from "./data-export-timestamp.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/** An incomplete internal preparation slice, not publication or download authorization. */
export class ExportReviewCommentsSnapshotUnavailableError extends Error {
  constructor() {
    super("The claimed review comments snapshot is unavailable or exceeds its limits.");
    this.name = "ExportReviewCommentsSnapshotUnavailableError";
  }
}

export type ClaimedReviewCommentsSnapshot = {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentType: "application/json";
};

const maxRows = 100;
const maxBytes = 256 * 1024;
const maxCommentBytes = 64 * 1024;
const maxEvidenceBytes = 2048;
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && v.trim() === v;
const validOptionalId = (v: unknown): v is string | null => v === null || validId(v);
const validOptionalEvidence = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && Buffer.byteLength(v, "utf8") <= maxEvidenceBytes);
const validTimestamp = isValidExportTimestamp;

interface CommentRow {
  id: unknown;
  review_id: unknown;
  repository_id: unknown;
  review_repository_id: unknown;
  parent_id: unknown;
  parent_valid: unknown;
  author_id: unknown;
  author_type: unknown;
  content: unknown;
  status: unknown;
  finding_fingerprint: unknown;
  evidence_anchor: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/**
 * Claim-scoped, read-only, bounded metadata. Intended to run inside the
 * consistent-read transaction used by the other incomplete export slices.
 *
 * Corrupt repository/parent links are returned as invalid sentinels rather
 * than being silently dropped. Parent chains must also exist in the returned
 * bounded collection. Neither a customer download nor a completion signal.
 */
export async function prepareClaimedReviewCommentsSnapshot(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
): Promise<ClaimedReviewCommentsSnapshot | null> {
  if (![claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token].every(validId)) {
    throw new ExportReviewCommentsSnapshotUnavailableError();
  }

  const result = (await db.query(
    `WITH allowed AS MATERIALIZED (
       SELECT exp.scope, exp.scope_id, inst.id AS installation_id
         FROM data_exports AS exp
         JOIN installations AS inst ON inst.id=exp.installation_id
        WHERE exp.id=$1 AND LOWER(exp.tenant_id)=LOWER($2)
          AND exp.installation_id=$3 AND exp.status='running'
          AND exp.preparation_worker=$4 AND exp.preparation_token=$5
          AND exp.preparation_lease_until > NOW()
          AND inst.suspended_at IS NULL
          AND LOWER(inst.account_login)=LOWER(exp.tenant_id)
          AND ((exp.scope='organization' AND exp.scope_id IS NULL)
            OR (exp.scope='repository' AND EXISTS (
              SELECT 1 FROM repositories AS scoped
               WHERE scoped.id=exp.scope_id AND scoped.installation_id=inst.id
                 AND scoped.disabled_at IS NULL)))
     ),
     permitted_repositories AS MATERIALIZED (
       SELECT repo.id
         FROM repositories AS repo JOIN allowed
           ON repo.installation_id=allowed.installation_id
        WHERE repo.disabled_at IS NULL
          AND (allowed.scope='organization' OR repo.id=allowed.scope_id)
     ),
     comment_rows AS (
       SELECT
              CASE WHEN CHAR_LENGTH(comments.id) <= 256 THEN comments.id ELSE '' END AS id,
              CASE WHEN CHAR_LENGTH(comments.repository_id) <= 256 THEN comments.repository_id ELSE '' END AS repository_id,
              CASE WHEN CHAR_LENGTH(comments.review_id) <= 256 THEN comments.review_id ELSE '' END AS review_id,
              CASE WHEN CHAR_LENGTH(review.repository_id) <= 256 THEN review.repository_id ELSE '' END AS review_repository_id,
              CASE WHEN comments.parent_id IS NULL THEN NULL
                   WHEN CHAR_LENGTH(comments.parent_id) <= 256 THEN comments.parent_id
                   ELSE '' END AS parent_id,
              CASE WHEN CHAR_LENGTH(comments.author_id) <= 256 THEN comments.author_id ELSE '' END AS author_id,
              comments.author_type,
              CASE WHEN OCTET_LENGTH(comments.content) <= 65536
                THEN comments.content ELSE NULL END AS content,
              comments.status,
              CASE WHEN comments.finding_fingerprint IS NULL THEN NULL
                   WHEN OCTET_LENGTH(comments.finding_fingerprint) <= 2048
                     THEN comments.finding_fingerprint ELSE REPEAT('x', 2049) END AS finding_fingerprint,
              CASE WHEN comments.evidence_anchor IS NULL THEN NULL
                   WHEN OCTET_LENGTH(comments.evidence_anchor) <= 2048
                     THEN comments.evidence_anchor ELSE REPEAT('x', 2049) END AS evidence_anchor,
              comments.created_at,
              comments.updated_at,
              (comments.parent_id IS NULL OR EXISTS (
                SELECT 1 FROM review_comments AS parent
                 WHERE parent.id=comments.parent_id
                   AND parent.review_id=comments.review_id
                   AND parent.repository_id=review.repository_id
                   AND parent.id <> comments.id)) AS parent_valid
         FROM review_comments AS comments
         JOIN reviews AS review ON review.id=comments.review_id
         JOIN permitted_repositories AS permitted ON permitted.id=review.repository_id
        ORDER BY comments.id LIMIT 101
     ),
     comment_bundle AS MATERIALIZED (
       SELECT COALESCE(jsonb_agg(to_jsonb(comment_rows) ORDER BY comment_rows.id),'[]'::jsonb) AS comments
         FROM comment_rows
     )
     SELECT CASE WHEN OCTET_LENGTH(comment_bundle.comments::text) <= 262144
            THEN comment_bundle.comments ELSE NULL END AS comments
       FROM allowed CROSS JOIN comment_bundle LIMIT 1`,
    [claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token],
  )) as { rows?: Array<{ comments: unknown }> };

  const row = result.rows?.[0];
  if (!row) return null;
  if (!Array.isArray(row.comments) || row.comments.length > maxRows) {
    throw new ExportReviewCommentsSnapshotUnavailableError();
  }

  const comments = row.comments.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") {
      throw new ExportReviewCommentsSnapshotUnavailableError();
    }
    const c = candidate as CommentRow;
    if (
      ![c.id, c.review_id, c.repository_id, c.author_id, c.author_type, c.status].every(validId) ||
      !validId(c.review_repository_id) ||
      c.repository_id !== c.review_repository_id ||
      !validOptionalId(c.parent_id) ||
      c.parent_valid !== true ||
      !["internal", "guest"].includes(c.author_type as string) ||
      !["open", "resolved", "stale"].includes(c.status as string) ||
      typeof c.content !== "string" ||
      Buffer.byteLength(c.content, "utf8") > maxCommentBytes ||
      !validOptionalEvidence(c.finding_fingerprint) ||
      !validOptionalEvidence(c.evidence_anchor) ||
      !validTimestamp(c.created_at) ||
      !validTimestamp(c.updated_at)
    ) {
      throw new ExportReviewCommentsSnapshotUnavailableError();
    }
    return {
      id: c.id,
      reviewId: c.review_id,
      repositoryId: c.repository_id,
      parentId: c.parent_id,
      authorId: c.author_id,
      authorType: c.author_type,
      content: c.content,
      status: c.status,
      findingFingerprint: c.finding_fingerprint,
      evidenceAnchor: c.evidence_anchor,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  });

  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  if (byId.size !== comments.length) throw new ExportReviewCommentsSnapshotUnavailableError();
  for (const comment of comments) {
    const seen = new Set([comment.id]);
    let cursor = comment;
    while (cursor.parentId !== null) {
      const parent = byId.get(cursor.parentId);
      if (
        !parent ||
        parent.reviewId !== comment.reviewId ||
        parent.repositoryId !== comment.repositoryId ||
        seen.has(parent.id)
      )
        throw new ExportReviewCommentsSnapshotUnavailableError();
      seen.add(parent.id);
      cursor = parent;
    }
  }

  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.claimed-review-comments-snapshot",
      coverage: "authorized-repository-review-comments-only",
      exportId: claim.exportId,
      exclusions: [
        "audit-metadata",
        "installation-only-audit",
        "managed-artifact-bytes",
        "source-code",
        "backups-and-platform-logs",
      ],
      comments,
    }),
    "utf8",
  );
  if (!bytes.length || bytes.length > maxBytes) throw new ExportReviewCommentsSnapshotUnavailableError();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "application/json",
  };
}
