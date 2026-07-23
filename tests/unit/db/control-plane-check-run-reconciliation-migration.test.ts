import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0021_github_check_run_reconciliation.sql");

describe("GitHub Check Run reconciliation migration", () => {
  it("publishes schema v21", () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(21);
  });

  it("detects terminal results whose Check Run publication is incomplete", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("boardreadyops_detect_github_check_run_reconciliation");
    expect(sql).toContain("release_run_results.github_check_published_at is null");
    expect(sql).toContain("release_runs.github_check_run_id is not null");
    expect(sql).toContain("release_runs.status in ('completed', 'failed', 'timed_out')");
    expect(sql).toContain("'release_run'");
    expect(sql).toContain("'reporting_stale'");
    expect(sql).toContain("on conflict do nothing");
  });

  it("returns lease-bound content-free context", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("boardreadyops_claim_github_check_run_reconciliation");
    expect(sql).toContain("boardreadyops_github_check_run_reconciliation_context");
    expect(sql).toContain("expected_conclusion text");
    expect(sql).toContain("github_check_run_id bigint");
    expect(sql).toContain("lease_owner = p_worker_id");
    expect(sql).not.toContain("payload jsonb");
    expect(sql).not.toContain("findings");
    expect(sql).not.toContain("report_links");
  });

  it("atomically records repaired or terminal publication state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("boardreadyops_apply_github_check_run_reconciliation");
    expect(sql).toContain("boardreadyops_fail_github_check_run_reconciliation");
    expect(sql).toContain("github_check_published_at = coalesce");
    expect(sql).toContain("last_publication_error = null");
    expect(sql).toContain("control_plane.github_check_run_reconciled");
    expect(sql).toContain("control_plane.github_check_run_reconciliation_failed");
    expect(sql).toContain("for update of control_plane_reconciliation_items, release_runs, release_run_results");
    expect(sql).toContain("security invoker");
  });
});
