import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(
  process.cwd(),
  "packages/db/migrations/0016_control_plane_transactional_outbox.sql",
);

describe("control-plane transactional outbox migration", () => {
  it("publishes schema version 16 and the outbox model", () => {
    expect(cloudDatabaseSchemaVersion).toBe(16);
    expect(cloudDatabaseModels).toContain("ControlPlaneOutbox");
  });

  it("defines bounded lease-based effects and safe reconciliation", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create table if not exists control_plane_outbox");
    expect(sql).toContain("idempotency_key text not null unique");
    expect(sql).toContain("payload_version integer not null default 1");
    expect(sql).toContain("jsonb_typeof(payload) = 'object'");
    expect(sql).toContain("pg_column_size(payload) <= 262144");
    expect(sql).toContain("github.check_run.create");
    expect(sql).toContain("github.check_run.complete");
    expect(sql).toContain("github.workflow.dispatch");
    expect(sql).toContain("reconciliation_required");
    expect(sql).toContain("boardreadyops_claim_control_plane_outbox");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("boardreadyops_mark_control_plane_outbox_delivery_started");
    expect(sql).toContain("boardreadyops_complete_control_plane_outbox");
    expect(sql).toContain("boardreadyops_fail_control_plane_outbox");
    expect(sql).toContain("boardreadyops_replay_control_plane_outbox");
    expect(sql).toContain("security invoker");
  });

  it("does not automatically replay an uncertain workflow dispatch", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("effect_type = 'github.workflow.dispatch'");
    expect(sql).toContain("delivery_started_at is not null");
    expect(sql).toContain("then 'reconciliation_required'");
    expect(sql).toContain("status <> 'reconciliation_required'");
  });
});
