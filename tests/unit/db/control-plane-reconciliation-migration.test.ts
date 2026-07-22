import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(
  process.cwd(),
  "packages/db/migrations/0019_control_plane_reconciliation_operations.sql",
);

describe("control-plane reconciliation operations migration", () => {
  it("publishes schema v19 operations models", () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(19);
    expect(cloudDatabaseModels).toContain("ControlPlaneReconciliationItem");
    expect(cloudDatabaseModels).toContain("ControlPlaneReplayOperation");
  });

  it("defines a payload-free tenant-scoped reconciliation queue", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create table if not exists control_plane_reconciliation_items");
    expect(sql).toContain("installation_id text not null references installations(id)");
    expect(sql).toContain("subject_type in ('job', 'outbox', 'release_run', 'execution_attempt')");
    expect(sql).toContain("status in ('available', 'leased', 'completed', 'dead_letter')");
    expect(sql).toContain("boardreadyops_validate_reconciliation_scope");
    expect(sql).toContain("control_plane_reconciliation_active_subject_idx");
    expect(sql).not.toContain("normalized_actions jsonb");
    expect(sql).not.toContain("payload jsonb");
  });

  it("defines idempotent audited replay and blocks uncertain dispatch replay", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create table if not exists control_plane_replay_operations");
    expect(sql).toContain("boardreadyops_list_control_plane_dead_letters");
    expect(sql).toContain("boardreadyops_replay_control_plane_dead_letter");
    expect(sql).toContain("insert into audit_events");
    expect(sql).toContain("status = 'dead_letter'");
    expect(sql).toContain("status = 'reconciliation_required'");
    expect(sql).toContain("return query select 'not_replayable'");
  });

  it("defines lease-based reconciliation and privacy-safe SLIs", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_enqueue_control_plane_reconciliation");
    expect(sql).toContain("boardreadyops_claim_control_plane_reconciliation");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("boardreadyops_complete_control_plane_reconciliation");
    expect(sql).toContain("boardreadyops_fail_control_plane_reconciliation");
    expect(sql).toContain("boardreadyops_control_plane_sli_snapshot");
    expect(sql).toContain("percentile_cont(0.95)");
    expect(sql).toContain("terminal_failure_rate_basis_points");
    expect(sql).toContain("security invoker");
  });
});
