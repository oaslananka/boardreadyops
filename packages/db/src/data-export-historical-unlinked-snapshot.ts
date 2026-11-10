import { createHash } from "node:crypto";
import { assessHistoricalUserBillingOwnershipCandidates } from "./data-export-historical-billing-ownership-candidates.js";
import { assessHistoricalUserExportIdentityReview } from "./data-export-historical-export-identity-review.js";
import { assessHistoricalUserPrivateLifecycleCandidates } from "./data-export-historical-private-lifecycle-candidates.js";
import { assessHistoricalUserSchemaCoverage } from "./data-export-historical-schema-coverage.js";
import { assessHistoricalUserTenantOnlyLifecycleCandidates } from "./data-export-historical-tenant-lifecycle-candidates.js";
import { assessHistoricalUserUnresolvedSourceLineage } from "./data-export-historical-unresolved-lineage.js";
import { assessHistoricalUserWorkspaceCandidates } from "./data-export-historical-workspace-candidates.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/** No-FK candidates have no general ownership or customer-delivery entitlement.
 * This private digest binds bounded count-only reviews to ONE PG snapshot;
 * it is neither an all-row digest nor an atomic DB/filesystem export seal.
 */
export type HistoricalUnlinkedSnapshot = {
  status: "unlinked-source-candidates-unapproved";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  originalUserOwnershipVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  reviewedCandidateClasses: 26;
  excludedPlatformClasses: 3;
  countOnlySnapshotSha256: string;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const domain = "boardreadyops:historical-user:unlinked-counts:v1\0";
const platformTables = ["cloud_schema_migrations", "component_lifecycle_observations", "control_plane_jobs"];
const candidateTables = [
  "data_exports",
  "retention_policies",
  "legal_holds",
  "erasure_requests",
  "product_events",
  "billing_activity",
  "billing_customers",
  "billing_events",
  "billing_subscriptions",
  "github_marketplace_subscriptions",
  "workspaces",
  "projects",
  "workspace_members",
  "workspace_member_audit_events",
  "workspace_memberships",
  "review_policies",
  "review_policy_audit_events",
  "artifact_export_copy_reservations",
  "artifact_unlink_fences",
  "data_export_archive_commitments",
  "historical_user_live_oauth_verified_proofs",
  "historical_user_oauth_challenges",
  "historical_user_partial_cleanup_events",
  "historical_user_partial_read_reservations",
  "historical_user_private_delivery_preflights",
  "historical_user_private_preflight_events",
] as const;
const noFkSet = new Set<string>([...candidateTables, ...platformTables]);

export async function assessHistoricalUserUnlinkedSnapshot(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUnlinkedSnapshot | null> {
  if (
    !db?.withTransaction ||
    !uuid.test(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0 ||
    candidateTables.length !== 26 ||
    platformTables.length !== 3 ||
    noFkSet.size !== 29
  )
    return null;
  const identity = { exportId: input.exportId, verifiedGitHubUserId: input.verifiedGitHubUserId };
  try {
    return await db.withTransaction(
      async (tx) => {
        const shared = {
          async withTransaction<T>(
            work: (transaction: typeof tx) => Promise<T>,
            options?: { consistentRead?: true; statementTimeoutMs?: number },
          ): Promise<T> {
            if (options?.consistentRead !== true || options.statementTimeoutMs !== 5000)
              throw new Error("Historical source review escaped the pinned read-only snapshot");
            return work(tx);
          },
        };
        const schema = await assessHistoricalUserSchemaCoverage(shared);
        if (
          schema.status !== "known_schema_scope_unapproved" ||
          schema.tableCount !== 92 ||
          typeof schema.schemaSha256 !== "string" ||
          !sha256.test(schema.schemaSha256)
        )
          return null;
        const lineage = await assessHistoricalUserUnresolvedSourceLineage(shared);
        if (
          lineage?.releaseDecision !== "NO_GO" ||
          lineage.reviewedClasses !== 63 ||
          lineage.entries.length !== 63 ||
          lineage.noPathCount !== 29 ||
          lineage.pathToInstallationCount !== 34
        )
          return null;
        const actualUnlinked = lineage.entries
          .filter((entry) => entry.installationPath === null)
          .map((entry) => entry.table);
        if (new Set(actualUnlinked).size !== 29 || actualUnlinked.some((table) => !noFkSet.has(table))) return null;

        // Each existing assessor repeats the exact original numeric USER, pending
        // uninstall, suspended-installation, hold and erasure checks on this tx.
        // Missing or invalid evidence aborts the whole internal observation.
        const exportReview = await assessHistoricalUserExportIdentityReview(shared, identity);
        const lifecycle = await assessHistoricalUserTenantOnlyLifecycleCandidates(shared, identity);
        const billing = await assessHistoricalUserBillingOwnershipCandidates(shared, identity);
        const workspace = await assessHistoricalUserWorkspaceCandidates(shared, identity);
        const privateRecords = await assessHistoricalUserPrivateLifecycleCandidates(shared, identity);
        if (
          !exportReview ||
          !lifecycle ||
          !billing ||
          !workspace ||
          !privateRecords ||
          [exportReview, lifecycle, billing, workspace, privateRecords].some(
            (report) =>
              report.releaseDecision !== "NO_GO" ||
              report.completeCustomerExport !== false ||
              report.customerDeliveryAllowed !== false,
          ) ||
          exportReview.independentOwnershipComplete !== false ||
          lifecycle.releaseDecision !== "NO_GO" ||
          lifecycle.reviewedUnlinkedClasses !== 4 ||
          billing.releaseDecision !== "NO_GO" ||
          billing.reviewedUnlinkedClasses !== 5 ||
          workspace.releaseDecision !== "NO_GO" ||
          workspace.reviewedUnlinkedClasses !== 7 ||
          privateRecords.releaseDecision !== "NO_GO" ||
          privateRecords.reviewedUnlinkedPrivateClasses !== 9 ||
          privateRecords.classifiedPlatformOnlyClasses.length !== 3 ||
          privateRecords.classifiedPlatformOnlyClasses.some((name, index) => name !== platformTables[index])
        )
          return null;

        // Not a row digest: count-preserving edits and ABA still require separate
        // epoch + physical artifact evidence. Only internal counts/flags hashed.
        const message = Buffer.from(
          JSON.stringify([
            identity.exportId,
            identity.verifiedGitHubUserId,
            schema.schemaSha256,
            exportReview,
            lifecycle,
            billing,
            workspace,
            privateRecords,
          ]),
          "utf8",
        );
        try {
          return {
            status: "unlinked-source-candidates-unapproved",
            releaseDecision: "NO_GO",
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
            originalUserOwnershipVerified: false,
            thirdPartyDisclosureRightsVerified: false,
            reviewedCandidateClasses: 26,
            excludedPlatformClasses: 3,
            countOnlySnapshotSha256: createHash("sha256").update(domain).update(message).digest("hex"),
          };
        } finally {
          message.fill(0);
        }
      },
      { consistentRead: true, statementTimeoutMs: 10000 },
    );
  } catch {
    return null;
  }
}
