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

/**
 * EXPLICIT REVIEW QUEUE FOR ALL 63 UNRESOLVED SOURCE CLASSES.
 *
 * These are NOT whitelists for disclosure. Every track stays blocked until
 * the original numeric USER ownership, licensed/customer rights, retention,
 * deletion/hold and third-party content provenance have independently passed.
 *
 * Never derive "eligible" from membership in a review track. A track
 * categorizes work and makes schema changes visible, nothing more.
 */
export const historicalUserUnresolvedSourceReviewTracks = {
  privacy_lifecycle: [
    "artifact_deletion_jobs",
    "artifact_export_copy_reservations",
    "artifact_unlink_fences",
    "data_export_archive_commitments",
    "data_exports",
    "erasure_requests",
    "historical_user_live_oauth_verified_proofs",
    "historical_user_oauth_challenges",
    "historical_user_partial_cleanup_events",
    "historical_user_partial_read_reservations",
    "historical_user_private_delivery_preflights",
    "historical_user_private_preflight_events",
    "historical_user_snapshot_mutation_epochs",
    "installations",
    "legal_holds",
    "repository_retention_policies",
    "retention_policies",
  ],
  billing_and_marketplace: [
    "billing_activity",
    "billing_customers",
    "billing_events",
    "billing_subscriptions",
    "github_marketplace_subscriptions",
  ],
  hardware_and_release: [
    "board_bom_components",
    "board_bom_snapshots",
    "board_supply_findings",
    "board_supply_watch",
    "boards",
    "manufacturing_share_authorizations",
    "production_batch_defects",
    "production_batches",
    "protected_release_execution_seals",
    "protected_release_intent_candidates",
    "release_run_attempts",
    "release_run_results",
    "release_run_transition_events",
    "repository_firmware_advisory_watch",
    "repository_firmware_dependencies",
    "repository_firmware_snapshots",
    "run_pcb_footprint_summaries",
    "signed_manufacturing_export_evidence",
    "supply_finding_suppressions",
  ],
  collaboration_and_workspace: [
    "external_review_invitations",
    "product_events",
    "projects",
    "review_policies",
    "review_policy_audit_events",
    "revisions",
    "workspace_member_audit_events",
    "workspace_members",
    "workspace_memberships",
    "workspaces",
  ],
  platform_operations: [
    "cloud_schema_migrations",
    "component_lifecycle_observations",
    "control_plane_jobs",
    "control_plane_outbox",
    "control_plane_reconciliation_items",
    "control_plane_replay_operations",
    "deliveries",
    "notification_channels",
    "notification_deliveries",
    "repository_setup_probes",
    "repository_setup_revisions",
    "runner_execution_policies",
  ],
} as const;

const expectedColumns = 1033;
const expectedSchemaSha256 = "45d6db6d25b6e61a0950333a5f9d81b17e2895c21736688b08cc00d49b3dfe63";
const maxCatalogColumns = 1200;

// The source-scope digest relies on these exact AFTER triggers to detect
// committed edits that restore identical row bytes (ABA). A column-only
// catalog fingerprint cannot detect a dropped/disabled trigger or changed
// trigger function, so pin both trigger bindings and their function bodies.
const expectedMutationEpochTriggers = [
  ["artifacts", "boardreadyops_historical_core_source_epoch", "boardreadyops_note_historical_core_source_mutation"],
  ["audit_events", "boardreadyops_historical_audit_epoch", "boardreadyops_note_historical_audit_epoch"],
  [
    "finding_assignments",
    "boardreadyops_historical_collaboration_epoch",
    "boardreadyops_note_historical_review_collaboration_mutation",
  ],
  ["findings", "boardreadyops_historical_core_source_epoch", "boardreadyops_note_historical_core_source_mutation"],
  [
    "finding_decisions",
    "boardreadyops_historical_collaboration_epoch",
    "boardreadyops_note_historical_review_collaboration_mutation",
  ],
  ["release_runs", "boardreadyops_historical_core_source_epoch", "boardreadyops_note_historical_core_source_mutation"],
  ["repositories", "boardreadyops_historical_core_source_epoch", "boardreadyops_note_historical_core_source_mutation"],
  [
    "review_approvals",
    "boardreadyops_historical_collaboration_epoch",
    "boardreadyops_note_historical_review_collaboration_mutation",
  ],
  [
    "review_checklist_items",
    "boardreadyops_historical_collaboration_epoch",
    "boardreadyops_note_historical_review_collaboration_mutation",
  ],
  [
    "review_comments",
    "boardreadyops_historical_collaboration_epoch",
    "boardreadyops_note_historical_review_collaboration_mutation",
  ],
  [
    "review_revisions",
    "boardreadyops_historical_collaboration_epoch",
    "boardreadyops_note_historical_review_collaboration_mutation",
  ],
  ["reviews", "boardreadyops_historical_review_epoch", "boardreadyops_note_historical_review_mutation"],
  ["run_snapshots", "boardreadyops_historical_visual_epoch", "boardreadyops_note_historical_visual_mutation"],
] as const;
const expectedMutationEpochFunctions = [
  "boardreadyops_bump_historical_user_snapshot_epoch",
  "boardreadyops_note_historical_audit_epoch",
  "boardreadyops_note_historical_core_source_mutation",
  "boardreadyops_note_historical_review_collaboration_mutation",
  "boardreadyops_note_historical_review_mutation",
  "boardreadyops_note_historical_visual_mutation",
] as const;
const expectedMutationEpochTriggerCount = expectedMutationEpochTriggers.length;
const expectedMutationEpochFunctionCount = expectedMutationEpochFunctions.length;
const expectedMutationEpochSha256 = "559ec18ed5083fc41bb4aebdf94e840fd59baf44705227b9975fa6a6d570a9a5";

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
};
type MutationEpochTrigger = {
  table_name: string;
  trigger_name: string;
  function_name: string;
  definition: string;
  enabled: string;
};
type MutationEpochFunction = {
  function_name: string;
  identity_arguments: string;
  definition: string;
  security_definer: boolean;
  configuration: string[];
};

