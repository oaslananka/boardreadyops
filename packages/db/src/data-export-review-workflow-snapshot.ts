import { createHash } from "node:crypto";
import { isValidExportSha256 } from "./data-export-hex-digest.js";
import type { ExportRecordClaim } from "./data-export-record-snapshot.js";
import { isValidExportTimestamp } from "./data-export-timestamp.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export class ExportReviewWorkflowSnapshotUnavailableError extends Error {
  constructor() {
    super("Claimed review workflow metadata is unavailable or exceeds its limits.");
    this.name = "ExportReviewWorkflowSnapshotUnavailableError";
  }
}

export type ClaimedReviewWorkflowSnapshot = {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentType: "application/json";
};

const fail = (): never => {
  throw new ExportReviewWorkflowSnapshotUnavailableError();
};
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && v.trim() === v;
const nullableId = (v: unknown): v is string | null => v === null || id(v);
const bounded = (v: unknown, n: number): v is string => typeof v === "string" && Buffer.byteLength(v, "utf8") <= n;
const optionalText = (v: unknown, n: number): v is string | null => v === null || bounded(v, n);
const time = isValidExportTimestamp;
const optionalTime = (v: unknown): v is string | null => v === null || time(v);
const digest = isValidExportSha256;

interface Approval {
  id: unknown;
  repository_id: unknown;
  parent_repository_id: unknown;
  review_id: unknown;
  revision_id: unknown;
  valid_revision: unknown;
  evidence_digest: unknown;
  approver_id: unknown;
  status: unknown;
  reason: unknown;
  is_break_glass: unknown;
  invalidated_at: unknown;
  invalidated_by: unknown;
  invalidation_reason: unknown;
  created_at: unknown;
  updated_at: unknown;
}
interface Checklist {
  id: unknown;
  repository_id: unknown;
  parent_repository_id: unknown;
  review_id: unknown;
  title: unknown;
  completed: unknown;
  completed_by: unknown;
  completed_at: unknown;
  created_at: unknown;
}

