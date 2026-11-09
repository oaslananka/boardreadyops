import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "packages/db/migrations/0113_workflow_reconciliation_pending_poll_budget.sql",
);

describe("workflow reconciliation pending observations preserve the error budget", () => {
  it("uses an additive migration that keeps lease and deadline guards", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function boardreadyops_reschedule_github_workflow_reconciliation");
    expect(sql).toContain("attempt_count = 0");
    expect(sql).toContain("lease_owner = p_worker_id");
    expect(sql).toContain("subject_type = 'execution_attempt'");
    expect(sql).toContain("reason_code in ('callback_missing', 'attempt_stale')");
    expect(sql).toContain("p_now >= v_item.deadline_at");
    expect(sql).toContain("next_check_at = least(p_next_check_at, deadline_at)");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("update release_runs");
    expect(sql).not.toContain("update release_run_attempts");
  });
});