type UnresolvedReviewTrack = keyof typeof historicalUserUnresolvedSourceReviewTracks;
type UnresolvedReviewTrackCounts = Record<UnresolvedReviewTrack, number>;

function emptyReviewCounts(): UnresolvedReviewTrackCounts {
  return {
    privacy_lifecycle: 0,
    billing_and_marketplace: 0,
    hardware_and_release: 0,
    collaboration_and_workspace: 0,
    platform_operations: 0,
  };
}

function reviewCountsForTables(tables: ReadonlySet<string>): UnresolvedReviewTrackCounts {
  const counts = emptyReviewCounts();
  for (const track of Object.keys(historicalUserUnresolvedSourceReviewTracks) as UnresolvedReviewTrack[]) {
    counts[track] = historicalUserUnresolvedSourceReviewTracks[track].filter((name) => tables.has(name)).length;
  }
  return counts;
}

function validSourceClassPartition(): boolean {
  const allClassified: string[] = [
    ...partialPrivateMetadata,
    ...deliberatelyWithheldSensitive,
    ...Object.values(historicalUserUnresolvedSourceReviewTracks).flat(),
  ];
  const known = new Set<string>(knownTables);
  return (
    allClassified.length === known.size &&
    new Set(allClassified).size === known.size &&
    allClassified.every((name) => known.has(name))
  );
}

