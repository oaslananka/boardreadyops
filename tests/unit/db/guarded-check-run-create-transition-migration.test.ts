import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0025_guarded_check_run_create_transition.sql");

describe("guarded Check Run creation transition migration", () => {
  it("publishes schema v25 and binds Check Run creation to one run version", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(25);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("control_plane_outbox_effect_version_binding");
    expect(sql).toContain("effect_type = 'github.check_run.create'");
    expect(sql).toContain("expected_run_version is not null");
    expect(sql).toContain("expected_attempt_version is null");
    expect(sql).toContain("effect_type = 'github.workflow.dispatch'");
    expect(sql).toContain("expected_attempt_version is not null");
  });

  it("backfills and preserves the original Check Run creation binding on replay", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("control_plane_outbox.effect_type = 'github.check_run.create'");
    expect(sql).toContain("set expected_run_version = release_runs.version");
    expect(sql).toContain("existing.idempotency_key = new.idempotency_key");
    expect(sql).toContain("new.expected_run_version := v_run_version");
    expect(sql).toContain("new.expected_attempt_version := v_attempt_version");
    expect(sql).toContain("before insert on control_plane_outbox");
    expect(sql).not.toContain("before insert or update on control_plane_outbox");
  });

  it("guards safe-mode completion with the v23 transition function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const completion = sql.slice(
      sql.indexOf("create or replace function boardreadyops_complete_check_run_create_effect"),
    );

    expect(completion).toContain("boardreadyops_transition_release_run_state(");
    expect(completion).toContain("'queued'");
    expect(completion).toContain("'completed'");
    expect(completion).toContain("'check_run_safe_mode_completed'");
    expect(completion).toContain("decision = 'neutral'");
    expect(completion).toContain("v_transition_outcome <> 'applied'");
  });

  it("increments the run version when binding a new execution attempt", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const completion = sql.slice(
      sql.indexOf("create or replace function boardreadyops_complete_check_run_create_effect"),
    );

    expect(completion).toContain("release_runs.execution_attempt_id is null");
    expect(completion).toContain("insert into release_run_attempts");
    expect(completion).toContain("attempt_number");
    expect(completion).toContain("status");
    expect(completion).toContain("version");
    expect(completion).toContain("dispatch_requested_at");
    expect(completion).toContain("version = release_runs.version + 1");
    expect(completion).toContain("release_runs.version = v_expected_run_version");
    expect(completion).toContain("github.workflow.dispatch");
  });

  it("keeps stale paths mutation-free and preserves conflict quarantine", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const completion = sql.slice(
      sql.indexOf("create or replace function boardreadyops_complete_check_run_create_effect"),
    );

    expect(completion).toContain("return query select 'stale'::text");
    expect(completion).toContain("'check_run_conflict'::text");
    expect(completion).toContain("status = 'reconciliation_required'");
    expect(completion).toContain("lease_owner = p_worker_id");
    expect(completion).toContain("security invoker");
  });
});
