import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL("../../../packages/db/migrations/0033_release_run_trust_mode.sql", import.meta.url);

describe("release-run trust-mode migration", () => {
  it("persists a constrained immutable trust snapshot on every release run", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("add column if not exists trust_mode text not null default 'standard'");
    expect(sql).toContain("add column if not exists safe_mode_reasons text[] not null default '{}'::text[]");
    expect(sql).toContain("release_runs_trust_mode_valid");
    expect(sql).toContain("trust_mode in ('standard', 'safe')");
    expect(sql).toContain("release_runs_safe_mode_reasons_valid");
    expect(sql).toContain("'draft-pull-request'");
    expect(sql).toContain("'fork-pull-request'");
    expect(sql).toContain("'private-repository'");
    expect(sql).toContain("release_runs_safe_mode_consistent");
  });

  it("derives the trust snapshot from the normalized outbox action and audits new runs", async () => {
    const sql = await readFile(migration, "utf8");

    expect(sql).toContain("create or replace function boardreadyops_enqueue_release_run_with_outbox(");
    expect(sql).toContain("p_outbox_payload #> '{action,safeMode,enabled}' = 'true'::jsonb");
    expect(sql).toContain("p_outbox_payload #> '{action,safeMode,reasons}'");
    expect(sql).toContain("trust_mode,");
    expect(sql).toContain("safe_mode_reasons,");
    expect(sql).toContain("release_run.trust_mode_selected");
    expect(sql).toContain("jsonb_build_object(");
    expect(sql).toContain("'trustMode', v_trust_mode");
    expect(sql).toContain("'safeModeReasons', to_jsonb(v_safe_mode_reasons)");
    expect(sql).toContain("if v_run_inserted then");
  });
});
