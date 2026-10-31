import { createHash } from "node:crypto";
import type { ExportRecordClaim } from "./data-export-record-snapshot.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/** A partial internal snapshot, NEVER an archive or a delivery capability. */
export class ExportReviewAuditSnapshotUnavailableError extends Error {
  constructor() {
    super("The claimed review and audit snapshot is unavailable or exceeds its limits.");
    this.name = "ExportReviewAuditSnapshotUnavailableError";
  }
}

export type ClaimedReviewAuditSnapshot = {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentType: "application/json";
};

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
const validOptionalId = (value: unknown) => value === null || validId(value);
const maxRows = 100;
const maxBytes = 256 * 1024;

type ReviewRow = {
  id: string;
  repository_id: string;
  head_run_id: string;
  title: string;
  status: string;
  decision: string;
};
type RevisionRow = {
  id: string;
  review_id: string;
  sequence: number;
  base_run_id: string | null;
  head_run_id: string;
  base_commit_sha: string | null;
  head_commit_sha: string;
  evidence_digest: string;
};

type AuditRow = {
  id: string;
  repository_id: string;
  release_run_id: string | null;
  event_type: string;
  actor_type: string;
  subject_type: string;
  subject_id: string | null;
};

/**
 * One claim-scoped SQL statement, usable inside the existing consistent-read
 * transaction. Deliberately restricts audit evidence to records explicitly
 * linked to an authorized repository; installation-only audit events, metadata
 * payloads, review comments and other data classes remain excluded.
 * This MUST NOT be described as a full customer export.
 */
