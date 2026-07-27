import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0026_guarded_workflow_reconciliation_transition.sql");

describe("guarded workflow reconciliation transition migration", () => {
  it("publishes schema v26 with a complete workflow snapshot shape", async () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(26);
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("expected_run_status");
    expect(sql).toContain("expected_run_version");
    expect(sql).toContain("expected_attempt_status");
    expect(sql).toContain("expected_attempt_version");
    expect(sql).toContain("control_plane_reconciliation_workflow_snapshot");
    expect(sql).toContain("reason_code in ('callback_missing', 'attempt_stale')");
    expect(sql).toContain("expected_run_version >= 0");
    expect(sql).toContain("expected_attempt_version >= 0");
  });

  it("binds the current run and attempt after scope validation and keeps the snapshot immutable", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_bind_workflow_reconciliation_snapshot");
    expect(sql).toContain("control_plane_reconciliation_workflow_snapshot_bind");
    expect(sql).toContain("before insert on control_plane_reconciliation_items");
    expect(sql).toContain("release_runs.execution_attempt_id = release_run_attempts.id");
    expect(sql).toContain("release_runs.status in ('queued', 'dispatched', 'running')");
    expect(sql).toContain(
      "release_run_attempts.status in ('dispatched', 'in_progress', 'uploading_artifacts', 'reporting')",
    );
    expect(sql).toContain("control_plane_reconciliation_workflow_snapshot_immutable");
    expect(sql).toContain("workflow reconciliation snapshot is immutable");
    expect("control_plane_reconciliation_validate_scope" < "control_plane_reconciliation_workflow_snapshot_bind").toBe(
      true,
    );
  });

  it("returns context only while the detection-time snapshot is still current", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const context = sql.slice(
      sql.indexOf("create or replace function boardreadyops_github_workflow_reconciliation_context"),
    );

    expect(context).toContain("release_runs.status = control_plane_reconciliation_items.expected_run_status");
    expect(context).toContain("release_runs.version = control_plane_reconciliation_items.expected_run_version");
    expect(context).toContain(
      "release_run_attempts.status = control_plane_reconciliation_items.expected_attempt_status",
    );
    expect(context).toContain(
      "release_run_attempts.version = control_plane_reconciliation_items.expected_attempt_version",
    );
    expect(context).toContain("release_runs.execution_attempt_id = release_run_attempts.id");
    expect(context).toContain("lease_owner = p_worker_id");
  });

  it("terminalizes through the v23 guarded transition without direct status writes", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const apply = sql.slice(
      sql.indexOf("create or replace function boardreadyops_apply_github_workflow_reconciliation"),
    );

    expect(apply).toContain("boardreadyops_transition_release_run_state(");
    expect(apply).toContain("v_item.expected_run_status");
    expect(apply).toContain("v_item.expected_run_version");
    expect(apply).toContain("v_item.expected_attempt_status");
    expect(apply).toContain("v_item.expected_attempt_version");
    expect(apply).toContain("'github_workflow_reconciled'");
    expect(apply).toContain("v_transition_outcome <> 'applied'");
    expect(apply).not.toContain("set status = p_terminal_status");
    expect(apply).toContain("failure_class = coalesce");
    expect(apply).toContain("control_plane.github_workflow_reconciled");
  });

  it("preserves already-terminal and lease-loss behavior", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const apply = sql.slice(
      sql.indexOf("create or replace function boardreadyops_apply_github_workflow_reconciliation"),
    );

    expect(apply).toContain("v_outcome := 'already_terminal'");
    expect(apply).toContain("return 'stale'");
    expect(apply).toContain("workflow reconciliation lease changed while applying the terminal result");
    expect(apply).toContain("security invoker");
  });
});
