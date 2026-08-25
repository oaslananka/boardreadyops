import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0042_check_run_reconciliation_without_result.sql");

const contextAnchor = "create function boardreadyops_github_check_run_reconciliation_context";
const applyAnchor = "create or replace function boardreadyops_apply_github_check_run_reconciliation";

async function migration(): Promise<string> {
  return await readFile(migrationPath, "utf8");
}

function section(sql: string, from: string, to?: string): string {
  const start = sql.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  if (!to) return sql.slice(start);
  const end = sql.indexOf(to);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("Check Run reconciliation without a terminal result", () => {
  it("publishes schema v42", () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(42);
  });

  it("detects terminal runs that never reported a result", async () => {
    const detector = section(
      await migration(),
      "create or replace function boardreadyops_detect_github_check_run_reconciliation",
      contextAnchor,
    );

    // An inner join here is the bug this migration exists to fix: it hid every run whose
    // execution never reported, leaving its Check Run pending on the pull request forever.
    expect(detector).toContain("from release_runs");
    expect(detector).toContain("left join release_run_results on release_run_results.run_id = release_runs.id");
    expect(detector).not.toContain("from release_run_results");
    expect(detector).toContain(
      "release_run_results.run_id is null or release_run_results.github_check_published_at is null",
    );
    // Without a result row the run's own completion is the only observation point available.
    expect(detector).toContain("release_runs.completed_at");
  });

  it("leaves the rest of the detector's queue semantics alone", async () => {
    const detector = section(
      await migration(),
      "create or replace function boardreadyops_detect_github_check_run_reconciliation",
      contextAnchor,
    );

    // Rewriting this function is how the fix is delivered, which makes it easy to change more
    // than intended. These are the parts a reconciliation item's lifecycle depends on.
    expect(detector).toContain("'available'");
    expect(detector).not.toContain("'pending'");
    expect(detector).toContain("on conflict do nothing");
    expect(detector).toContain("existing.reason_code = 'reporting_stale'");
  });

  it("derives a conclusion from the run when no result exists and reports which case it is", async () => {
    const context = section(await migration(), contextAnchor, applyAnchor);

    expect(context).toContain("result_reported boolean");
    expect(context).toContain("release_run_results.run_id is not null");
    expect(context).toContain("left join release_run_results on release_run_results.run_id = release_runs.id");
    // A run that never reported cannot be concluded successful.
    expect(context).toContain("case when release_runs.status = 'timed_out' then 'timed_out' else 'failure' end");
    expect(context).not.toContain("'success'");
  });

  it("drops the context function first because its row type changed", async () => {
    const sql = await migration();

    // "create or replace" cannot add an output column, so a plain replace would fail on deploy.
    expect(sql).toContain("drop function if exists boardreadyops_github_check_run_reconciliation_context(text, text);");
    expect(sql).not.toContain("create or replace function boardreadyops_github_check_run_reconciliation_context");
  });

  it("applies the repair without a result row and records the distinction", async () => {
    const apply = section(await migration(), applyAnchor);

    // Postgres refuses FOR UPDATE on the nullable side of an outer join, so the result is
    // locked separately rather than joined into the lease lock.
    expect(apply).toContain("for update of cpri, rr;");
    expect(apply).toContain("select * into v_result from release_run_results where run_id = v_run.id for update;");
    expect(apply).toContain("github_check_run_reconciled_without_result");
    expect(apply).toContain("'resultReported', v_has_result");
    // The optimistic-concurrency guards must survive the rewrite.
    expect(apply).toContain("errcode = '40001'");
  });

  it("registers itself in the migration ledger", async () => {
    const sql = await migration();
    expect(sql).toContain("insert into cloud_schema_migrations (version)");
    expect(sql).toContain("'0042_check_run_reconciliation_without_result'");
    expect(sql).toContain("on conflict (version) do nothing");
  });
});
