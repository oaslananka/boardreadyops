import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * INTERNAL source-only structural candidate counts across seven workspace,
 * project, policy and audit classes lacking an FK path to installations.
 * Numeric identity matches prove an ACTOR/MEMBER, not workspace ownership,
 * the lawful right to distribute collaborative material or completeness.
 */
export type HistoricalUserWorkspaceCandidateReview = {
  status: "collaboration-candidates-not-customer-ownership";
  releaseDecision: "NO_GO";
  reviewedUnlinkedClasses: 7;
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  allWorkspaceMembersConsented: false;
  thirdPartyDisclosureRightsVerified: false;
  orphanedWorkspaceAndAuditRowsUnresolved: true;
  competingOrUnboundInstallationIdentity: boolean;
  candidateCounts: {
    workspacesWithNumericMember: number;
    workspacesWithUnboundLoginMember: number;
    projectsInNumericallyJoinedWorkspaces: number;
    numericWorkspaceMemberships: number;
    unboundLoginWorkspaceMemberships: number;
    auditEventsActedByNumericUser: number;
    auditEventsAboutNumericUser: number;
    billingSeatMembershipsWithLogin: number;
    reviewPoliciesWithLogin: number;
    policyAuditEventsActedByNumericUser: number;
    policyAuditEventsWithLoginButOtherNumericActor: number;
  };
};

const isUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const maxCount = 100;

// Every bounded count is a correlated SELECT 1 ... LIMIT 101, never a raw
// customer row or an unbounded event scan; the outer result contains counts only.
const projections = [
  [
    "workspaces_numeric",
    "public.workspaces w",
    "EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.github_user_id=target.original_github_user_id)",
  ],
  [
    "workspaces_legacy",
    "public.workspaces w",
    "EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.github_user_id IS NULL AND lower(m.user_id)=lower(target.tenant_id))",
  ],
  [
    "projects_numeric",
    "public.projects p",
    "EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p.workspace_id AND m.github_user_id=target.original_github_user_id)",
  ],
  ["members_numeric", "public.workspace_members m", "m.github_user_id=target.original_github_user_id"],
  [
    "members_legacy",
    "public.workspace_members m",
    "m.github_user_id IS NULL AND lower(m.user_id)=lower(target.tenant_id)",
  ],
  [
    "member_audit_actor",
    "public.workspace_member_audit_events e",
    "e.actor_github_user_id=target.original_github_user_id",
  ],
  [
    "member_audit_subject",
    "public.workspace_member_audit_events e",
    "e.subject_github_user_id=target.original_github_user_id",
  ],
  ["billing_seats", "public.workspace_memberships s", "lower(s.tenant_id)=lower(target.tenant_id)"],
  ["review_policies", "public.review_policies p", "lower(p.tenant_id)=lower(target.tenant_id)"],
  [
    "policy_audit_actor",
    "public.review_policy_audit_events e",
    "e.actor_github_user_id=target.original_github_user_id",
  ],
  [
    "policy_audit_other",
    "public.review_policy_audit_events e",
    "lower(e.tenant_id)=lower(target.tenant_id) AND e.actor_github_user_id<>target.original_github_user_id",
  ],
] as const;
type CountKey = (typeof projections)[number][0];
const countKeys = projections.map(([key]) => key);

const sql = [
  "WITH",
  historicalOwnerCtes,
  "SELECT target.id AS export_id,",
  "EXISTS(SELECT 1 FROM former_installations) AS retained_suspended_user,",
  "EXISTS (SELECT 1 FROM public.installations other",
  "WHERE lower(other.account_login)=lower(target.tenant_id)",
  "AND lower(other.account_type)='user'",
  "AND other.account_user_id IS DISTINCT FROM target.original_github_user_id)",
  "AS competing_or_unbound_installation_identity,",
  projections
    .map(
      ([key, source, where]) =>
        "(SELECT count(*)::integer FROM (SELECT 1 FROM " +
        source +
        " WHERE " +
        where +
        " LIMIT 101) bounded) AS " +
        key,
    )
    .join(","),
  "FROM owner_export target LIMIT 1",
].join(" ");

type CountRow = Record<CountKey, number> & {
  export_id: string;
  retained_suspended_user: boolean;
  competing_or_unbound_installation_identity: boolean;
};

function validRow(row: unknown, exportId: string): row is CountRow {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  return (
    record.export_id === exportId &&
    record.retained_suspended_user === true &&
    typeof record.competing_or_unbound_installation_identity === "boolean" &&
    countKeys.every(
      (key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0 && (record[key] as number) <= maxCount,
    )
  );
}

/** Private NO_GO report, never a ZIP/HTTP entitlement or a legal-right proof. */
export async function assessHistoricalUserWorkspaceCandidates(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserWorkspaceCandidateReview | null> {
  if (
    !db?.withTransaction ||
    !isUuid.test(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;
  const authority = { exportId: input.exportId, verifiedGitHubUserId: input.verifiedGitHubUserId };
  try {
    return await db.withTransaction(
      async (tx) => {
        const response: unknown = await tx.query(sql, [authority.exportId, authority.verifiedGitHubUserId]);
        if (
          !response ||
          typeof response !== "object" ||
          !("rows" in response) ||
          !Array.isArray(response.rows) ||
          response.rows.length !== 1
        )
          return null;
        const row: unknown = response.rows[0];
        if (!validRow(row, authority.exportId)) return null;
        return {
          status: "collaboration-candidates-not-customer-ownership",
          releaseDecision: "NO_GO",
          reviewedUnlinkedClasses: 7,
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          originalUserOwnershipVerified: false,
          allWorkspaceMembersConsented: false,
          thirdPartyDisclosureRightsVerified: false,
          orphanedWorkspaceAndAuditRowsUnresolved: true,
          competingOrUnboundInstallationIdentity: row.competing_or_unbound_installation_identity,
          candidateCounts: {
            workspacesWithNumericMember: row.workspaces_numeric,
            workspacesWithUnboundLoginMember: row.workspaces_legacy,
            projectsInNumericallyJoinedWorkspaces: row.projects_numeric,
            numericWorkspaceMemberships: row.members_numeric,
            unboundLoginWorkspaceMemberships: row.members_legacy,
            auditEventsActedByNumericUser: row.member_audit_actor,
            auditEventsAboutNumericUser: row.member_audit_subject,
            billingSeatMembershipsWithLogin: row.billing_seats,
            reviewPoliciesWithLogin: row.review_policies,
            policyAuditEventsActedByNumericUser: row.policy_audit_actor,
            policyAuditEventsWithLoginButOtherNumericActor: row.policy_audit_other,
          },
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