export async function prepareClaimedReviewAuditSnapshot(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
): Promise<ClaimedReviewAuditSnapshot | null> {
  if (![claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token].every(validId))
    throw new ExportReviewAuditSnapshotUnavailableError();
  const result = (await db.query(
    `WITH allowed AS MATERIALIZED (
       SELECT exports.id, exports.scope, exports.scope_id, installation.id AS installation_id
       FROM data_exports AS exports
       JOIN installations AS installation ON installation.id=exports.installation_id
       WHERE exports.id=$1 AND lower(exports.tenant_id)=lower($2)
         AND exports.installation_id=$3 AND exports.status='running'
         AND exports.preparation_worker=$4 AND exports.preparation_token=$5
         AND exports.preparation_lease_until>NOW()
         AND installation.suspended_at IS NULL
         AND lower(installation.account_login)=lower(exports.tenant_id)
         AND ((exports.scope='organization' AND exports.scope_id IS NULL)
           OR (exports.scope='repository' AND EXISTS (
             SELECT 1 FROM repositories WHERE repositories.id=exports.scope_id
               AND repositories.installation_id=installation.id
               AND repositories.disabled_at IS NULL)))
     ),
     permitted_repositories AS MATERIALIZED (
       SELECT repository.id, allowed.installation_id
       FROM repositories AS repository
       JOIN allowed ON repository.installation_id=allowed.installation_id
       WHERE repository.disabled_at IS NULL
         AND (allowed.scope='organization' OR repository.id=allowed.scope_id)
     ),
     review_rows AS (
       SELECT review.id, review.repository_id, review.head_run_id,
              review.title, review.status, review.decision
       FROM reviews AS review JOIN permitted_repositories AS permitted ON permitted.id=review.repository_id
       ORDER BY review.id LIMIT 101
     ),
     revision_rows AS (
       SELECT revision.id, revision.review_id, revision.sequence,
              revision.base_run_id, revision.head_run_id,
              revision.base_commit_sha, revision.head_commit_sha, revision.evidence_digest
       FROM review_revisions AS revision
       JOIN reviews AS review ON review.id=revision.review_id
       JOIN permitted_repositories AS permitted ON permitted.id=review.repository_id
       JOIN release_runs AS head_run ON head_run.id=revision.head_run_id
         AND head_run.repository_id=permitted.id
       WHERE (revision.base_run_id IS NULL OR EXISTS (
         SELECT 1 FROM release_runs AS base_run WHERE base_run.id=revision.base_run_id
           AND base_run.repository_id=permitted.id))
       ORDER BY revision.id LIMIT 101
     ),
     audit_rows AS (
       SELECT audit.id, audit.repository_id, audit.release_run_id,
              audit.event_type, audit.actor_type, audit.subject_type, audit.subject_id
       FROM audit_events AS audit
       JOIN permitted_repositories AS permitted
         ON permitted.id=audit.repository_id AND permitted.installation_id=audit.installation_id
       ORDER BY audit.id LIMIT 101
     )
     SELECT
       (SELECT COALESCE(jsonb_agg(to_jsonb(review_rows) ORDER BY review_rows.id),'[]'::jsonb) FROM review_rows) AS reviews,
       (SELECT COALESCE(jsonb_agg(to_jsonb(revision_rows) ORDER BY revision_rows.id),'[]'::jsonb) FROM revision_rows) AS revisions,
       (SELECT COALESCE(jsonb_agg(to_jsonb(audit_rows) ORDER BY audit_rows.id),'[]'::jsonb) FROM audit_rows) AS audit_events
     FROM allowed LIMIT 1`,
    [claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token],
  )) as { rows?: Array<{ reviews: unknown; revisions: unknown; audit_events: unknown }> };
  const row = result.rows?.[0];
  if (!row) return null;
  if (!Array.isArray(row.reviews) || !Array.isArray(row.revisions) || !Array.isArray(row.audit_events))
    throw new ExportReviewAuditSnapshotUnavailableError();
  if (row.reviews.length > maxRows || row.revisions.length > maxRows || row.audit_events.length > maxRows)
    throw new ExportReviewAuditSnapshotUnavailableError();
  const reviews = row.reviews.map((r: ReviewRow | null) => {
    if (
      !r ||
      ![r.id, r.repository_id, r.head_run_id, r.status, r.decision].every(validId) ||
      typeof r.title !== "string"
    )
      throw new ExportReviewAuditSnapshotUnavailableError();
    return {
      id: r.id,
      repositoryId: r.repository_id,
      headRunId: r.head_run_id,
      title: r.title,
      status: r.status,
      decision: r.decision,
    };
  });
  const revisions = row.revisions.map((revision: RevisionRow | null) => {
    if (
      !revision ||
      ![revision.id, revision.review_id, revision.head_run_id, revision.head_commit_sha].every(validId) ||
      !Number.isSafeInteger(revision.sequence) ||
      revision.sequence < 1 ||
      !validOptionalId(revision.base_run_id) ||
      !validOptionalId(revision.base_commit_sha) ||
      !/^[a-f0-9]{64}$/u.test(revision.evidence_digest)
    )
      throw new ExportReviewAuditSnapshotUnavailableError();
    return {
      id: revision.id,
      reviewId: revision.review_id,
      sequence: revision.sequence,
      baseRunId: revision.base_run_id,
      headRunId: revision.head_run_id,
      baseCommitSha: revision.base_commit_sha,
      headCommitSha: revision.head_commit_sha,
      evidenceDigest: revision.evidence_digest,
    };
  });
  const auditEvents = row.audit_events.map((a: AuditRow | null) => {
    if (
      !a ||
      ![a.id, a.repository_id, a.event_type, a.actor_type, a.subject_type].every(validId) ||
      !validOptionalId(a.release_run_id) ||
      !validOptionalId(a.subject_id)
    )
      throw new ExportReviewAuditSnapshotUnavailableError();
    return {
      id: a.id,
      repositoryId: a.repository_id,
      releaseRunId: a.release_run_id,
      eventType: a.event_type,
      actorType: a.actor_type,
      subjectType: a.subject_type,
      subjectId: a.subject_id,
    };
  });
  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.claimed-review-audit-snapshot",
      coverage: "authorized-repository-reviews-revisions-and-repository-linked-audit-descriptors-only",
      exportId: claim.exportId,
      exclusions: [
        "audit-metadata",
        "installation-only-audit",
        "review-comments",
        "artifacts",
        "source-code",
        "backups-and-platform-logs",
      ],
      reviews,
      revisions,
      auditEvents,
    }),
    "utf8",
  );
  if (!bytes.length || bytes.length > maxBytes) throw new ExportReviewAuditSnapshotUnavailableError();
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    contentType: "application/json",
  };
}
