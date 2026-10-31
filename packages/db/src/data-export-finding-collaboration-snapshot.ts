import { createHash } from "node:crypto";
import type { ExportRecordClaim } from "./data-export-record-snapshot.js";
import { isValidExportTimestamp } from "./data-export-timestamp.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/** Incomplete claim-scoped metadata, not publication or download authorization. */
export class ExportFindingCollaborationSnapshotUnavailableError extends Error {
  constructor() {
    super("The claimed finding collaboration snapshot is unavailable or exceeds its limits.");
    this.name = "ExportFindingCollaborationSnapshotUnavailableError";
  }
}

export type ClaimedFindingCollaborationSnapshot = {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentType: "application/json";
};

const fail = (): never => {
  throw new ExportFindingCollaborationSnapshotUnavailableError();
};
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && v.trim() === v;
const validText = (v: unknown, max: number): v is string =>
  typeof v === "string" && Buffer.byteLength(v, "utf8") <= max;
const validTime = isValidExportTimestamp;
const validOptionalTime = (v: unknown): v is string | null => v === null || validTime(v);
const validDigest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);

type DecisionRow = {
  id: unknown;
  repository_id: unknown;
  review_repository_id: unknown;
  review_id: unknown;
  finding_fingerprint: unknown;
  disposition: unknown;
  reason: unknown;
  owner: unknown;
  expires_at: unknown;
  evidence_digest: unknown;
  actor_id: unknown;
  created_at: unknown;
};
type AssignmentRow = {
  id: unknown;
  repository_id: unknown;
  review_repository_id: unknown;
  review_id: unknown;
  finding_fingerprint: unknown;
  assignee: unknown;
  assigned_by: unknown;
  created_at: unknown;
};

/**
 * The original installation claim and bounded repository scope are checked in
 * the SAME PostgreSQL read-only repeatable-read transaction as all other slices.
 * The repository fields in child records are deliberately retained and checked
 * against authorized parent reviews to fail closed rather than silently drop
 * corrupt cross-repository relationships.
 */
