import { createHash } from "node:crypto";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * SOURCE-ONLY SCHEMA CONTRACT, NOT a customer-export allowance.
 *
 * This is the observed PostgreSQL 17 source schema after migrations through
 * 0126, including private historical audit. Every table is intentionally
 * listed: silently adding a new persistence data class MUST NOT silently
 * change the meaning of "complete original USER export".
 *
 * These are PUBLIC SCHEMA OBJECT NAMES, never user identities or row values.
 * Update this registry/hash only after a scoped retention/IP review when a
 * migration intentionally changes the database contract.
 */
const knownTables = [
  "api_tokens",
  "artifact_deletion_jobs",
  "artifact_export_copy_reservations",
  "artifact_unlink_fences",
  "artifacts",
  "audit_events",
  "billing_activity",
  "billing_customers",
  "billing_events",
  "billing_subscriptions",
  "board_bom_components",
  "board_bom_snapshots",
  "board_supply_findings",
  "board_supply_watch",
  "boards",
  "cloud_schema_migrations",
  "component_lifecycle_observations",
  "control_plane_jobs",
  "control_plane_outbox",
  "control_plane_reconciliation_items",
  "control_plane_replay_operations",
  "data_export_archive_commitments",
  "data_exports",
  "deliveries",
  "erasure_requests",
  "external_review_invitations",
  "finding_assignments",
  "finding_decisions",
  "findings",
  "github_marketplace_subscriptions",
  "historical_user_live_oauth_verified_proofs",
  "historical_user_oauth_challenges",
  "historical_user_partial_cleanup_events",
  "historical_user_partial_read_reservations",
  "historical_user_private_delivery_preflights",
  "historical_user_private_preflight_events",
  "historical_user_snapshot_mutation_epochs",
  "installation_component_credentials",
  "installation_component_observations",
  "installations",
  "legal_holds",
  "managed_runner_identities",
  "manufacturing_share_authorizations",
  "notification_channels",
  "notification_deliveries",
  "product_events",
  "production_batch_defects",
  "production_batches",
  "projects",
  "protected_release_execution_seals",
  "protected_release_intent_candidates",
  "release_run_attempts",
  "release_run_results",
  "release_run_transition_events",
  "release_runs",
  "remote_mcp_oauth_authorizations",
  "remote_mcp_oauth_clients",
  "remote_mcp_oauth_grants",
  "remote_mcp_oauth_login_resumptions",
  "remote_mcp_oauth_rate_limits",
  "remote_mcp_oauth_security_events",
  "repositories",
  "repository_firmware_advisory_watch",
  "repository_firmware_dependencies",
  "repository_firmware_snapshots",
  "repository_retention_policies",
  "repository_setup_probes",
  "repository_setup_revisions",
  "retention_policies",
  "review_approvals",
  "review_checklist_items",
  "review_comments",
  "review_policies",
  "review_policy_audit_events",
  "review_revisions",
  "reviews",
  "revisions",
  "run_pcb_footprint_summaries",
  "run_snapshots",
  "runner_artifact_upload_capabilities",
  "runner_execution_policies",
  "runner_job_leases",
  "runner_registration_enrollments",
  "runner_registrations",
  "runner_request_nonces",
  "signed_manufacturing_export_evidence",
  "supply_finding_suppressions",
  "webhook_inbox",
  "workspace_member_audit_events",
  "workspace_members",
  "workspace_memberships",
  "workspaces",
] as const;

const partialPrivateMetadata = new Set<string>([
  "repositories",
  "release_runs",
  "findings",
  "artifacts",
  "reviews",
  "review_revisions",
  "review_comments",
  "review_approvals",
  "review_checklist_items",
  "finding_decisions",
  "finding_assignments",
  "audit_events",
  "run_snapshots",
]);

const deliberatelyWithheldSensitive = new Set<string>([
  "api_tokens",
  "installation_component_credentials",
  "installation_component_observations",
  "runner_registrations",
  "runner_registration_enrollments",
  "runner_request_nonces",
  "runner_artifact_upload_capabilities",
  "runner_job_leases",
  "remote_mcp_oauth_authorizations",
  "remote_mcp_oauth_clients",
  "remote_mcp_oauth_grants",
  "remote_mcp_oauth_login_resumptions",
  "remote_mcp_oauth_rate_limits",
  "remote_mcp_oauth_security_events",
  "managed_runner_identities",
  "webhook_inbox",
]);

