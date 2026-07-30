import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL("../../../packages/db/migrations/0032_repository_setup_flow.sql", import.meta.url);

describe("repository setup migration", () => {
  it("persists append-only setup revisions and run provenance", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists repository_setup_revisions");
    expect(sql).toContain("repository_setup_revisions is append-only");
    expect(sql).toContain("add column if not exists repository_setup_revision_id");
    expect(sql).toContain("v_setup_revision_id");
    expect(sql).toContain("github_app.repository.setup_changed");
    expect(sql).toContain("github_app.repository.setup_validated");
  });

  it("creates scoped, expiring and idempotent setup probes", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists repository_setup_probes");
    expect(sql).toContain("unique (installation_id, request_id)");
    expect(sql).toContain("boardreadyops_create_repository_setup_probe");
    expect(sql).toContain("boardreadyops_complete_repository_setup_probe");
    expect(sql).toContain("p_workflow_contract_version = 1");
    expect(sql).toContain("if v_probe.status = 'expired'");
  });
});
