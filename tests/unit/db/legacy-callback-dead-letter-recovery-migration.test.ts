import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "packages/db/migrations/0129_legacy_callback_dead_letter_recovery.sql");

describe("manual recovery of pre-fix callback-missing dead letters", () => {
  it("installs a narrowly scoped opt-in function with immutable run/attempt CAS guards", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function boardreadyops_reactivate_legacy_callback_dead_letter");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("from public;");
    expect(sql).toContain("and r.started_at >= v_now - interval '24 days'");
    expect(sql).toContain("c.installation_id = p_installation_id");
    expect(sql).toContain("repo.disabled_at is null");
    expect(sql).toContain("i.suspended_at is null");
    expect(sql).toContain("r.version = v_item.expected_run_version");
    expect(sql).toContain("a.version = v_item.expected_attempt_version");
    expect(sql).toContain("a.github_workflow_dispatch_id = p_expected_workflow_run_id");
    expect(sql).toContain("r.github_check_run_id = p_expected_check_run_id");
    expect(sql).toContain("r.terminal_result_digest is null");
    expect(sql).toContain("not exists (\n       select 1 from release_run_results signed");
    expect(sql).toContain("attempt_count = 0");
    expect(sql).toContain("status = 'available'");
    expect(sql).toContain("control_plane.legacy_callback_reconciliation_reactivated");
    expect(sql).not.toMatch(/update\s+release_runs\b/iu);
    expect(sql).not.toMatch(/update\s+release_run_attempts\b/iu);
    expect(sql).not.toMatch(/update\s+control_plane_outbox\b/iu);
    expect(sql).not.toMatch(/create\s+trigger\b/iu);
  });
});
