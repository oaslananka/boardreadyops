import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0020_github_workflow_reconciliation.sql");

describe("GitHub workflow reconciliation migration", () => {
  it("publishes schema v20", () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(20);
  });

  it("detects only current non-terminal attempts with an authoritative workflow id", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_detect_github_workflow_reconciliation");
    expect(sql).toContain("release_runs.execution_attempt_id = release_run_attempts.id");
    expect(sql).toContain("github_workflow_dispatch_id is not null");
    expect(sql).toContain("status in ('dispatched', 'in_progress', 'uploading_artifacts', 'reporting')");
    expect(sql).toContain("'callback_missing'");
    expect(sql).toContain("'attempt_stale'");
    expect(sql).toContain("observed_from + make_interval(secs => p_terminal_deadline_seconds)");
    expect(sql).toContain("existing.execution_attempt_id = release_run_attempts.id");
    expect(sql).toContain("on conflict do nothing");
  });

  it("returns lease-bound tenant context without payload-bearing columns", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_claim_github_workflow_reconciliation");
    expect(sql).toContain("boardreadyops_github_workflow_reconciliation_context");
    expect(sql).toContain("github_installation_id bigint");
    expect(sql).toContain("repository_owner text");
    expect(sql).toContain("repository_name text");
    expect(sql).toContain("github_workflow_run_id text");
    expect(sql).toContain("lease_owner = p_worker_id");
    expect(sql).not.toContain("normalized_actions");
    expect(sql).not.toContain("webhook_payload");
    expect(sql).not.toContain("payload jsonb");
  });

  it("reschedules pending observations and atomically terminalizes current attempts", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_reschedule_github_workflow_reconciliation");
    expect(sql).toContain("boardreadyops_apply_github_workflow_reconciliation");
    expect(sql).toContain("for update of control_plane_reconciliation_items, release_run_attempts, release_runs");
    expect(sql).toContain("release_runs.execution_attempt_id = release_run_attempts.id");
    expect(sql).toContain("insert into audit_events");
    expect(sql).toContain("control_plane.github_workflow_reconciled");
    expect(sql).toContain("workflow reconciliation lease changed while applying the terminal result");
    expect(sql).toContain("security invoker");
  });
});