type ScopeCoverage = {
  status: "known_schema_scope_unapproved" | "schema_drift" | "unavailable";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  tableCount: number;
  columnCount: number;
  mutationEpochTriggerCount: number;
  mutationEpochFunctionCount: number;
  mutationEpochSha256: string | null;
  partialPrivateMetadataTableCount: number;
  withheldSensitiveTableCount: number;
  otherTablesRequiringScopeReview: number;
  unresolvedReviewTrackCounts: UnresolvedReviewTrackCounts;
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
  mutationEpochTriggerCount: 0,
  mutationEpochFunctionCount: 0,
  mutationEpochSha256: null,
  partialPrivateMetadataTableCount: 0,
  withheldSensitiveTableCount: 0,
  otherTablesRequiringScopeReview: 0,
  unresolvedReviewTrackCounts: emptyReviewCounts(),
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

function validMutationEpochTrigger(row: unknown): row is MutationEpochTrigger {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const trigger = row as Record<string, unknown>;
  return (
    typeof trigger.table_name === "string" &&
    /^[a-z][a-z0-9_]{0,127}$/u.test(trigger.table_name) &&
    typeof trigger.trigger_name === "string" &&
    /^boardreadyops_historical_[a-z0-9_]+_epoch$/u.test(trigger.trigger_name) &&
    typeof trigger.function_name === "string" &&
    expectedMutationEpochFunctions.includes(trigger.function_name as (typeof expectedMutationEpochFunctions)[number]) &&
    typeof trigger.definition === "string" &&
    trigger.definition.length > 0 &&
    trigger.definition.length <= 2048 &&
    typeof trigger.enabled === "string" &&
    ["O", "D", "R", "A"].includes(trigger.enabled)
  );
}

function validMutationEpochFunction(row: unknown): row is MutationEpochFunction {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const fn = row as Record<string, unknown>;
  return (
    typeof fn.function_name === "string" &&
    expectedMutationEpochFunctions.includes(fn.function_name as (typeof expectedMutationEpochFunctions)[number]) &&
    typeof fn.identity_arguments === "string" &&
    fn.identity_arguments.length <= 256 &&
    typeof fn.definition === "string" &&
    fn.definition.length > 0 &&
    fn.definition.length <= 16_384 &&
    typeof fn.security_definer === "boolean" &&
    Array.isArray(fn.configuration) &&
    fn.configuration.every((item) => typeof item === "string" && item.length <= 256)
  );
}

/**
 * One PostgreSQL READ ONLY, REPEATABLE READ transaction reads catalog
 * metadata only: ordered table columns plus the exact enabled historical
 * mutation-epoch trigger bindings and invoker function definitions. Dropped,
 * disabled or changed ABA guards therefore block the source-scope signature.
 * Unknown tables or changed known tables also block completeness. This audit
 * does NOT prove row completeness, tenant authorization or disclosure rights.
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

        const triggerResult: unknown = await tx.query(
          `SELECT relation.relname AS table_name,
                  trigger.tgname AS trigger_name,
                  procedure.proname AS function_name,
                  pg_get_triggerdef(trigger.oid,true) AS definition,
                  trigger.tgenabled AS enabled
             FROM pg_catalog.pg_trigger AS trigger
             JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger.tgrelid
             JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
             JOIN pg_catalog.pg_proc AS procedure ON procedure.oid=trigger.tgfoid
            WHERE namespace.nspname='public'
              AND trigger.tgisinternal=FALSE
              AND trigger.tgname LIKE 'boardreadyops_historical_%_epoch'
            ORDER BY relation.relname,trigger.tgname
            LIMIT 14`,
        );
        if (
          !triggerResult ||
          typeof triggerResult !== "object" ||
          !("rows" in triggerResult) ||
          !Array.isArray(triggerResult.rows)
        )
          return denied();
        const triggerRows: unknown[] = triggerResult.rows;
        if (triggerRows.length > expectedMutationEpochTriggerCount || !triggerRows.every(validMutationEpochTrigger))
          return denied();
        const orderedTriggers = (triggerRows as MutationEpochTrigger[]).map((trigger) => [
          trigger.table_name,
          trigger.trigger_name,
          trigger.function_name,
          trigger.definition,
          trigger.enabled,
        ]);
        const actualTriggerBindings = orderedTriggers
          .map((trigger) => trigger.slice(0, 3).join("|"))
          .sort((left, right) => left.localeCompare(right));
        const expectedTriggerBindings = expectedMutationEpochTriggers
          .map((trigger) => trigger.join("|"))
          .sort((left, right) => left.localeCompare(right));
        const triggerBindingsMatch = JSON.stringify(actualTriggerBindings) === JSON.stringify(expectedTriggerBindings);
        const triggersEnabled = (triggerRows as MutationEpochTrigger[]).every((trigger) => trigger.enabled === "O");

        const functionResult: unknown = await tx.query(
          `SELECT procedure.proname AS function_name,
                  pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
                  pg_get_functiondef(procedure.oid) AS definition,
                  procedure.prosecdef AS security_definer,
                  COALESCE(procedure.proconfig,ARRAY[]::text[]) AS configuration
             FROM pg_catalog.pg_proc AS procedure
             JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
            WHERE namespace.nspname='public'
              AND procedure.prokind='f'
              AND procedure.proname=ANY($1::text[])
            ORDER BY procedure.proname,pg_get_function_identity_arguments(procedure.oid)
            LIMIT 7`,
          [[...expectedMutationEpochFunctions]],
        );
        if (
          !functionResult ||
          typeof functionResult !== "object" ||
          !("rows" in functionResult) ||
          !Array.isArray(functionResult.rows)
        )
          return denied();
        const functionRows: unknown[] = functionResult.rows;
        if (functionRows.length > expectedMutationEpochFunctionCount || !functionRows.every(validMutationEpochFunction))
          return denied();
        const functionsInvokerOnly = (functionRows as MutationEpochFunction[]).every(
          (fn) => fn.security_definer === false,
        );
        const orderedFunctions = (functionRows as MutationEpochFunction[]).map((fn) => [
          fn.function_name,
          fn.identity_arguments,
          fn.definition,
          fn.security_definer,
          fn.configuration,
        ]);
        const mutationEpochSha = createHash("sha256")
          .update(JSON.stringify({ triggers: orderedTriggers, functions: orderedFunctions }))
          .digest("hex");
        const known = new Set<string>(knownTables);
        const unrecognized = [...tableNames].filter((name) => !known.has(name)).length;
        const privatePartialCount = [...tableNames].filter((name) => partialPrivateMetadata.has(name)).length;
        const withheldCount = [...tableNames].filter((name) => deliberatelyWithheldSensitive.has(name)).length;
        const unresolvedReviewTrackCounts = reviewCountsForTables(tableNames);
        const isMatched =
          validSourceClassPartition() &&
          sha === expectedSchemaSha256 &&
          rows.length === expectedColumns &&
          triggerBindingsMatch &&
          triggersEnabled &&
          functionsInvokerOnly &&
          triggerRows.length === expectedMutationEpochTriggerCount &&
          functionRows.length === expectedMutationEpochFunctionCount &&
          mutationEpochSha === expectedMutationEpochSha256 &&
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
          mutationEpochTriggerCount: triggerRows.length,
          mutationEpochFunctionCount: functionRows.length,
          mutationEpochSha256: mutationEpochSha,
          partialPrivateMetadataTableCount: privatePartialCount,
          withheldSensitiveTableCount: withheldCount,
          otherTablesRequiringScopeReview: tableNames.size - privatePartialCount - withheldCount,
          unresolvedReviewTrackCounts,
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
