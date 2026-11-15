import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "packages/db/migrations/0130_completed_safe_mode_check_run_reconciliation.sql",
);

describe("terminal safe-mode skip Check Run reconciliation", () => {
  it("excludes only a recorded neutral draft/fork skip with a completed matching Check Run", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function boardreadyops_detect_github_check_run_reconciliation");
    expect(sql).toContain("left join release_run_results on release_run_results.run_id = release_runs.id");
    expect(sql).toContain("release_runs.decision = 'neutral'");
    expect(sql).toContain("release_runs.trust_mode = 'safe'");
    expect(sql).toContain("'draft-pull-request' = any(release_runs.safe_mode_reasons)");
    expect(sql).toContain("'fork-pull-request' = any(release_runs.safe_mode_reasons)");
    expect(sql).toContain("completed_skip.release_run_id = release_runs.id");
    expect(sql).toContain("completed_skip.effect_type = 'github.check_run.complete'");
    expect(sql).toContain("completed_skip.status = 'completed'");
    expect(sql).toContain(
      "completed_skip.payload -> 'input' ->> 'checkRunId' = release_runs.github_check_run_id::text",
    );
    expect(sql).toContain("completed_skip.payload -> 'input' ->> 'conclusion' = 'neutral'");
    expect(sql).toContain(
      "completed_skip.external_result ->> 'githubCheckRunId' = release_runs.github_check_run_id::text",
    );
    expect(sql).toContain("completed_skip.external_result ->> 'conclusion' = 'neutral'");
    expect(sql).toContain(`not exists (
        select 1
        from control_plane_reconciliation_items existing`);
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("'0130_completed_safe_mode_check_run_reconciliation'");
  });
});
