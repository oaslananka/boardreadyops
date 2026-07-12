import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("BoardReadyOps Cloud migrations", () => {
  it("publishes the runner-protocol schema version and models", () => {
    expect(cloudDatabaseSchemaVersion).toBe(10);
    expect(cloudDatabaseModels).toContain("RunnerRegistration");
    expect(cloudDatabaseModels).toContain("ManagedRunnerIdentity");
    expect(cloudDatabaseModels).toContain("RunnerJobLease");
    expect(cloudDatabaseModels).toContain("RunnerRequestNonce");
    expect(cloudDatabaseModels).toContain("AuditEvent");
    expect(cloudDatabaseModels).toContain("ReleaseRunResult");
    expect(cloudDatabaseModels).toContain("ReleaseRunAttempt");
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
    ]);
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

  it("keeps the initial schema idempotent", async () => {
    const sql = await readFile(join(migrationsDir, "0001_cloud_schema.sql"), "utf8");

    expect(sql).toContain("create table if not exists installations");
    expect(sql).toContain("create table if not exists repositories");
    expect(sql).toContain("create table if not exists release_runs");
    expect(sql).toContain("cloud_schema_migrations");
    expect(sql).toContain("idempotency_key text unique");
    expect(sql).toContain("github_check_run_id bigint");
  });
});
