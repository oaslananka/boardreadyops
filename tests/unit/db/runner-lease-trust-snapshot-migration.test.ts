import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL("../../../packages/db/migrations/0034_runner_lease_trust_snapshot.sql", import.meta.url);

describe("runner lease trust snapshot migration", () => {
  it("returns the immutable release-run trust snapshot with each claimed lease", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("drop function if exists boardreadyops_claim_runner_job(");
    expect(sql).toContain("trust_mode text");
    expect(sql).toContain("safe_mode_reasons text[]");
    expect(sql).toContain("release_runs.trust_mode");
    expect(sql).toContain("release_runs.safe_mode_reasons");
    expect(sql).toContain("trust_mode := selected_trust_mode");
    expect(sql).toContain("safe_mode_reasons := selected_safe_mode_reasons");
  });

  it("fails closed before lease creation for fork and draft trust snapshots", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("not ('draft-pull-request' = any(release_runs.safe_mode_reasons))");
    expect(sql).toContain("not ('fork-pull-request' = any(release_runs.safe_mode_reasons))");
    expect(sql.indexOf("not ('draft-pull-request'")).toBeLessThan(
      sql.indexOf("insert into public.release_run_attempts"),
    );
    expect(sql.indexOf("not ('fork-pull-request'")).toBeLessThan(
      sql.indexOf("insert into public.release_run_attempts"),
    );
  });

  it("audits the trust snapshot selected for the runner lease", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("'trustMode', selected_trust_mode");
    expect(sql).toContain("'safeModeReasons', to_jsonb(selected_safe_mode_reasons)");
  });
});
