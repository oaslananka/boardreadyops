import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("BoardReadyOps Cloud migrations", () => {
  it("publishes the runner-result schema version and models", () => {
    expect(cloudDatabaseSchemaVersion).toBe(6);
    expect(cloudDatabaseModels).toContain("RunnerRegistration");
    expect(cloudDatabaseModels).toContain("AuditEvent");
    expect(cloudDatabaseModels).toContain("ReleaseRunResult");
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
