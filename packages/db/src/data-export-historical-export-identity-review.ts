import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * Original numeric GitHub USER lifecycle source review, never customer export.
 *
 * Reused usernames and legacy login-only requests MUST NOT be attributed to
 * the original owner. Counts describe potential review work, not lawful rights.
 * Never select URLs, archive manifests, tokens, raw IDs, or customer bytes.
 */
export type HistoricalUserExportIdentityReview = {
  status: "historical-export-identity-review-only";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  sourceRightsVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  attributedSameLoginCount: number;
  sameNumericIdOtherLoginCount: number;
  legacyLoginOnlyCount: number;
  foreignNumericIdSameLoginCount: number;
  otherSameLoginCount: number;
  candidateCount: number;
  independentOwnershipComplete: false;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const maxRows = 100;

const sourceSql = [
  "WITH",
  historicalOwnerCtes,
  ",",
  "candidates AS MATERIALIZED (",
  " SELECT e.original_github_user_id, lower(e.tenant_id) AS login,",
  " e.scope, lower(e.scope_id) AS scope_login, e.requested_by, e.installation_id",
  " FROM public.data_exports e CROSS JOIN owner_export target",
  " WHERE e.original_github_user_id=target.original_github_user_id",
  " OR lower(e.tenant_id)=lower(target.tenant_id)",
  " ORDER BY e.id LIMIT 101",
  "), totals AS (",
  " SELECT count(*)::integer AS candidate_count,",
  " count(*) FILTER (WHERE c.original_github_user_id=target.original_github_user_id",
  " AND c.login=lower(target.tenant_id) AND c.scope='user'",
  " AND c.scope_login=c.login AND c.requested_by='github_app_uninstall'",
  " AND c.installation_id IS NULL)::integer AS attributed_same_login_count,",
  " count(*) FILTER (WHERE c.original_github_user_id=target.original_github_user_id",
  " AND c.login<>lower(target.tenant_id))::integer AS same_numeric_id_other_login_count,",
  " count(*) FILTER (WHERE c.original_github_user_id IS NULL",
  " AND c.login=lower(target.tenant_id) AND c.scope='user'",
  " AND c.requested_by='github_app_uninstall')::integer AS legacy_login_only_count,",
  " count(*) FILTER (WHERE c.original_github_user_id IS NOT NULL",
  " AND c.original_github_user_id<>target.original_github_user_id",
  " AND c.login=lower(target.tenant_id))::integer AS foreign_numeric_id_same_login_count",
  " FROM candidates c CROSS JOIN owner_export target",
  ")",
  "SELECT target.id AS export_id,",
  " EXISTS(SELECT 1 FROM former_installations) AS retained_suspended_installation,",
  " totals.candidate_count, totals.attributed_same_login_count,",
  " totals.same_numeric_id_other_login_count, totals.legacy_login_only_count,",
  " totals.foreign_numeric_id_same_login_count",
  " FROM owner_export target CROSS JOIN totals LIMIT 1",
].join(" ");

type ReviewRow = {
  export_id: string;
  retained_suspended_installation: boolean;
  candidate_count: number;
  attributed_same_login_count: number;
  same_numeric_id_other_login_count: number;
  legacy_login_only_count: number;
  foreign_numeric_id_same_login_count: number;
};

function validReviewRow(row: unknown, exportId: string): row is ReviewRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  const keys = [
    "candidate_count",
    "attributed_same_login_count",
    "same_numeric_id_other_login_count",
    "legacy_login_only_count",
    "foreign_numeric_id_same_login_count",
  ];
  return (
    value.export_id === exportId &&
    value.retained_suspended_installation === true &&
    keys.every(
      (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= maxRows,
    )
  );
}

/**
 * Read only counts of same-numeric USER or same-login potential lifecycle
 * records, bounded to 100. No external consumer is authorized to deliver
 * any class based on this private review.
 */
export async function assessHistoricalUserExportIdentityReview(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserExportIdentityReview | null> {
  if (
    !db?.withTransaction ||
    !uuid.test(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;
  const authority = { exportId: input.exportId, verifiedGitHubUserId: input.verifiedGitHubUserId };
  try {
    return await db.withTransaction(
      async (tx) => {
        const response: unknown = await tx.query(sourceSql, [authority.exportId, authority.verifiedGitHubUserId]);
        if (
          !response ||
          typeof response !== "object" ||
          !("rows" in response) ||
          !Array.isArray(response.rows) ||
          response.rows.length !== 1
        )
          return null;
        const row: unknown = response.rows[0];
        if (!validReviewRow(row, authority.exportId)) return null;
        const candidateCount = row.candidate_count;
        const attributedSameLoginCount = row.attributed_same_login_count;
        const sameNumericIdOtherLoginCount = row.same_numeric_id_other_login_count;
        const legacyLoginOnlyCount = row.legacy_login_only_count;
        const foreignNumericIdSameLoginCount = row.foreign_numeric_id_same_login_count;
        const knownCount =
          attributedSameLoginCount +
          sameNumericIdOtherLoginCount +
          legacyLoginOnlyCount +
          foreignNumericIdSameLoginCount;
        if (
          candidateCount < 1 ||
          candidateCount > maxRows ||
          attributedSameLoginCount < 1 ||
          knownCount > candidateCount
        )
          return null;
        return {
          status: "historical-export-identity-review-only",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          sourceRightsVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          attributedSameLoginCount,
          sameNumericIdOtherLoginCount,
          legacyLoginOnlyCount,
          foreignNumericIdSameLoginCount,
          otherSameLoginCount: candidateCount - knownCount,
          candidateCount,
          independentOwnershipComplete: false,
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
