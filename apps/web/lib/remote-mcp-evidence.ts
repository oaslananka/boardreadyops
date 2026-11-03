import type { SqlQueryExecutor } from "@boardreadyops/db";
import {
  type CheckLiveRepositoryPermission,
  loadAuthorizedRemoteReviewSnapshot,
  type RemoteMcpPrincipal,
  sameAuthorizedRemoteReviewSnapshot,
} from "./remote-mcp-access.js";
import { remoteMcpOrigin } from "./remote-mcp-foundation.js";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

export type RecordedRemoteMcpEvidence = {
  schemaVersion: 1;
  availability: "recorded";
  source: "hosted-review-revision";
  evidenceId: string;
  headCommitSha: string;
  baseCommitSha?: string;
  evidenceDigest: string;
  inAppUrl: string;
  verification: "recorded-metadata-only";
  productionApproval: "not-evaluated";
};

/**
 * Read a current Review revision's persisted digest and source identities only.
 * The evidenceId is a review_revisions.id, NOT an artifact byte or path selector.
 * The initial lookup returns no private data; live repository authority is checked
 * before any metadata can leave this process and again before returning it.
 */
export async function loadAuthorizedRemoteEvidence(
  db: Pick<SqlQueryExecutor, "query">,
  principal: RemoteMcpPrincipal,
  evidenceId: string,
  checkCurrentPermission: CheckLiveRepositoryPermission,
): Promise<RecordedRemoteMcpEvidence | null> {
  if (!principal.scopes.includes("evidence:read") || !uuid.test(evidenceId)) return null;

  const resolved = await db.query(
    `select reviews.id as review_id
       from review_revisions as requested_revision
       join reviews on reviews.id = requested_revision.review_id
      where requested_revision.id = $1
        and reviews.current_revision_id = requested_revision.id
      limit 1`,
    [evidenceId],
  );
  const reviewId = ((resolved as { rows?: { review_id: unknown }[] }).rows ?? [])[0]?.review_id;
  if (typeof reviewId !== "string" || !uuid.test(reviewId)) return null;

  const before = await loadAuthorizedRemoteReviewSnapshot(
    db,
    principal,
    reviewId,
    checkCurrentPermission,
    "evidence:read",
  );
  if (!before || before.revisionId !== evidenceId || !before.facts.evidenceDigest || !before.facts.headCommitSha) {
    return null;
  }

  // Even a recognized revision may be superseded or its GitHub membership revoked
  // while its details are read. Do not return stale scoped metadata.
  const current = await loadAuthorizedRemoteReviewSnapshot(
    db,
    principal,
    reviewId,
    checkCurrentPermission,
    "evidence:read",
  );
  if (!sameAuthorizedRemoteReviewSnapshot(before, current)) return null;
  return {
    schemaVersion: 1,
    availability: "recorded",
    source: "hosted-review-revision",
    evidenceId,
    headCommitSha: before.facts.headCommitSha,
    ...(before.baseCommitSha ? { baseCommitSha: before.baseCommitSha } : {}),
    evidenceDigest: before.facts.evidenceDigest,
    inAppUrl: `${remoteMcpOrigin}/reviews/${reviewId}`,
    verification: "recorded-metadata-only",
    productionApproval: "not-evaluated",
  };
}