/** Call only inside the original claim's REPEATABLE READ READ ONLY transaction. */
export async function prepareClaimedReviewWorkflowSnapshot(
  db: SqlQueryExecutor,
  claim: ExportRecordClaim,
): Promise<ClaimedReviewWorkflowSnapshot | null> {
  if (![claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token].every(id)) fail();
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
      SELECT repo.id FROM repositories repo JOIN allowed ON allowed.installation_id=repo.installation_id
      WHERE repo.disabled_at IS NULL AND (allowed.scope='organization' OR repo.id=allowed.scope_id)
    ), approval_rows AS (
      SELECT
        CASE WHEN length(a.id)<=256 THEN a.id ELSE '' END AS id,
        CASE WHEN length(a.repository_id)<=256 THEN a.repository_id ELSE '' END AS repository_id,
        CASE WHEN length(r.repository_id)<=256 THEN r.repository_id ELSE '' END AS parent_repository_id,
        CASE WHEN length(a.review_id)<=256 THEN a.review_id ELSE '' END AS review_id,
        CASE WHEN length(a.revision_id)<=256 THEN a.revision_id ELSE '' END AS revision_id,
        EXISTS (SELECT 1 FROM review_revisions rev
          JOIN release_runs run ON run.id=rev.head_run_id AND run.repository_id=r.repository_id
          WHERE rev.id=a.revision_id AND rev.review_id=a.review_id
            AND (rev.base_run_id IS NULL OR EXISTS (
              SELECT 1 FROM release_runs base_run WHERE base_run.id=rev.base_run_id
                AND base_run.repository_id=r.repository_id))) AS valid_revision,
        CASE WHEN octet_length(a.evidence_digest)<=128 THEN a.evidence_digest ELSE '' END AS evidence_digest,
        CASE WHEN length(a.approver_id)<=256 THEN a.approver_id ELSE '' END AS approver_id,
        a.status, CASE WHEN a.reason IS NULL THEN NULL WHEN octet_length(a.reason)<=4096
          THEN a.reason ELSE repeat('x',4097) END AS reason,
        a.is_break_glass,a.invalidated_at,
        CASE WHEN a.invalidated_by IS NULL THEN NULL WHEN length(a.invalidated_by)<=256
          THEN a.invalidated_by ELSE '' END AS invalidated_by,
        CASE WHEN a.invalidation_reason IS NULL THEN NULL WHEN octet_length(a.invalidation_reason)<=4096
          THEN a.invalidation_reason ELSE repeat('x',4097) END AS invalidation_reason,
        a.created_at,a.updated_at
      FROM review_approvals a JOIN reviews r ON r.id=a.review_id
      JOIN permitted ON permitted.id=r.repository_id ORDER BY a.id LIMIT 101
    ), checklist_rows AS (
      SELECT
        CASE WHEN length(item.id)<=256 THEN item.id ELSE '' END AS id,
        CASE WHEN length(item.repository_id)<=256 THEN item.repository_id ELSE '' END AS repository_id,
        CASE WHEN length(r.repository_id)<=256 THEN r.repository_id ELSE '' END AS parent_repository_id,
        CASE WHEN length(item.review_id)<=256 THEN item.review_id ELSE '' END AS review_id,
        CASE WHEN octet_length(item.title)<=4096 THEN item.title ELSE repeat('x',4097) END AS title,
        item.completed, CASE WHEN item.completed_by IS NULL THEN NULL
          WHEN length(item.completed_by)<=256 THEN item.completed_by ELSE '' END AS completed_by,
        item.completed_at,item.created_at
      FROM review_checklist_items item JOIN reviews r ON r.id=item.review_id
      JOIN permitted ON permitted.id=r.repository_id ORDER BY item.id LIMIT 101
    ), approvals AS MATERIALIZED (
      SELECT coalesce(jsonb_agg(to_jsonb(approval_rows) ORDER BY approval_rows.id),'[]'::jsonb) AS rows
      FROM approval_rows
    ), checklist AS MATERIALIZED (
      SELECT coalesce(jsonb_agg(to_jsonb(checklist_rows) ORDER BY checklist_rows.id),'[]'::jsonb) AS rows
      FROM checklist_rows
    )
    SELECT CASE WHEN octet_length(approvals.rows::text)+octet_length(checklist.rows::text)<=262144
      THEN approvals.rows ELSE NULL END AS approvals,
      CASE WHEN octet_length(approvals.rows::text)+octet_length(checklist.rows::text)<=262144
      THEN checklist.rows ELSE NULL END AS checklist
    FROM allowed CROSS JOIN approvals CROSS JOIN checklist LIMIT 1`,
    [claim.exportId, claim.tenantId, claim.installationId, claim.workerId, claim.token],
  )) as { rows?: Array<{ approvals: unknown; checklist: unknown }> };
  const row = result.rows?.[0];
  if (!row) return null;
  if (
    !Array.isArray(row.approvals) ||
    !Array.isArray(row.checklist) ||
    row.approvals.length > 100 ||
    row.checklist.length > 100
  )
    fail();

  const approvalRows = row.approvals as unknown[];
  const checklistRows = row.checklist as unknown[];
  const approvals = approvalRows.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const a = value as Approval;
    if (
      ![a.id, a.repository_id, a.parent_repository_id, a.review_id, a.revision_id, a.approver_id].every(id) ||
      a.repository_id !== a.parent_repository_id ||
      a.valid_revision !== true ||
      !digest(a.evidence_digest) ||
      !["approved", "changes_requested", "invalidated", "dismissed"].includes(a.status as string) ||
      !optionalText(a.reason, 4096) ||
      typeof a.is_break_glass !== "boolean" ||
      !optionalTime(a.invalidated_at) ||
      !nullableId(a.invalidated_by) ||
      !optionalText(a.invalidation_reason, 4096) ||
      !time(a.created_at) ||
      !time(a.updated_at)
    )
      fail();
    return {
      id: a.id,
      repositoryId: a.repository_id,
      reviewId: a.review_id,
      revisionId: a.revision_id,
      evidenceDigest: a.evidence_digest,
      approverId: a.approver_id,
      status: a.status,
      reason: a.reason,
      isBreakGlass: a.is_break_glass,
      invalidatedAt: a.invalidated_at,
      invalidatedBy: a.invalidated_by,
      invalidationReason: a.invalidation_reason,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    };
  });
  const checklistItems = checklistRows.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const item = value as Checklist;
    if (
      ![item.id, item.repository_id, item.parent_repository_id, item.review_id].every(id) ||
      item.repository_id !== item.parent_repository_id ||
      !bounded(item.title, 4096) ||
      typeof item.completed !== "boolean" ||
      !nullableId(item.completed_by) ||
      !optionalTime(item.completed_at) ||
      !time(item.created_at)
    )
      fail();
    return {
      id: item.id,
      repositoryId: item.repository_id,
      reviewId: item.review_id,
      title: item.title,
      completed: item.completed,
      completedBy: item.completed_by,
      completedAt: item.completed_at,
      createdAt: item.created_at,
    };
  });
  if (
    new Set(approvals.map((a) => a.id)).size !== approvals.length ||
    new Set(checklistItems.map((c) => c.id)).size !== checklistItems.length
  )
    fail();
  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.claimed-review-workflow-snapshot",
      coverage: "authorized-repository-review-approvals-and-checklist-only",
      exportId: claim.exportId,
      exclusions: ["audit-event-metadata", "source-code", "artifact-content", "finding-decisions-and-assignments"],
      approvals,
      checklistItems,
    }),
    "utf8",
  );
  if (bytes.length === 0 || bytes.length > 262144) fail();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "application/json",
  };
}