const expectedColumns = 1033;
const expectedSchemaSha256 = "45d6db6d25b6e61a0950333a5f9d81b17e2895c21736688b08cc00d49b3dfe63";
const maxCatalogColumns = 1200;

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
};

type ScopeCoverage = {
  status: "known_schema_scope_unapproved" | "schema_drift" | "unavailable";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  tableCount: number;
  columnCount: number;
  partialPrivateMetadataTableCount: number;
  withheldSensitiveTableCount: number;
  otherTablesRequiringScopeReview: number;
  unrecognizedTableCount: number;
  schemaSha256: string | null;
};

const denied = (): ScopeCoverage => ({
  status: "unavailable",
  releaseDecision: "NO_GO",
  completeCustomerExport: false,
  customerDeliveryAllowed: false,
  tableCount: 0,
  columnCount: 0,
  partialPrivateMetadataTableCount: 0,
  withheldSensitiveTableCount: 0,
  otherTablesRequiringScopeReview: 0,
  unrecognizedTableCount: 0,
  schemaSha256: null,
});

function validColumn(row: unknown): row is Column {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const c = row as Record<string, unknown>;
  return (
    typeof c.table_name === "string" &&
    /^[a-z][a-z0-9_]{0,127}$/u.test(c.table_name) &&
    typeof c.column_name === "string" &&
    /^[a-z][a-z0-9_]{0,127}$/u.test(c.column_name) &&
    typeof c.data_type === "string" &&
    c.data_type.length > 0 &&
    c.data_type.length <= 128 &&
    (c.is_nullable === "YES" || c.is_nullable === "NO")
  );
}

/**
 * One PostgreSQL READ ONLY, REPEATABLE READ statement, catalog metadata only.
 * The exact schema fingerprint includes column type and nullability in
 * ordinal order. Unknown tables OR mutations to existing known tables block
 * any future completeness assertion. This independent audit does NOT prove
 * row completeness, tenant authorization or source/disclosure rights.
 */
export async function assessHistoricalUserSchemaCoverage(
  db: Pick<PgQueryExecutor, "withTransaction">,
): Promise<ScopeCoverage> {
  if (!db?.withTransaction) return denied();
  try {
    return await db.withTransaction(
      async (tx) => {
        const result: unknown = await tx.query(
          `SELECT c.table_name,c.column_name,c.data_type,c.is_nullable
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema=c.table_schema AND t.table_name=c.table_name
            WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
            ORDER BY c.table_name,c.ordinal_position
            LIMIT 1201`,
        );
        if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows))
          return denied();
        const columns: unknown[] = result.rows;
        if (columns.length === 0 || columns.length > maxCatalogColumns || !columns.every(validColumn)) return denied();
        const rows = columns as Column[];
        const tableNames = new Set(rows.map((row) => row.table_name));
        const identities = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
        if (identities.size !== rows.length) return denied();
        const ordered = rows.map(({ table_name, column_name, data_type, is_nullable }) => [
          table_name,
          column_name,
          data_type,
          is_nullable,
        ]);
        const sha = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
        const known = new Set<string>(knownTables);
        const unrecognized = [...tableNames].filter((name) => !known.has(name)).length;
        const privatePartialCount = [...tableNames].filter((name) => partialPrivateMetadata.has(name)).length;
        const withheldCount = [...tableNames].filter((name) => deliberatelyWithheldSensitive.has(name)).length;
        const isMatched =
          sha === expectedSchemaSha256 &&
          rows.length === expectedColumns &&
          tableNames.size === known.size &&
          unrecognized === 0 &&
          [...known].every((name) => tableNames.has(name)) &&
          [...partialPrivateMetadata, ...deliberatelyWithheldSensitive].every((name) => known.has(name)) &&
          [...partialPrivateMetadata].every((name) => !deliberatelyWithheldSensitive.has(name));
        return {
          status: isMatched ? "known_schema_scope_unapproved" : "schema_drift",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          tableCount: tableNames.size,
          columnCount: rows.length,
          partialPrivateMetadataTableCount: privatePartialCount,
          withheldSensitiveTableCount: withheldCount,
          otherTablesRequiringScopeReview: tableNames.size - privatePartialCount - withheldCount,
          unrecognizedTableCount: unrecognized,
          schemaSha256: sha,
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return denied();
  }
}