export async function prepareClaimedFindingCollaborationSnapshot(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
): Promise<ClaimedFindingCollaborationSnapshot | null> {
  if (![claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token].every(validId)) fail();
  const result = (await db.query(
    `WITH allowed AS MATERIALIZED (
      SELECT exp.scope,exp.scope_id,inst.id AS installation_id FROM data_exports exp
      JOIN installations inst ON inst.id=exp.installation_id
      WHERE exp.id=$1 AND lower(exp.tenant_id)=lower($2)
        AND exp.installation_id=$3 AND exp.status='running'
        AND exp.preparation_worker=$4 AND exp.preparation_token=$5
        AND exp.preparation_lease_until>NOW() AND inst.suspended_at IS NULL
        AND lower(inst.account_login)=lower(exp.tenant_id)
        AND ((exp.scope='organization' AND exp.scope_id IS NULL)
          OR (exp.scope='repository' AND EXISTS (
            SELECT 1 FROM repositories scoped WHERE scoped.id=exp.scope_id
              AND scoped.installation_id=inst.id AND scoped.disabled_at IS NULL)))
    ), permitted AS MATERIALIZED (
      SELECT repo.id FROM repositories repo
      JOIN allowed ON allowed.installation_id=repo.installation_id
      WHERE repo.disabled_at IS NULL AND (allowed.scope='organization' OR repo.id=allowed.scope_id)
    ), decision_rows AS (
      SELECT
        CASE WHEN length(d.id)<=256 THEN d.id ELSE '' END AS id,
        CASE WHEN length(d.repository_id)<=256 THEN d.repository_id ELSE '' END AS repository_id,
        CASE WHEN length(r.repository_id)<=256 THEN r.repository_id ELSE '' END AS review_repository_id,
        CASE WHEN length(d.review_id)<=256 THEN d.review_id ELSE '' END AS review_id,
        CASE WHEN octet_length(d.finding_fingerprint)<=2048 THEN d.finding_fingerprint
          ELSE repeat('x',2049) END AS finding_fingerprint,
        d.disposition,
        CASE WHEN octet_length(d.reason)<=4096 THEN d.reason ELSE repeat('x',4097) END AS reason,
        CASE WHEN length(d.owner)<=256 THEN d.owner ELSE '' END AS owner,
        d.expires_at,
        CASE WHEN octet_length(d.evidence_digest)<=128 THEN d.evidence_digest ELSE '' END AS evidence_digest,
        CASE WHEN length(d.actor_id)<=256 THEN d.actor_id ELSE '' END AS actor_id,
        d.created_at
      FROM finding_decisions d JOIN reviews r ON r.id=d.review_id
      JOIN permitted ON permitted.id=r.repository_id
      ORDER BY d.id LIMIT 101
    ), assignment_rows AS (
      SELECT
        CASE WHEN length(a.id)<=256 THEN a.id ELSE '' END AS id,
        CASE WHEN length(a.repository_id)<=256 THEN a.repository_id ELSE '' END AS repository_id,
        CASE WHEN length(r.repository_id)<=256 THEN r.repository_id ELSE '' END AS review_repository_id,
        CASE WHEN length(a.review_id)<=256 THEN a.review_id ELSE '' END AS review_id,
        CASE WHEN octet_length(a.finding_fingerprint)<=2048 THEN a.finding_fingerprint
          ELSE repeat('x',2049) END AS finding_fingerprint,
        CASE WHEN length(a.assignee)<=256 THEN a.assignee ELSE '' END AS assignee,
        CASE WHEN length(a.assigned_by)<=256 THEN a.assigned_by ELSE '' END AS assigned_by,
        a.created_at
      FROM finding_assignments a JOIN reviews r ON r.id=a.review_id
      JOIN permitted ON permitted.id=r.repository_id
      ORDER BY a.id LIMIT 101
    ), decisions AS MATERIALIZED (
      SELECT coalesce(jsonb_agg(to_jsonb(decision_rows) ORDER BY decision_rows.id),'[]'::jsonb) AS rows
      FROM decision_rows
    ), assignments AS MATERIALIZED (
      SELECT coalesce(jsonb_agg(to_jsonb(assignment_rows) ORDER BY assignment_rows.id),'[]'::jsonb) AS rows
      FROM assignment_rows
    )
    SELECT CASE WHEN octet_length(decisions.rows::text)+octet_length(assignments.rows::text)<=262144
      THEN decisions.rows ELSE NULL END AS decisions,
      CASE WHEN octet_length(decisions.rows::text)+octet_length(assignments.rows::text)<=262144
      THEN assignments.rows ELSE NULL END AS assignments
    FROM allowed CROSS JOIN decisions CROSS JOIN assignments LIMIT 1`,
    [claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token],
  )) as { rows?: Array<{ decisions: unknown; assignments: unknown }> };

  const row = result.rows?.[0];
  if (!row) return null;
  if (
    !Array.isArray(row.decisions) ||
    !Array.isArray(row.assignments) ||
    row.decisions.length > 100 ||
    row.assignments.length > 100
  )
    fail();

  const decisions = (row.decisions as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const d = raw as DecisionRow;
    if (
      ![d.id, d.repository_id, d.review_repository_id, d.review_id, d.owner, d.actor_id].every(validId) ||
      d.repository_id !== d.review_repository_id ||
      !validText(d.finding_fingerprint, 2048) ||
      !["accepted_risk", "false_positive", "mitigated", "fix_required", "deferred"].includes(d.disposition as string) ||
      !validText(d.reason, 4096) ||
      !validOptionalTime(d.expires_at) ||
      !validDigest(d.evidence_digest) ||
      !validTime(d.created_at)
    )
      fail();
    return {
      id: d.id,
      repositoryId: d.repository_id,
      reviewId: d.review_id,
      findingFingerprint: d.finding_fingerprint,
      disposition: d.disposition,
      reason: d.reason,
      owner: d.owner,
      expiresAt: d.expires_at,
      evidenceDigest: d.evidence_digest,
      actorId: d.actor_id,
      createdAt: d.created_at,
    };
  });

  const assignments = (row.assignments as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const a = raw as AssignmentRow;
    if (
      ![a.id, a.repository_id, a.review_repository_id, a.review_id, a.assignee, a.assigned_by].every(validId) ||
      a.repository_id !== a.review_repository_id ||
      !validText(a.finding_fingerprint, 2048) ||
      !validTime(a.created_at)
    )
      fail();
    return {
      id: a.id,
      repositoryId: a.repository_id,
      reviewId: a.review_id,
      findingFingerprint: a.finding_fingerprint,
      assignee: a.assignee,
      assignedBy: a.assigned_by,
      createdAt: a.created_at,
    };
  });

  if (
    new Set(decisions.map((d) => d.id)).size !== decisions.length ||
    new Set(assignments.map((a) => a.id)).size !== assignments.length
  )
    fail();

  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.claimed-finding-collaboration-snapshot",
      coverage: "authorized-repository-finding-decisions-and-assignments-only",
      exportId: claim.exportId,
      exclusions: ["github-owned-source-and-logs", "artifact-bytes", "publication-or-delivery"],
      decisions,
      assignments,
    }),
    "utf8",
  );
  if (!bytes.length || bytes.length > 256 * 1024) fail();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "application/json",
  };
}
