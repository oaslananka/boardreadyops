import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0029_guarded_runner_lease_transitions.sql");

describe("guarded runner lease transitions migration", () => {
  it("publishes schema v29 with immutable lease lifecycle bindings", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(29);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("add column if not exists expected_run_status text");
    expect(sql).toContain("add column if not exists expected_run_version bigint");
    expect(sql).toContain("add column if not exists expected_attempt_status text");
    expect(sql).toContain("add column if not exists expected_attempt_version bigint");
    expect(sql).toContain("runner_job_leases_expected_run_version_valid");
    expect(sql).toContain("runner_job_leases_expected_attempt_version_valid");
    expect(sql).toContain("alter column expected_run_status set not null");
    expect(sql).toContain("alter column expected_attempt_version set not null");
  });

  it("extends the logical run graph only for bounded runner retry", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_release_run_transition_allowed(");
    expect(sql).toContain("when p_from_status = 'running' and p_to_status in (");
    expect(sql).toContain("'queued', 'completed', 'failed', 'timed_out', 'cancelled', 'superseded'");
    expect(sql).toContain("runner_lease_relinquished");
    expect(sql).toContain("runner_lease_expired");
  });

  it("guards claim and binds the created lease to the authoritative snapshot", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_claim_runner_job(");
    expect(sql).toContain("selected_run_version bigint");
    expect(sql).toContain("version = release_runs.version + 1");
    expect(sql).toContain("expected_run_status");
    expect(sql).toContain("expected_attempt_status");
    expect(sql).toContain("'runner_lease_claimed'");
    expect(sql).toContain("insert into public.release_run_transition_events");
  });

  it("guards heartbeat and versions only real attempt status changes", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_heartbeat_runner_lease(");
    expect(sql).toContain("run_record.version is not distinct from lease_record.expected_run_version");
    expect(sql).toContain("attempt_record.version is not distinct from lease_record.expected_attempt_version");
    expect(sql).toContain("next_attempt_status is distinct from attempt_record.status");
    expect(sql).toContain("version = release_run_attempts.version + 1");
    expect(sql).toContain("'runner_lease_heartbeat'");
    expect(sql).toContain("expected_attempt_version = next_attempt_version");
  });

  it("guards relinquish and expiry while closing stale leases without lifecycle writes", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_relinquish_runner_lease(");
    expect(sql).toContain("create or replace function boardreadyops_expire_runner_leases(");
    expect(sql).toContain("lifecycle_binding_valid");
    expect(sql).toContain("when lifecycle_binding_valid then 'queued'");
    expect(sql).toContain("version = release_runs.version + 1");
    expect(sql).toContain("version = release_run_attempts.version + 1");
    expect(sql).toContain("when lifecycle_binding_valid then next_run_version");
    expect(sql).toContain("when lifecycle_binding_valid then next_attempt_version");
    expect(sql).toContain("'runner_lease_relinquished'");
    expect(sql).toContain("'runner_lease_expired'");
    expect(sql).toContain("insert into public.release_run_transition_events");
  });
});
