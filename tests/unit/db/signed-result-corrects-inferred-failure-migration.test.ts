import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0043_signed_result_corrects_inferred_failure.sql");
const routePath = join(process.cwd(), "apps/web/app/api/v1/runs/result/route.ts");

describe("a signed result corrects an inferred failure", () => {
  it("publishes schema v43", () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(43);
  });

  it("gates the relaxation on the absence of a recorded result digest", async () => {
    const sql = await readFile(migrationPath, "utf8");

    // The whole safety of this change rests on this one condition: only a run that never
    // recorded a result digest was failed by inference and may be corrected.
    expect(sql).toContain("v_corrects_inferred_failure :=");
    expect(sql).toContain("v_run.terminal_result_digest is null");
    expect(sql).toContain("and v_run.status in ('completed', 'failed', 'timed_out')");
  });

  it("relaxes both the run and attempt transition guards", async () => {
    const sql = await readFile(migrationPath, "utf8");

    // Reconciliation terminalises the attempt as well as the run, so correcting the verdict
    // needs both guards to yield or the transition still fails.
    expect(sql).toContain("and not v_corrects_inferred_failure");
    expect(sql).toContain("or v_corrects_inferred_failure");
  });

  it("leaves every other guard in the transition intact", async () => {
    const sql = await readFile(migrationPath, "utf8");

    // This function is the guarded write path for signed results. Regenerating it risks
    // dropping a check silently, so the ones that protect integrity are pinned here.
    expect(sql).toContain("p_result_digest !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("v_run.execution_attempt_id is distinct from p_expected_execution_attempt_id");
    expect(sql).toContain("v_attempt.version is distinct from p_expected_attempt_version");
    expect(sql).toContain("'stale'::text");
    expect(sql).toContain("'invalid_transition'::text");
    // A non-terminal result must still never carry a terminal digest.
    expect(sql).toContain("(not v_terminal and p_terminal_result_digest is not null)");
  });

  it("registers itself in the migration ledger", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("'0043_signed_result_corrects_inferred_failure'");
    expect(sql).toContain("on conflict (version) do nothing");
  });

  it("classifies a resultless terminal run as accepted rather than conflicting", async () => {
    const route = await readFile(routePath, "utf8");

    expect(route).toContain("when existing.terminal_result_digest is null");
    // A run that did report a result keeps its verdict: the conflict branch must survive.
    expect(route).toContain("else 'conflicting_terminal_result'");
    // Supersession and stale attempts are classified before the terminal branch and must
    // still win, or a late result could overwrite a newer commit's run.
    const classified = route.slice(route.indexOf("classified as ("), route.indexOf("transitioned as materialized"));
    expect(classified.indexOf("'superseded'")).toBeLessThan(classified.indexOf("terminal_result_digest is null"));
    expect(classified.indexOf("'stale_attempt'")).toBeLessThan(classified.indexOf("terminal_result_digest is null"));
    expect(classified.indexOf("'artifact_integrity_mismatch'")).toBeLessThan(
      classified.indexOf("terminal_result_digest is null"),
    );
  });
});
