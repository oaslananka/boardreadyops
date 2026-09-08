import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL("../../../packages/db/migrations/0065_setup_incomplete_release_runs.sql", import.meta.url);

describe("setup-incomplete release-run migration", () => {
  it("marks the durable Check Run payload from the authoritative setup revision snapshot", async () => {
    expect(existsSync(migration)).toBe(true);
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_enqueue_release_run_with_outbox(");
    expect(sql).toContain("left join repository_setup_revisions setup_revision");
    expect(sql).toContain("setup_revision.workflow_status");
    expect(sql).toContain("setup_revision.config_status");
    expect(sql).toContain("v_setup_workflow_status is distinct from 'ready'");
    expect(sql).toContain("v_setup_config_status is distinct from 'ready'");
    expect(sql).toContain("'{action,setupIncomplete}'");
    expect(sql).toContain("'true'::jsonb");
  });
});
