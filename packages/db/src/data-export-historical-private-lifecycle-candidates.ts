import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * Internal, source-only review of the last nine no-FK export/OAuth lifecycle
 * classes. Never a customer export, ownership proof or disclosure gate.
 *
 * Three further no-FK classes are platform operations, not customer payloads:
 * cloud_schema_migrations, component_lifecycle_observations, control_plane_jobs.
 * This review deliberately does not query their rows.
 */
export type HistoricalUserPrivateLifecycleCandidates = {
  status: "historical-private-control-records-not-customer-payload";
  releaseDecision: "NO_GO";
  reviewedUnlinkedPrivateClasses: 9;
  classifiedPlatformOnlyClasses: readonly [
    "cloud_schema_migrations",
    "component_lifecycle_observations",
    "control_plane_jobs",
  ];
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  independentArchiveCompletenessVerified: false;
  platformOperationalRecordsExcludedFromCustomerPayload: true;
  historicalTenantLoginIsNotIdentity: true;
  competingOrUnboundInstallationIdentity: boolean;
  conflictingOriginalNumericIdDetected: boolean;
  exportReservationTenantMismatchDetected: boolean;
  candidateCounts: {
    artifactExportCopyReservations: number;
    tenantLoginOnlyUnlinkFences: number;
    legacyArchiveCommitments: number;
    liveOAuthProofs: number;
    oauthChallenges: number;
    partialCleanupEvents: number;
    partialReadReservations: number;
    privateDeliveryPreflights: number;
    privatePreflightEvents: number;
  };
};

const validUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const maxCandidates = 100;

const counts = [
  ["copy_reservations", "public.artifact_export_copy_reservations r", "r.export_id=target.id"],
  ["unlink_fences", "public.artifact_unlink_fences f", "f.tenant_key=lower(target.tenant_id)"],
  ["archive_commitments", "public.data_export_archive_commitments a", "a.export_id=target.id"],
  ["live_oauth_proofs", "public.historical_user_live_oauth_verified_proofs p", "p.export_id=target.id"],
  ["oauth_challenges", "public.historical_user_oauth_challenges c", "c.export_id=target.id"],
  ["cleanup_events", "public.historical_user_partial_cleanup_events e", "e.export_id=target.id"],
  ["read_reservations", "public.historical_user_partial_read_reservations r", "r.export_id=target.id"],
  ["private_preflights", "public.historical_user_private_delivery_preflights p", "p.export_id=target.id"],
  [
    "private_events",
    "public.historical_user_private_preflight_events e JOIN public.historical_user_private_delivery_preflights p ON p.id=e.preflight_id",
    "p.export_id=target.id",
  ],
] as const;

type CountName = (typeof counts)[number][0];
const countNames = counts.map(([key]) => key);
const sql = [
  "WITH",
  historicalOwnerCtes,
  "SELECT target.id AS export_id,",
  "EXISTS(SELECT 1 FROM former_installations) AS retained_suspended_user,",
  "EXISTS(SELECT 1 FROM public.installations i",
  "WHERE lower(i.account_type)='user'",
  "AND lower(i.account_login)=lower(target.tenant_id)",
  "AND i.account_user_id IS DISTINCT FROM target.original_github_user_id)",
  "AS competing_or_unbound_installation_identity,",
  "EXISTS(SELECT 1 FROM public.artifact_export_copy_reservations r",
  "WHERE r.export_id=target.id AND r.tenant_key<>lower(target.tenant_id))",
  "AS export_reservation_tenant_mismatch,",
  "(",
  "EXISTS(SELECT 1 FROM public.historical_user_live_oauth_verified_proofs p",
  "WHERE p.export_id=target.id AND p.original_github_user_id<>target.original_github_user_id)",
  "OR EXISTS(SELECT 1 FROM public.historical_user_oauth_challenges c",
  "WHERE c.export_id=target.id AND c.original_github_user_id<>target.original_github_user_id)",
  "OR EXISTS(SELECT 1 FROM public.historical_user_partial_cleanup_events e",
  "WHERE e.export_id=target.id AND e.original_github_user_id<>target.original_github_user_id)",
  "OR EXISTS(SELECT 1 FROM public.historical_user_partial_read_reservations r",
  "WHERE r.export_id=target.id AND r.original_github_user_id<>target.original_github_user_id)",
  "OR EXISTS(SELECT 1 FROM public.historical_user_private_delivery_preflights p",
  "WHERE p.export_id=target.id AND p.original_github_user_id<>target.original_github_user_id)",
  ") AS conflicting_numeric_identity,",
  counts
    .map(
      ([key, table, where]) =>
        `(SELECT count(*)::integer FROM (SELECT 1 FROM ${table} WHERE ${where} LIMIT 101) bounded) AS ${key}`,
    )
    .join(","),
  "FROM owner_export target LIMIT 1",
].join(" ");

type ReviewRow = Record<CountName, number> & {
  export_id: string;
  retained_suspended_user: boolean;
  competing_or_unbound_installation_identity: boolean;
  export_reservation_tenant_mismatch: boolean;
  conflicting_numeric_identity: boolean;
};

function isReviewRow(row: unknown, exportId: string): row is ReviewRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  return (
    value.export_id === exportId &&
    value.retained_suspended_user === true &&
    typeof value.competing_or_unbound_installation_identity === "boolean" &&
    typeof value.export_reservation_tenant_mismatch === "boolean" &&
    typeof value.conflicting_numeric_identity === "boolean" &&
    countNames.every(
      (key) =>
        Number.isSafeInteger(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= maxCandidates,
    )
  );
}

/**
 * Nine bounded classes only; no row IDs, OAuth state hashes or artifacts.
 * A reused tenant login and an unbound deletion fence are never owner proof.
 * This private report is intentionally NOT wired into any customer endpoint.
 */
export async function assessHistoricalUserPrivateLifecycleCandidates(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserPrivateLifecycleCandidates | null> {
  if (
    !db?.withTransaction ||
    !validUuid.test(input?.exportId) ||
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
        if (!isReviewRow(row, authority.exportId)) return null;
        // Contradictory immutable owner IDs or cross-tenant export reservations
        // are a source-integrity failure, not a valid review candidate.
        if (row.conflicting_numeric_identity || row.export_reservation_tenant_mismatch) return null;
        return {
          status: "historical-private-control-records-not-customer-payload",
          releaseDecision: "NO_GO",
          reviewedUnlinkedPrivateClasses: 9,
          classifiedPlatformOnlyClasses: [
            "cloud_schema_migrations",
            "component_lifecycle_observations",
            "control_plane_jobs",
          ],
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          originalUserOwnershipVerified: false,
          independentArchiveCompletenessVerified: false,
          platformOperationalRecordsExcludedFromCustomerPayload: true,
          historicalTenantLoginIsNotIdentity: true,
          competingOrUnboundInstallationIdentity: row.competing_or_unbound_installation_identity,
          conflictingOriginalNumericIdDetected: false,
          exportReservationTenantMismatchDetected: false,
          candidateCounts: {
            artifactExportCopyReservations: row.copy_reservations,
            tenantLoginOnlyUnlinkFences: row.unlink_fences,
            legacyArchiveCommitments: row.archive_commitments,
            liveOAuthProofs: row.live_oauth_proofs,
            oauthChallenges: row.oauth_challenges,
            partialCleanupEvents: row.cleanup_events,
            partialReadReservations: row.read_reservations,
            privateDeliveryPreflights: row.private_preflights,
            privatePreflightEvents: row.private_events,
          },
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
