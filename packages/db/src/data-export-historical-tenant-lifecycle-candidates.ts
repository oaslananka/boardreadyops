import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * INTERNAL historical original-GitHub-USER source review for four tenant-login
 * keyed lifecycle classes with NO immutable FK to installations. Numeric USER
 * authority is necessary for the READ, but NEVER attributes these rows.
 * No personal data, source bytes, tokens, URL, row identifiers or payloads.
 */
export type HistoricalUserTenantOnlyLifecycleReview = {
  status: "tenant-login-lifecycle-candidates-unattributable";
  releaseDecision: "NO_GO";
  reviewedUnlinkedClasses: 4;
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  tenantLoginAloneProvesNothing: true;
  competingOrUnboundInstallationIdentity: boolean;
  loginOnlyCandidateCounts: {
    retentionPolicies: number;
    legalHolds: number;
    erasureRequests: number;
    productEvents: number;
  };
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const maxPerSource = 100;

/** Each count visits at most 101 rows. Never count an unbounded tenant. */
const sourceSql = [
  "WITH",
  historicalOwnerCtes,
  "SELECT target.id AS export_id,",
  "EXISTS(SELECT 1 FROM former_installations) AS retained_suspended_installation,",
  "EXISTS(SELECT 1 FROM public.installations other WHERE lower(other.account_login)=lower(target.tenant_id)",
  "AND lower(other.account_type)='user'",
  "AND other.account_user_id IS DISTINCT FROM target.original_github_user_id)",
  "AS competing_or_unbound_installation_identity,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.retention_policies p",
  "WHERE lower(p.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS retention_policies,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.legal_holds p",
  "WHERE lower(p.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS legal_holds,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.erasure_requests p",
  "WHERE lower(p.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS erasure_requests,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.product_events p",
  "WHERE lower(p.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS product_events",
  "FROM owner_export target LIMIT 1",
].join(" ");

type CountRow = {
  export_id: string;
  retained_suspended_installation: boolean;
  competing_or_unbound_installation_identity: boolean;
  retention_policies: number;
  legal_holds: number;
  erasure_requests: number;
  product_events: number;
};

function validCountRow(row: unknown, exportId: string): row is CountRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const candidate = row as Record<string, unknown>;
  return (
    candidate.export_id === exportId &&
    candidate.retained_suspended_installation === true &&
    typeof candidate.competing_or_unbound_installation_identity === "boolean" &&
    ["retention_policies", "legal_holds", "erasure_requests", "product_events"].every(
      (key) =>
        Number.isSafeInteger(candidate[key]) &&
        (candidate[key] as number) >= 0 &&
        (candidate[key] as number) <= maxPerSource,
    )
  );
}

/**
 * A same-login match is merely a candidate for manual historical-owner
 * review, not proof of owning or legally receiving any lifecycle record.
 * A missing original numeric USER binding, hold, erasure, or invalid catalog
 * MUST fail closed. Never invoke this as a customer delivery gate.
 */
export async function assessHistoricalUserTenantOnlyLifecycleCandidates(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserTenantOnlyLifecycleReview | null> {
  if (
    !db?.withTransaction ||
    !uuid.test(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;
  // Freeze caller-owned mutable objects before starting the async transaction.
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
        if (!validCountRow(row, authority.exportId)) return null;
        return {
          status: "tenant-login-lifecycle-candidates-unattributable",
          releaseDecision: "NO_GO",
          reviewedUnlinkedClasses: 4,
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          originalUserOwnershipVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          tenantLoginAloneProvesNothing: true,
          competingOrUnboundInstallationIdentity: row.competing_or_unbound_installation_identity,
          loginOnlyCandidateCounts: {
            retentionPolicies: row.retention_policies,
            legalHolds: row.legal_holds,
            erasureRequests: row.erasure_requests,
            productEvents: row.product_events,
          },
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
