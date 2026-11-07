import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * INTERNAL, source-review-only counts for five unlinked billing classes.
 * An exact provider numeric account ID is stronger identity evidence than
 * a recycled tenant/login; neither proves legal rights to provider payloads.
 * This function NEVER returns provider data, payment amounts or customer IDs.
 */
export type HistoricalUserBillingOwnershipCandidates = {
  status: "billing-provider-and-login-candidates-unapproved";
  releaseDecision: "NO_GO";
  reviewedUnlinkedClasses: 5;
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  providerDisclosureRightsVerified: false;
  customerFinancialDataDisclosureVerified: false;
  billingEventsWithoutTenantUnresolved: true;
  competingOrUnboundInstallationIdentity: boolean;
  exactNumericMarketplaceAccountCount: number;
  marketplaceSameLoginDifferentNumericAccounts: number;
  exactNumericMarketplaceLoginChanged: boolean;
  loginOnlyBillingCandidateCounts: {
    customers: number;
    subscriptions: number;
    eventsWithTenant: number;
    activity: number;
  };
};

const isUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const maxCount = 100;

const sourceSql = [
  "WITH",
  historicalOwnerCtes,
  "SELECT target.id AS export_id,",
  "EXISTS(SELECT 1 FROM former_installations) AS has_suspended_original_user,",
  "EXISTS(SELECT 1 FROM public.installations i WHERE lower(i.account_login)=lower(target.tenant_id)",
  "AND lower(i.account_type)='user'",
  "AND i.account_user_id IS DISTINCT FROM target.original_github_user_id)",
  "AS competing_or_unbound_installation_identity,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.billing_customers b",
  "WHERE lower(b.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS billing_customers,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.billing_subscriptions b",
  "WHERE lower(b.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS billing_subscriptions,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.billing_events b",
  "WHERE lower(b.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS billing_events,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.billing_activity b",
  "WHERE lower(b.tenant_id)=lower(target.tenant_id) LIMIT 101) bounded) AS billing_activity,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.github_marketplace_subscriptions m",
  "WHERE m.github_account_id=target.original_github_user_id LIMIT 101) bounded)",
  "AS numeric_marketplace_count,",
  "(SELECT count(*)::integer FROM (SELECT 1 FROM public.github_marketplace_subscriptions m",
  "WHERE lower(m.account_login)=lower(target.tenant_id)",
  "AND m.github_account_id<>target.original_github_user_id LIMIT 101) bounded)",
  "AS foreign_numeric_marketplace_same_login,",
  "EXISTS(SELECT 1 FROM public.github_marketplace_subscriptions m",
  "WHERE m.github_account_id=target.original_github_user_id",
  "AND lower(m.account_login)<>lower(target.tenant_id)) AS numeric_marketplace_login_changed",
  "FROM owner_export target LIMIT 1",
].join(" ");

type SourceRow = {
  export_id: string;
  has_suspended_original_user: boolean;
  competing_or_unbound_installation_identity: boolean;
  billing_customers: number;
  billing_subscriptions: number;
  billing_events: number;
  billing_activity: number;
  numeric_marketplace_count: number;
  foreign_numeric_marketplace_same_login: number;
  numeric_marketplace_login_changed: boolean;
};

function validSourceRow(row: unknown, exportId: string): row is SourceRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  return (
    value.export_id === exportId &&
    value.has_suspended_original_user === true &&
    typeof value.competing_or_unbound_installation_identity === "boolean" &&
    typeof value.numeric_marketplace_login_changed === "boolean" &&
    [
      "billing_customers",
      "billing_subscriptions",
      "billing_events",
      "billing_activity",
      "numeric_marketplace_count",
      "foreign_numeric_marketplace_same_login",
    ].every(
      (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= maxCount,
    ) &&
    (value.numeric_marketplace_count as number) <= 1
  );
}

/**
 * The provider's unscoped events, private payloads and financial records are
 * intentionally excluded. A numeric ID proves ONLY which GitHub account a
 * Marketplace record names; never customer rights or a complete invoice ZIP.
 */
export async function assessHistoricalUserBillingOwnershipCandidates(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserBillingOwnershipCandidates | null> {
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
        if (!validSourceRow(row, authority.exportId)) return null;
        return {
          status: "billing-provider-and-login-candidates-unapproved",
          releaseDecision: "NO_GO",
          reviewedUnlinkedClasses: 5,
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          originalUserOwnershipVerified: false,
          providerDisclosureRightsVerified: false,
          customerFinancialDataDisclosureVerified: false,
          billingEventsWithoutTenantUnresolved: true,
          competingOrUnboundInstallationIdentity: row.competing_or_unbound_installation_identity,
          exactNumericMarketplaceAccountCount: row.numeric_marketplace_count,
          marketplaceSameLoginDifferentNumericAccounts: row.foreign_numeric_marketplace_same_login,
          exactNumericMarketplaceLoginChanged: row.numeric_marketplace_login_changed,
          loginOnlyBillingCandidateCounts: {
            customers: row.billing_customers,
            subscriptions: row.billing_subscriptions,
            eventsWithTenant: row.billing_events,
            activity: row.billing_activity,
          },
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
