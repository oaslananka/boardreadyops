import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0024_guarded_workflow_dispatch_transition.sql");

describe("guarded workflow-dispatch transition migration", () => {
  it("publishes schema v24 and stores creation-time expected versions", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(24);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("alter table control_plane_outbox");
    expect(sql).toContain("add column if not exists expected_run_version bigint");
    expect(sql).toContain("add column if not exists expected_attempt_version bigint");
    expect(sql).toContain("control_plane_outbox_expected_versions_non_negative");
    expect(sql).toContain("control_plane_outbox_workflow_dispatch_version_binding");
    expect(sql).toContain("effect_type = 'github.workflow.dispatch'");
    expect(sql).toContain("expected_run_version is not null");
    expect(sql).toContain("expected_attempt_version is not null");
  });

  it("backfills existing workflow-dispatch effects before validating the binding", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("update control_plane_outbox");
    expect(sql).toContain("set expected_run_version = release_runs.version");
    expect(sql).toContain("expected_attempt_version = release_run_attempts.version");
    expect(sql).toContain("from release_runs");
    expect(sql).toContain("join release_run_attempts");
    expect(sql).toContain("control_plane_outbox.effect_type = 'github.workflow.dispatch'");
    expect(sql).toContain("validate constraint control_plane_outbox_workflow_dispatch_version_binding");
  });

  it("derives immutable expected versions at workflow-effect insertion", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_bind_workflow_dispatch_versions");
    expect(sql).toContain("new.effect_type <> 'github.workflow.dispatch'");
    expect(sql).toContain("release_runs.execution_attempt_id = release_run_attempts.id");
    expect(sql).toContain("release_run_attempts.run_id = release_runs.id");
    expect(sql).toContain("new.expected_run_version := v_run_version");
    expect(sql).toContain("new.expected_attempt_version := v_attempt_version");
    expect(sql).toContain("before insert on control_plane_outbox");
    expect(sql).not.toContain("before insert or update on control_plane_outbox");
  });

  it("completes workflow delivery through the v23 guarded transition function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const completion = sql.slice(
      sql.indexOf("create or replace function boardreadyops_complete_workflow_dispatch_effect"),
    );

    expect(completion).toContain("expected_run_version");
    expect(completion).toContain("expected_attempt_version");
    expect(completion).toContain("boardreadyops_transition_release_run_state(");
    expect(completion).toContain("'queued'");
    expect(completion).toContain("'dispatching'");
    expect(completion).toContain("'dispatched'");
    expect(completion).toContain("'workflow_dispatch_completed'");
    expect(completion).toContain("v_transition_outcome <> 'applied'");
    expect(completion).toContain("return 'stale'");
    expect(completion).not.toContain("set status = 'dispatched'");
  });

  it("persists dispatch metadata only after the guarded version increment", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("v_transition_attempt_version");
    expect(sql).toContain("github_workflow_dispatch_id = coalesce(");
    expect(sql).toContain("release_run_attempts.version = v_transition_attempt_version");
    expect(sql).toContain("workflowRunUrl");
    expect(sql).toContain("lease_owner = p_worker_id");
    expect(sql).toContain("security invoker");
  });
});
