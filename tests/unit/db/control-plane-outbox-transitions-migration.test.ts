import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0018_control_plane_outbox_transitions.sql");

describe("control-plane outbox transition migration", () => {
  it("publishes schema version 18", () => {
    expect(cloudDatabaseSchemaVersion).toBe(18);
  });

  it("atomically advances Check Run creation to the next durable effect", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_complete_check_run_create_effect");
    expect(sql).toContain("github_check_run_id");
    expect(sql).toContain("insert into release_run_attempts");
    expect(sql).toContain("github.workflow.dispatch");
    expect(sql).toContain("github.check_run.complete");
    expect(sql).toContain("insert into control_plane_outbox");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("security invoker");
  });

  it("completes workflow delivery only with an authoritative run transition", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_complete_workflow_dispatch_effect");
    expect(sql).toContain("github_workflow_dispatch_id");
    expect(sql).toContain("status = 'dispatched'");
    expect(sql).toContain("from updated_run");
    expect(sql).toContain("updated_run.id = v_release_run_id");
    expect(sql).toContain("lease_owner = p_worker_id");
    expect(sql).toContain("return 'stale'");
  });
});
