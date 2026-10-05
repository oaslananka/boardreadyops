import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("BoardReadyOps Cloud migrations", () => {
  it("publishes the cloud schema version and models", () => {
    expect(cloudDatabaseSchemaVersion).toBe(56);
    expect(cloudDatabaseModels).toContain("ApiToken");
    expect(cloudDatabaseModels).toContain("FindingDecision");
    expect(cloudDatabaseModels).toContain("FindingAssignment");
    expect(cloudDatabaseModels).toContain("ReviewComment");
    expect(cloudDatabaseModels).toContain("ReviewApproval");
    expect(cloudDatabaseModels).toContain("BoardSupplyWatch");
    expect(cloudDatabaseModels).toContain("ComponentLifecycleObservation");
    expect(cloudDatabaseModels).toContain("Board");
    expect(cloudDatabaseModels).toContain("BoardBomSnapshot");
    expect(cloudDatabaseModels).toContain("BoardBomComponent");
    expect(cloudDatabaseModels).toContain("RepositoryFirmwareSnapshot");
    expect(cloudDatabaseModels).toContain("RepositoryFirmwareDependency");
    expect(cloudDatabaseModels).toContain("RepositoryFirmwareAdvisoryWatch");
    expect(cloudDatabaseModels).toContain("RunnerRegistration");
    expect(cloudDatabaseModels).toContain("RunnerRegistrationEnrollment");
    expect(cloudDatabaseModels).toContain("RunnerExecutionPolicy");
    expect(cloudDatabaseModels).toContain("ManagedRunnerIdentity");
    expect(cloudDatabaseModels).toContain("RunnerJobLease");
    expect(cloudDatabaseModels).toContain("RunnerRequestNonce");
    expect(cloudDatabaseModels).toContain("RunnerArtifactUploadCapability");
    expect(cloudDatabaseModels).toContain("ArtifactDeletionJob");
    expect(cloudDatabaseModels).toContain("AuditEvent");
    expect(cloudDatabaseModels).toContain("ReleaseRunResult");
    expect(cloudDatabaseModels).toContain("ReleaseRunAttempt");
    expect(cloudDatabaseModels).toContain("ReleaseRunTransitionEvent");
    expect(cloudDatabaseModels).toContain("WebhookInbox");
    expect(cloudDatabaseModels).toContain("ControlPlaneJob");
    expect(cloudDatabaseModels).toContain("ControlPlaneOutbox");
    expect(cloudDatabaseModels).toContain("ControlPlaneReconciliationItem");
    expect(cloudDatabaseModels).toContain("ControlPlaneReplayOperation");
    expect(cloudDatabaseModels).toContain("Workspace");
    expect(cloudDatabaseModels).toContain("Project");
    expect(cloudDatabaseModels).toContain("Revision");
    expect(cloudDatabaseModels).toContain("Delivery");
    expect(cloudDatabaseModels).toContain("ProductionBatch");
    expect(cloudDatabaseModels).toContain("ProductionBatchDefect");
  });

  it("discovers SQL migrations in deterministic order", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort();

    expect(files).toEqual([
      "0001_cloud_schema.sql",
      "0002_release_run_lifecycle.sql",
      "0003_runner_registrations.sql",
      "0004_audit_logs.sql",
      "0005_release_run_execution_attempts.sql",
      "0006_release_run_results.sql",
      "0007_release_run_attempts.sql",
      "0008_runner_protocol_leases.sql",
      "0009_runner_lease_deferred_scope.sql",
      "0010_runner_lease_heartbeat_qualification.sql",
      "0011_runner_artifact_upload_capabilities.sql",
      "0012_runner_terminal_result_authorization.sql",
      "0013_runner_registration_enrollments.sql",
      "0014_runner_execution_routing_policies.sql",
      "0015_control_plane_webhook_jobs.sql",
      "0016_control_plane_transactional_outbox.sql",
      "0017_release_run_outbox_producer.sql",
      "0018_control_plane_outbox_transitions.sql",
      "0019_control_plane_reconciliation_operations.sql",
      "0020_github_workflow_reconciliation.sql",
      "0021_github_check_run_reconciliation.sql",
      "0022_control_plane_lifecycle_reconciliation.sql",
      "0023_versioned_release_run_transitions.sql",
      "0024_guarded_workflow_dispatch_transition.sql",
      "0025_guarded_check_run_create_transition.sql",
      "0026_guarded_workflow_reconciliation_transition.sql",
      "0027_guarded_release_run_supersession.sql",
      "0028_guarded_runner_result_transition.sql",
      "0029_guarded_runner_lease_transitions.sql",
      "0030_artifact_deletion_jobs.sql",
      "0031_run_investigation_indexes.sql",
      "0032_repository_setup_flow.sql",
      "0033_release_run_trust_mode.sql",
      "0034_runner_lease_trust_snapshot.sql",
      "0035_terminal_ephemeral_retention_indexes.sql",
      "0036_control_plane_history_retention_indexes.sql",
      "0037_runner_fleet_health.sql",
      "0038_runner_registration_revocation.sql",
      "0039_artifact_metadata_contract.sql",
      "0040_board_bom_snapshots.sql",
      "0041_board_supply_watch.sql",
      "0042_check_run_reconciliation_without_result.sql",
      "0043_signed_result_corrects_inferred_failure.sql",
      "0044_supply_watch_entitlement_outcome.sql",
      "0045_installation_component_credentials.sql",
      "0046_reconciliation_attempt_budget_guard.sql",
      "0047_seat_based_entitlement_tiers.sql",
      "0048_review_domain_spine.sql",
      "0049_api_tokens.sql",
      "0050_finding_collaboration.sql",
      "0051_external_reviews.sql",
      "0052_billing.sql",
      "0053_storage_lifecycle.sql",
      "0054_governance.sql",
      "0055_marketplace_billing_events.sql",
      "0056_marketplace_subscription_state.sql",
      "0057_review_approval_uniqueness.sql",
      "0058_release_run_delivery_id.sql",
      "0059_component_pricing_snapshot.sql",
      "0060_stripe_subscription_event_ordering.sql",
      "0061_run_snapshots.sql",
      "0062_finding_category.sql",
      "0063_workspace_project_model.sql",
      "0064_workspace_membership_authorization.sql",
      "0065_setup_incomplete_release_runs.sql",
      "0066_notifications.sql",
      "0067_notification_email_channels.sql",
      "0068_repository_firmware_snapshots.sql",
      "0069_firmware_advisory_watch.sql",
      "0070_release_run_base_commit_sha.sql",
      "0071_workspace_member_verified_identity.sql",
      "0072_validated_delivery_revisions.sql",
      "0073_supply_finding_provenance.sql",
      "0074_installation_component_observations.sql",
      "0075_component_supplier_count.sql",
      "0076_supply_unavailable_findings.sql",
      "0077_supply_finding_acknowledgement.sql",
      "0078_supply_finding_suppressions.sql",
      "0079_component_alternates.sql",
      "0080_component_compliance_trust.sql",
      "0081_board_snapshot_release_mode.sql",
      "0082_production_outcome_batches.sql",
      "0083_github_app_uninstall_erasure.sql",
      "0084_repository_retention_policies.sql",
    ]);
  });

  it("deduplicates active GitHub App uninstall erasure requests in schema v83", async () => {
    const sql = (await readFile(join(migrationsDir, "0083_github_app_uninstall_erasure.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("create unique index if not exists uq_erasure_requests_active_github_app_uninstall");
    expect(sql).toContain("drop constraint if exists erasure_requests_status_check");
    expect(sql).toContain("'canceled'");
    expect(sql).toContain("requested_by = 'github_app_uninstall'");
    expect(sql).toContain("scope in ('organization', 'user')");
    expect(sql).toContain("status in ('pending', 'running', 'blocked_by_hold')");
  });

  it("stores release-linked production batches and normalized defects in schema v82", async () => {
    const sql = (await readFile(join(migrationsDir, "0082_production_outcome_batches.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists production_batches");
    expect(sql).toContain("release_run_id text not null references release_runs(id) on delete cascade");
    expect(sql).toContain("first_pass_yield_bps integer");
    expect(sql).toContain("first_pass_yield_bps between 0 and 10000");
    expect(sql).toContain("source_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("production_batches_release_identity_idx");
    expect(sql).toContain("lower(manufacturer), lower(external_batch_id)");
    expect(sql).toContain("create table if not exists production_batch_defects");
    expect(sql).toContain("category in ('aoi', 'spi', 'functional_test', 'ncr', 'rma')");
    expect(sql).toContain("unique (production_batch_id, category, code)");
    expect(sql).not.toContain("production_batch_defects_batch_category_idx");
    expect(sql).not.toContain("customer_id");
    expect(sql).not.toContain("vendor_id");
  });

  it("captures release criticality on immutable BOM snapshots in schema v81", async () => {
    const sql = (await readFile(join(migrationsDir, "0081_board_snapshot_release_mode.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table board_bom_snapshots");
    expect(sql).toContain("add column if not exists release_mode text");
    expect(sql).toContain("board_bom_snapshots_release_mode_valid");
    expect(sql).toContain("'prototype', 'pilot', 'production'");
  });

  it("adds bounded compliance/trust signals and restricted findings in schema v80", async () => {
    const sql = (await readFile(join(migrationsDir, "0080_component_compliance_trust.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table component_lifecycle_observations");
    expect(sql).toContain("alter table installation_component_observations");
    expect(sql).toContain("alter table board_supply_findings");
    expect(sql).toContain("restricted_substances boolean");
    expect(sql).toContain("compliance_notes jsonb");
    expect(sql).toContain("data_trust text");
    expect(sql).toContain("observation_trust text");
    expect(sql).toContain("'restricted'");
    expect(sql).toContain("pg_column_size(compliance_notes) <= 16384");
    expect(sql).toContain("'verified', 'estimated', 'unverified', 'unknown'");
    expect(sql).not.toContain("provider_payload");
  });

  it("adds bounded provider-neutral alternate parts to both observation caches in schema v79", async () => {
    const sql = (await readFile(join(migrationsDir, "0079_component_alternates.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table component_lifecycle_observations");
    expect(sql).toContain("alter table installation_component_observations");
    expect(sql).toContain("add column if not exists alternates jsonb not null default '[]'::jsonb");
    expect(sql).toContain("component_lifecycle_observations_alternates_valid");
    expect(sql).toContain("installation_component_observations_alternates_valid");
    expect(sql).toContain("pg_column_size(alternates) <= 16384");
    expect(sql).not.toContain("description");
    expect(sql).not.toContain("octopart_url");
  });

  it("records append-only time-bound supply suppression history in schema v78", async () => {
    const sql = (await readFile(join(migrationsDir, "0078_supply_finding_suppressions.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists supply_finding_suppressions");
    expect(sql).toContain("finding_id text not null references board_supply_findings(id) on delete cascade");
    expect(sql).toContain("reason text not null");
    expect(sql).toContain("expires_at timestamptz not null");
    expect(sql).toContain("cleared_at timestamptz");
    expect(sql).toContain("cleared_by text");
    expect(sql).toContain("supply_finding_suppressions_current_idx");
    expect(sql).toContain("where cleared_at is null");
    expect(sql).not.toContain("delete from supply_finding_suppressions");
  });

  it("records supply finding acknowledgement without resolving or suppressing it in schema v77", async () => {
    const sql = (await readFile(join(migrationsDir, "0077_supply_finding_acknowledgement.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("add column if not exists acknowledged_at timestamptz");
    expect(sql).toContain("add column if not exists acknowledged_by text");
    expect(sql).toContain("board_supply_findings_acknowledgement_pair_valid");
    expect(sql).toContain("char_length(acknowledged_by) between 1 and 128");
    expect(sql).not.toContain("resolved_at =");
    expect(sql).not.toContain("suppressed_at");
  });

  it("extends durable supply finding status with explicit zero-stock risk in schema v76", async () => {
    const sql = (await readFile(join(migrationsDir, "0076_supply_unavailable_findings.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table board_supply_findings");
    expect(sql).toContain("drop constraint if exists board_supply_findings_status_valid");
    expect(sql).toContain("status in ('nrnd', 'eol', 'obsolete', 'unavailable')");
    expect(sql).not.toContain("available_units");
    expect(sql).not.toContain("inventory_level");
  });

  it("adds bounded supplier-count metadata to both observation caches in schema v75", async () => {
    const sql = (await readFile(join(migrationsDir, "0075_component_supplier_count.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table component_lifecycle_observations");
    expect(sql).toContain("alter table installation_component_observations");
    expect(sql).toContain("add column if not exists supplier_count integer");
    expect(sql).toContain("supplier_count between 0 and 100000");
    expect(sql).not.toContain("inventory_level");
    expect(sql).not.toContain("seller_name");
  });

  it("adds installation-scoped component observation caching in schema v74", async () => {
    const sql = (
      await readFile(join(migrationsDir, "0074_installation_component_observations.sql"), "utf8")
    ).toLowerCase();

    expect(sql).toContain("create table if not exists installation_component_observations");
    expect(sql).toContain("installation_id text not null references installations(id) on delete cascade");
    expect(sql).toContain("provider text not null");
    expect(sql).toContain("installation_id, provider, lower(mpn), lower(coalesce(manufacturer, ''))");
    expect(sql).toContain("installation_component_observations_refresh_idx");
    expect(sql).toContain("add column if not exists provider text");
    expect(sql).toContain("set provider = source");
    expect(sql).toContain("alter column provider set not null");
    expect(sql).toContain("component_lifecycle_observations_provider_valid");
    expect(sql).toContain("component_lifecycle_observations_available_units_valid");
    expect(sql).toContain("component_lifecycle_observations_lead_time_days_valid");
    expect(sql).not.toContain("drop index if exists component_lifecycle_observations_part_idx");
    expect(sql).not.toContain("create unique index concurrently");
    expect(sql).toContain("installation_component_observations_available_units_valid");
    expect(sql).toContain("installation_component_observations_lead_time_days_valid");
    expect(sql).toContain("expires_at is null or expires_at >= observed_at");
  });

  it("snapshots minimal provider provenance on supply findings in schema v73", async () => {
    const sql = (await readFile(join(migrationsDir, "0073_supply_finding_provenance.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table board_supply_findings");
    expect(sql).toContain("add column if not exists observation_source text");
    expect(sql).toContain("board_supply_findings_observation_source_valid");
    expect(sql).toContain("char_length(observation_source) between 1 and 64");
    expect(sql).not.toContain("add column if not exists evidence_url");
    expect(sql).not.toContain("add column if not exists price_breaks");
    expect(sql).not.toContain("add column if not exists inventory");
  });

  it("binds delivery-eligible revisions to persisted validation evidence in schema v72", async () => {
    const sql = (await readFile(join(migrationsDir, "0072_validated_delivery_revisions.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("validation_run_id text references release_runs(id) on delete set null");
    expect(sql).toContain("validation_artifact_id text references artifacts(id) on delete set null");
    expect(sql).toContain("revisions_validation_artifact_idx");
    expect(sql).toContain("where validation_artifact_id is not null");
    expect(sql).toContain("revisions_validation_run_idx");
  });

  it("pins new workspace grants to verified GitHub identities in schema v71", async () => {
    const sql = (
      await readFile(join(migrationsDir, "0071_workspace_member_verified_identity.sql"), "utf8")
    ).toLowerCase();

    expect(sql).toContain("add column if not exists github_user_id bigint");
    expect(sql).toContain("add column if not exists github_login text");
    expect(sql).toContain("workspace_members_github_identity_idx");
    expect(sql).toContain("where github_user_id is not null");
    expect(sql).toContain("create table if not exists workspace_member_audit_events");
    expect(sql).toContain("actor_github_user_id");
    expect(sql).toContain("subject_github_user_id");
    expect(sql).toContain("previous_role");
    expect(sql).toContain("workspace_member_audit_events is append-only");
  });

  it("persists the PR base commit SHA required by dashboard re-run in schema v70", async () => {
    const sql = (await readFile(join(migrationsDir, "0070_release_run_base_commit_sha.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("add column if not exists base_commit_sha text");
    expect(sql).toContain("release_runs_base_commit_sha_valid");
    expect(sql).toContain("payload #>> '{action,basecommitsha}'");
    expect(sql).toContain("effect_type = 'github.check_run.create'");
    expect(sql).toContain("v_base_commit_sha := p_outbox_payload #>> '{action,basecommitsha}'");
    expect(sql).toContain("base_commit_sha,");
    expect(sql).toContain("v_base_commit_sha,");
    expect(sql).toContain("'{action,setupincomplete}'");
  });

  it("scopes firmware snapshots to a repository and refuses a searchable row with no identifier in schema v68", async () => {
    const sql = (await readFile(join(migrationsDir, "0068_repository_firmware_snapshots.sql"), "utf8")).toLowerCase();

    // Repository-scoped on purpose: the run reports manifest paths with no project association,
    // so there is no board fact to record and guessing one would put an invented board list into
    // a CRA report. See the decision on #798.
    expect(sql).toContain("create table if not exists repository_firmware_snapshots");
    expect(sql).toContain("repository_id text not null references repositories(id) on delete cascade");
    expect(sql).toContain("run_id text not null references release_runs(id) on delete cascade");
    expect(sql).not.toContain("references boards(id)");
    expect(sql).toContain("repository_firmware_snapshots_repo_run_idx");

    // The searchable flag and the identifiers can never disagree: an identifier on an
    // unsearchable dependency is the false clean bill this whole line of work exists to prevent.
    expect(sql).toContain("repository_firmware_dependencies_searchable_valid");
    expect(sql).toContain("(searchable and (purl is not null or cpe is not null))");
    expect(sql).toContain("(not searchable and purl is null and cpe is null)");

    expect(sql).toContain("repository_firmware_dependencies_origin_valid");
    expect(sql).toContain("origin in ('registry', 'git', 'local', 'framework')");
    // The two advisory lookup paths.
    expect(sql).toContain("repository_firmware_dependencies_purl_idx");
    expect(sql).toContain("repository_firmware_dependencies_cpe_idx");
    expect(sql).toContain("searchable_count between 0 and dependency_count");
  });

  it("keys the firmware advisory schedule by repository and records all six outcomes in schema v69", async () => {
    const sql = (await readFile(join(migrationsDir, "0069_firmware_advisory_watch.sql"), "utf8")).toLowerCase();

    // Keyed by repository, not snapshot: every run appends a snapshot, so a per-snapshot
    // schedule would rescan the same dependencies once per run against a rate-limited API.
    expect(sql).toContain("create table if not exists repository_firmware_advisory_watch");
    expect(sql).toContain("repository_id text primary key references repositories(id) on delete cascade");

    // The outcome must keep the three answers distinct once persisted; collapsing a refusal or
    // an outage into "answered" is the false clean bill made durable.
    expect(sql).toContain("repository_firmware_advisory_watch_outcome_valid");
    for (const outcome of ["answered", "rejected", "unavailable", "no_provider", "nothing_searchable", "failed"]) {
      expect(sql, outcome).toContain(`'${outcome}'`);
    }

    expect(sql).toContain("repository_firmware_advisory_watch_due_idx");
  });

  it("adds a nullable rule-category column to findings in schema v62", async () => {
    const sql = (await readFile(join(migrationsDir, "0062_finding_category.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table findings");
    expect(sql).toContain("add column if not exists category text");
    expect(sql).toContain("findings_category_valid");
    expect(sql).toContain("category is null or category in (");
    expect(sql).toContain(
      "'electrical', 'manufacturability', 'assembly', 'testability', 'sourcing', 'release', 'unclassified'",
    );
  });

  it("creates workspace, project, revision, and delivery tables in schema v63", async () => {
    const sql = (await readFile(join(migrationsDir, "0063_workspace_project_model.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists workspaces");
    expect(sql).toContain("create table if not exists projects");
    expect(sql).toContain("create table if not exists revisions");
    expect(sql).toContain("create table if not exists deliveries");
    expect(sql).toContain("references workspaces(id) on delete cascade");
    expect(sql).toContain("references projects(id) on delete cascade");
    expect(sql).toContain("references revisions(id) on delete cascade");
    // This file also declared `workspace_memberships`, which 0052_billing.sql had already created
    // under a different shape, so the statement was a no-op in every database and the workspace
    // tree had no owner to authorize against. It was removed; 0064 adds `workspace_members`.
    expect(sql).not.toContain("create table if not exists workspace_memberships");
  });

  it("gives the workspace tree an owner to authorize against in schema v64", async () => {
    const sql = (
      await readFile(join(migrationsDir, "0064_workspace_membership_authorization.sql"), "utf8")
    ).toLowerCase();

    expect(sql).toContain("create table if not exists workspace_members");
    expect(sql).toContain("references workspaces(id) on delete cascade");
    expect(sql).toContain("primary key (workspace_id, user_id)");
    expect(sql).toContain("check (role in ('owner', 'admin', 'member', 'viewer'))");
  });

  it("stores review-canvas snapshot manifests per release run in schema v61", async () => {
    const sql = (await readFile(join(migrationsDir, "0061_run_snapshots.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists run_snapshots");
    expect(sql).toContain("references release_runs(id) on delete cascade");
    expect(sql).toContain("run_snapshots_kind_valid");
    expect(sql).toContain("'schematic', 'pcb_layer', '3d_render'");
    expect(sql).toContain("run_snapshots_format_valid");
    expect(sql).toContain("'svg', 'png', 'webp'");
    expect(sql).toContain("run_snapshots_sha256_valid");
    expect(sql).toContain("run_snapshots_anchors_valid");
    expect(sql).toContain("jsonb_typeof(anchors) = 'array'");
    expect(sql).toContain("run_snapshots_run_id_idx");
    expect(sql).toContain("on run_snapshots(run_id, created_at, id)");
  });

  it("deduplicates active Marketplace account erasures in schema v56", async () => {
    const sql = (await readFile(join(migrationsDir, "0056_marketplace_subscription_state.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("uq_erasure_requests_active_marketplace_account");
    expect(sql).toContain("unique index if not exists");
    expect(sql).toContain("on erasure_requests(tenant_id, scope)");
    expect(sql).toContain("requested_by = 'github_marketplace'");
    expect(sql).toContain("scope in ('organization', 'user')");
    expect(sql).toContain("status in ('pending', 'running', 'blocked_by_hold')");
  });

  it("enforces review approval uniqueness for active decisions in schema v57", async () => {
    const sql = (await readFile(join(migrationsDir, "0057_review_approval_uniqueness.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("uq_review_approval_active_decision");
    expect(sql).toContain("unique index if not exists");
    expect(sql).toContain("on review_approvals (review_id, revision_id, approver_id, status)");
    expect(sql).toContain("status in ('approved', 'changes_requested')");
  });

  it("adds distributor classification and price-break snapshot columns in schema v59", async () => {
    const sql = (await readFile(join(migrationsDir, "0059_component_pricing_snapshot.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table component_lifecycle_observations");
    expect(sql).toContain("add column if not exists distributor_classification text");
    expect(sql).toContain("add column if not exists price_breaks jsonb not null default '[]'::jsonb");
    expect(sql).toContain("component_lifecycle_observations_distributor_valid");
    expect(sql).toContain("'authorized-distributor', 'marketplace', 'unknown'");
    expect(sql).toContain("component_lifecycle_observations_price_breaks_valid");
    expect(sql).toContain("jsonb_typeof(price_breaks) = 'array'");
  });

  it("adds a nullable delivery id column and index for release-run traceability in schema v58", async () => {
    const sql = (await readFile(join(migrationsDir, "0058_release_run_delivery_id.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("alter table release_runs");
    expect(sql).toContain("add column if not exists delivery_id text");
    expect(sql).toContain("create index if not exists release_runs_delivery_id_idx");
    expect(sql).toContain("on release_runs(delivery_id)");
    expect(sql).toContain("where delivery_id is not null");
  });

  it("indexes canceled Marketplace subscriptions by stable installation id in schema v56", async () => {
    const sql = (await readFile(join(migrationsDir, "0056_marketplace_subscription_state.sql"), "utf8")).toLowerCase();

    expect(sql).toContain("idx_github_marketplace_subscriptions_canceled_installation");
    expect(sql).toContain("on github_marketplace_subscriptions(github_installation_id)");
    expect(sql).toContain("where status = 'canceled' and github_installation_id is not null");
  });

  it("persists provider-neutral artifact metadata in schema v39", async () => {
    const sql = await readFile(join(migrationsDir, "0039_artifact_metadata_contract.sql"), "utf8");

    expect(sql).toContain("add column if not exists execution_attempt_id text");
    expect(sql).toContain("add column if not exists content_type text");
    expect(sql).toContain("add column if not exists retention_until timestamptz");
    expect(sql).toContain("artifacts_execution_attempt_fk");
    expect(sql).toContain("runner_artifact_upload_capabilities_content_type_valid");
    expect(sql).toContain("boardreadyops_issue_artifact_upload_capabilities");
    expect(sql).toContain("boardreadyops_complete_artifact_upload");
    expect(sql).not.toContain("s3");
    expect(sql).not.toContain("r2");
    expect(sql).not.toContain("vercel");
  });

  it("indexes terminal one-time records for bounded retention cleanup", async () => {
    const sql = await readFile(join(migrationsDir, "0035_terminal_ephemeral_retention_indexes.sql"), "utf8");

    expect(sql).toContain("runner_artifact_upload_capabilities_terminal_retention_idx");
    expect(sql).toContain("where status in ('uploaded', 'failed', 'expired', 'revoked')");
    expect(sql).toContain("runner_registration_enrollments_terminal_retention_idx");
    expect(sql).toContain("where consumed_at is not null or revoked_at is not null");
    expect(sql).toContain("repository_setup_probes_terminal_retention_idx");
    expect(sql).toContain("where status in ('completed', 'failed', 'expired')");
  });

  it("indexes completed control-plane history for bounded retention cleanup", async () => {
    const sql = await readFile(join(migrationsDir, "0036_control_plane_history_retention_indexes.sql"), "utf8");

    expect(sql).toContain("control_plane_outbox_completed_retention_idx");
    expect(sql).toContain("where status = 'completed'");
    expect(sql).toContain("control_plane_reconciliation_completed_retention_idx");
    expect(sql).toContain("control_plane_reconciliation_subject_lookup_idx");
    expect(sql).toContain("boardreadyops_purge_completed_control_plane_outbox");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("lock table control_plane_reconciliation_items in share row exclusive mode");
    expect(sql).toContain("not exists");
  });

  it("stores versioned runner results and publication state", async () => {
    const sql = await readFile(join(migrationsDir, "0006_release_run_results.sql"), "utf8");

    expect(sql).toContain("create table if not exists release_run_results");
    expect(sql).toContain("contract_version integer not null");
    expect(sql).toContain("metrics jsonb not null");
    expect(sql).toContain("report_links jsonb not null");
    expect(sql).toContain("payload jsonb not null");
    expect(sql).toContain("pg_column_size(payload) <= 2097152");
    expect(sql).toContain("github_check_published_at timestamptz");
    expect(sql).toContain("github_comment_published_at timestamptz");
    expect(sql).toContain("last_publication_error text");
    expect(sql).toContain("release_run_results_execution_attempt_id_idx");
    expect(sql).toContain("create or replace function boardreadyops_reject_audit_event_mutation()");
    expect(sql).toContain("tg_op = 'DELETE' and pg_trigger_depth() > 1");
    expect(sql).toContain("audit_events is append-only");
  });

  it("binds release results to execution attempts and terminal digests", async () => {
    const sql = await readFile(join(migrationsDir, "0005_release_run_execution_attempts.sql"), "utf8");

    expect(sql).toContain("execution_attempt_id text");
    expect(sql).toContain("execution_attempt_started_at timestamptz");
    expect(sql).toContain("terminal_result_digest text");
    expect(sql).toContain("release_runs_execution_attempt_id_idx");
    expect(sql).toContain("release_runs_terminal_result_digest_valid");
  });

  it("tracks execution attempts separately from logical release runs", async () => {
    const sql = await readFile(join(migrationsDir, "0007_release_run_attempts.sql"), "utf8");

    expect(sql).toContain("create table if not exists release_run_attempts");
    expect(sql).toContain("attempt_number integer not null");
    expect(sql).toContain("github_workflow_dispatch_id text");
    expect(sql).toContain("release_run_attempts_status_valid");
    expect(sql).toContain("release_run_attempts_completion_valid");
    expect(sql).toContain("release_run_attempts_run_number_idx");
    expect(sql).toContain("release_run_attempts_active_idx");
    expect(sql).toContain("insert into release_run_attempts");
    expect(sql).toContain("where release_runs.execution_attempt_id is not null");
  });

  it("stores managed identities, attempt leases, and replay nonces", async () => {
    const sql = await readFile(join(migrationsDir, "0008_runner_protocol_leases.sql"), "utf8");

    expect(sql).toContain("add column if not exists signing_algorithm text not null default 'ed25519'");
    expect(sql).toContain("add column if not exists public_key text");
    expect(sql).toContain("runner_registrations_active_verification_key_valid");
    expect(sql).toContain("create table if not exists managed_runner_identities");
    expect(sql).toContain("create table if not exists runner_job_leases");
    expect(sql).toContain("lease_token_digest text not null");
    expect(sql).toContain("runner_job_leases_attempt_fk");
    expect(sql).toContain("runner_job_leases_worker_identity_valid");
    expect(sql).toContain("runner_job_leases_one_active_attempt_idx");
    expect(sql).toContain("boardreadyops_validate_runner_job_lease_scope");
    expect(sql).toContain("runner lease must target the current release-run attempt");
    expect(sql).toContain("self-hosted runner does not belong to the release-run installation");
    expect(sql).toContain("create table if not exists runner_request_nonces");
    expect(sql).toContain("nonce_digest text not null");
    expect(sql).toContain("runner_request_nonces_self_hosted_unique_idx");
    expect(sql).toContain("runner_request_nonces_managed_unique_idx");
    expect(sql).not.toContain("lease_token text");
    expect(sql).not.toContain("request_nonce text");
  });

  it("defers current-attempt lease validation and installs ordered lease operations", async () => {
    const sql = await readFile(join(migrationsDir, "0009_runner_lease_deferred_scope.sql"), "utf8");

    expect(sql).toContain("drop trigger if exists runner_job_leases_validate_scope");
    expect(sql).toContain("create constraint trigger runner_job_leases_validate_scope");
    expect(sql).toContain("after insert or update on runner_job_leases");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("boardreadyops_validate_runner_job_lease_scope()");
    expect(sql).toContain("boardreadyops_expire_runner_leases");
    expect(sql).toContain("boardreadyops_claim_runner_job");
    expect(sql).toContain("boardreadyops_heartbeat_runner_lease");
    expect(sql).toContain("boardreadyops_relinquish_runner_lease");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("for update of release_runs skip locked");
    expect(sql).not.toContain("before insert");
  });

  it("qualifies heartbeat lease columns in schema v10", async () => {
    const sql = await readFile(join(migrationsDir, "0010_runner_lease_heartbeat_qualification.sql"), "utf8");

    expect(sql).toContain("create or replace function boardreadyops_heartbeat_runner_lease");
    expect(sql).toContain("least(runner_job_leases.maximum_expires_at, p_extension_expires_at)");
    expect(sql).toContain("runner_job_leases.progress_percent");
    expect(sql).toContain("runner_job_leases.last_message");
    expect(sql).toContain("security invoker");
  });

  it("stores attempt-bound single-use artifact upload capabilities in schema v11", async () => {
    const sql = await readFile(join(migrationsDir, "0011_runner_artifact_upload_capabilities.sql"), "utf8");

    expect(sql).toContain("create table if not exists runner_artifact_upload_capabilities");
    expect(sql).toContain("upload_token_digest text not null");
    expect(sql).toContain("runner_artifact_upload_capabilities_lease_fk");
    expect(sql).toContain("boardreadyops_issue_artifact_upload_capabilities");
    expect(sql).toContain("boardreadyops_begin_artifact_upload");
    expect(sql).toContain("boardreadyops_complete_artifact_upload");
    expect(sql).toContain("boardreadyops_fail_artifact_upload");
    expect(sql).toContain("release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id");
    expect(sql).toContain("runner_job_leases.status = 'active'");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("upload_token text");
  });

  it("authorizes signed terminal results with body-bound nonce replay protection in schema v12", async () => {
    const sql = await readFile(join(migrationsDir, "0012_runner_terminal_result_authorization.sql"), "utf8");

    expect(sql).toContain("add column if not exists request_digest text");
    expect(sql).toContain("runner_request_nonces_request_digest_valid");
    expect(sql).toContain("boardreadyops_authorize_runner_terminal_result");
    expect(sql).toContain("runner_job_leases.lease_token_digest = p_lease_token_digest");
    expect(sql).toContain("release_runs.execution_attempt_id = runner_job_leases.execution_attempt_id");
    expect(sql).toContain("persisted_request_digest = p_request_digest");
    expect(sql).toContain("return 'conflicting_replay'");
    expect(sql).toContain("security invoker");
  });

  it("stores digest-only one-time runner enrollments in schema v13", async () => {
    const sql = await readFile(join(migrationsDir, "0013_runner_registration_enrollments.sql"), "utf8");

    expect(sql).toContain("create table if not exists runner_registration_enrollments");
    expect(sql).toContain("token_digest text not null unique");
    expect(sql).toContain("runner_registration_enrollments_one_active_idx");
    expect(sql).toContain("boardreadyops_issue_runner_registration_enrollment");
    expect(sql).toContain("boardreadyops_activate_runner_registration");
    expect(sql).toContain("runner.registration.enrollment_issued");
    expect(sql).toContain("runner.registration.activated");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("enrollment_token text");
  });

  it("stores durable webhook inbox and lease-based control-plane jobs in schema v15", async () => {
    const sql = await readFile(join(migrationsDir, "0015_control_plane_webhook_jobs.sql"), "utf8");

    expect(sql).toContain("create table if not exists webhook_inbox");
    expect(sql).toContain("unique (provider, delivery_id)");
    expect(sql).toContain("create table if not exists control_plane_jobs");
    expect(sql).toContain("boardreadyops_accept_github_webhook");
    expect(sql).toContain("boardreadyops_claim_control_plane_jobs");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("boardreadyops_complete_control_plane_job");
    expect(sql).toContain("boardreadyops_fail_control_plane_job");
    expect(sql).toContain("normalized_actions = '[]'::jsonb");
    expect(sql).toContain("boardreadyops_purge_expired_webhook_inbox");
    expect(sql).toContain("retention_until <= p_now");
    expect(sql).toContain("security invoker");
  });

  it("stores tenant-scoped execution routing policies in schema v14", async () => {
    const sql = await readFile(join(migrationsDir, "0014_runner_execution_routing_policies.sql"), "utf8");

    expect(sql).toContain("create table if not exists runner_execution_policies");
    expect(sql).toContain("runner_execution_policies_repository_scope_fk");
    expect(sql).toContain("managed_only");
    expect(sql).toContain("self_hosted_required");
    expect(sql).toContain("self_hosted_preferred");
    expect(sql).toContain("disabled");
    expect(sql).toContain("boardreadyops_effective_runner_policy");
    expect(sql).toContain("policy_source");
    expect(sql).toContain("no_eligible_self_hosted_runner_online");
    expect(sql).toContain("routingPolicyMode");
    expect(sql).toContain("routingPolicySource");
    expect(sql).toContain("for update of release_runs skip locked");
    expect(sql).toContain("security invoker");
  });

  it("keeps the release-run lifecycle index migration idempotent", async () => {
    const sql = await readFile(join(migrationsDir, "0002_release_run_lifecycle.sql"), "utf8");

    expect(sql).toContain("create index if not exists release_runs_active_pr_idx");
    expect(sql).toContain("where status in ('queued', 'dispatched', 'running')");
  });

  it("keeps runner registrations tenant-scoped and lifecycle constrained", async () => {
    const sql = await readFile(join(migrationsDir, "0003_runner_registrations.sql"), "utf8");

    expect(sql).toContain("references installations(id) on delete cascade");
    expect(sql).toContain("unique (installation_id, name)");
    expect(sql).toContain("check (scope in ('installation', 'organization', 'repository'))");
    expect(sql).toContain("check (status in ('pending', 'active', 'stale', 'disabled'))");
    expect(sql).toContain("constraint runner_registrations_active_identity_valid");
    expect(sql).toContain("public_key_fingerprint is not null");
    expect(sql).toContain("last_heartbeat_at is not null");
    expect(sql).toContain("constraint runner_registrations_disabled_state_valid");
    expect(sql).toContain("create unique index if not exists runner_registrations_installation_fingerprint_idx");
    expect(sql).toContain("create index if not exists runner_registrations_active_heartbeat_idx");
    expect(sql).toContain("where status = 'active' and disabled_at is null");
  });

  it("keeps audit events tenant-scoped, bounded, and append-only", async () => {
    const sql = await readFile(join(migrationsDir, "0004_audit_logs.sql"), "utf8");

    expect(sql).toContain("create table if not exists audit_events");
    expect(sql).toContain("installation_id text not null references installations(id) on delete cascade");
    expect(sql).toContain("runner_registration_id text references runner_registrations(id) on delete set null");
    expect(sql).toContain("constraint audit_events_metadata_valid");
    expect(sql).toContain("jsonb_typeof(metadata) = 'object'");
    expect(sql).toContain("pg_column_size(metadata) <= 65536");
    expect(sql).toContain("constraint audit_events_release_run_dimension_valid");
    expect(sql).toContain("constraint audit_events_artifact_dimension_valid");
    expect(sql).toContain("boardreadyops_validate_audit_event_scope");
    expect(sql).toContain("audit repository does not belong to installation");
    expect(sql).toContain("audit release run does not belong to repository");
    expect(sql).toContain("audit artifact does not belong to release run");
    expect(sql).toContain("audit runner does not belong to installation");
    expect(sql).toContain("boardreadyops_reject_audit_event_mutation");
    expect(sql).toContain("before update or delete on audit_events");
    expect(sql).toContain("audit_events is append-only");
  });

  it("keeps audit query indexes tenant-prefixed and deterministic", async () => {
    const sql = await readFile(join(migrationsDir, "0004_audit_logs.sql"), "utf8");

    expect(sql).toContain("on audit_events(installation_id, created_at desc, id desc)");
    expect(sql).toContain("on audit_events(installation_id, event_type, created_at desc, id desc)");
    expect(sql).toContain("on audit_events(installation_id, repository_id, created_at desc, id desc)");
    expect(sql).toContain("on audit_events(installation_id, release_run_id, created_at desc, id desc)");
    expect(sql).toContain("on audit_events(installation_id, artifact_id, created_at desc, id desc)");
    expect(sql).toContain("on audit_events(installation_id, runner_registration_id, created_at desc, id desc)");
    expect(sql).toContain("on audit_events(installation_id, request_id, created_at desc, id desc)");
  });

  it("stores repository-scoped artifact retention overrides in schema v84", async () => {
    const sql = await readFile(join(migrationsDir, "0084_repository_retention_policies.sql"), "utf8");

    expect(sql).toContain("create table if not exists repository_retention_policies");
    expect(sql).toContain("repository_id text primary key references repositories(id) on delete cascade");
    expect(sql).toContain("retention_days is null or retention_days between 1 and 3650");
    expect(sql).toContain("0084_repository_retention_policies");
    expect(sql).not.toMatch(/^\s*tenant_id\s+/gmu);
  });

  it("keeps the initial schema idempotent", async () => {
    const sql = await readFile(join(migrationsDir, "0001_cloud_schema.sql"), "utf8");

    expect(sql).toContain("create table if not exists installations");
    expect(sql).toContain("create table if not exists repositories");
    expect(sql).toContain("create table if not exists release_runs");
    expect(sql).toContain("cloud_schema_migrations");
    expect(sql).toContain("idempotency_key text unique");
    expect(sql).toContain("github_check_run_id bigint");
  });
  it("indexes bounded run investigation queries in schema v31", async () => {
    const sql = await readFile(join(migrationsDir, "0031_run_investigation_indexes.sql"), "utf8");

    expect(sql).toContain("findings_run_severity_waiver_idx");
    expect(sql).toContain("on findings(run_id, lower(severity), waived_at, rule_id, id)");
    expect(sql).toContain("findings_run_rule_path_idx");
    expect(sql).toContain("findings_run_path_rule_idx");
    expect(sql).toContain("artifacts_run_uploaded_idx");
    expect(sql).toContain("artifacts_run_name_idx");
    expect(sql).toContain("artifacts_run_size_idx");
    expect(sql).toContain("artifacts_run_role_kind_idx");
    expect(sql).toContain("artifacts_run_kind_idx");
  });

  it("stores durable tenant-scoped artifact deletion jobs in schema v30", async () => {
    const sql = await readFile(join(migrationsDir, "0030_artifact_deletion_jobs.sql"), "utf8");

    expect(sql).toContain("create table if not exists artifact_deletion_jobs");
    expect(sql).toContain("boardreadyops_claim_artifact_deletions");
    expect(sql).toContain("boardreadyops_complete_artifact_deletion");
    expect(sql).toContain("boardreadyops_fail_artifact_deletion");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("artifact.object.deleted");
    expect(sql).toContain("artifact.object.deletion_failed");
    expect(sql).toContain("updated_expired");
    expect(sql).toContain("'errorClass', 'lease_expired'");
    expect(sql).toContain("references installations(id) on delete cascade");
    expect(sql).toContain("references repositories(id) on delete cascade");
    expect(sql).toContain("references release_runs(id) on delete cascade");
    expect(sql).toContain("boardreadyops_validate_artifact_deletion_job_scope");
    expect(sql).toContain("security invoker");
  });
});
