import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0028_guarded_runner_result_transition.sql");

describe("guarded runner result transition migration", () => {
  it("publishes schema v28 with a callback-specific guarded helper", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(28);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_apply_runner_result_state(");
    expect(sql).toContain("p_apply boolean");
    expect(sql).toContain("if not p_apply then");
    expect(sql).toContain("'skipped'::text");
    expect(sql).toContain("p_expected_run_status text");
    expect(sql).toContain("p_expected_run_version bigint");
    expect(sql).toContain("p_expected_execution_attempt_id text");
    expect(sql).toContain("p_expected_attempt_status text");
    expect(sql).toContain("p_expected_attempt_version bigint");
    expect(sql).toContain("p_result_status text");
    expect(sql).toContain("security invoker");
  });

  it("fails closed when the authoritative run or attempt snapshot drifts", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("v_run.status is distinct from p_expected_run_status");
    expect(sql).toContain("v_run.version is distinct from p_expected_run_version");
    expect(sql).toContain("v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id");
    expect(sql).toContain("v_attempt.status is distinct from p_expected_attempt_status");
    expect(sql).toContain("v_attempt.version is distinct from p_expected_attempt_version");
    expect(sql).toContain("'stale'::text");
    expect(sql).toContain("'not_found'::text");
    expect(sql).toContain("'invalid_transition'::text");
  });

  it("preserves callback status mapping and legacy no-attempt callbacks", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("when p_result_status = 'queued' then 'dispatching'");
    expect(sql).toContain("when p_result_status = 'running' then 'in_progress'");
    expect(sql).toContain("else p_result_status");
    expect(sql).toContain("p_expected_execution_attempt_id is null");
    expect(sql).toContain("p_expected_attempt_status is not null");
    expect(sql).toContain("p_expected_attempt_version is not null");
  });

  it("updates callback metadata while incrementing versions only for status changes", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("decision = p_decision");
    expect(sql).toContain("terminal_result_digest = case");
    expect(sql).toContain("result_digest = case");
    expect(sql).toContain("heartbeat_at = p_received_at");
    expect(sql).toContain("v_run_changed := v_next_run_status is distinct from v_run.status;");
    expect(sql).toContain(
      "v_attempt_changed := v_attempt.id is not null and v_next_attempt_status is distinct from v_attempt.status;",
    );
    expect(sql).toContain("v_run_to_version := v_run.version + case when v_run_changed then 1 else 0 end;");
    expect(sql).toContain("v_attempt_to_version := v_attempt.version + case when v_attempt_changed then 1 else 0 end;");
  });

  it("writes scoped append-only events only for changed entities", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("insert into release_run_transition_events");
    expect(sql).toContain("'release_run'");
    expect(sql).toContain("'execution_attempt'");
    expect(sql).toContain("'runner_result_' || p_result_status");
    expect(sql).toContain("run_changed boolean");
    expect(sql).toContain("attempt_changed boolean");
    expect(sql).toContain("'applied'::text");
  });
});
