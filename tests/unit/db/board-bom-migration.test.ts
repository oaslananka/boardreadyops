import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL("../../../packages/db/migrations/0040_board_bom_snapshots.sql", import.meta.url);

describe("board BOM snapshot migration", () => {
  it("creates boards scoped uniquely to a repository project path", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists boards");
    expect(sql).toContain("references repositories(id) on delete cascade");
    expect(sql).toContain("boards_repository_project_idx");
  });

  it("creates append-only BOM snapshots bound to one run", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists board_bom_snapshots");
    expect(sql).toContain("board_bom_snapshots is append-only");
    expect(sql).toContain("board_bom_snapshots_board_run_idx");
    expect(sql).toContain("references release_runs(id) on delete cascade");
  });

  it("stores components under a snapshot with a bounded reference", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table if not exists board_bom_components");
    expect(sql).toContain("references board_bom_snapshots(id) on delete cascade");
    expect(sql).toContain("board_bom_components_reference_valid");
    expect(sql).toContain("board_bom_components_identity_key_valid");
  });

  it("guards every constraint so the self-hosted deploy path can re-run it", async () => {
    const sql = await readFile(migration, "utf8");
    const constraintAdditions = sql.match(/add constraint/gu) ?? [];
    const constraintGuards = sql.match(/where conname = '/gu) ?? [];
    expect(constraintAdditions.length).toBeGreaterThan(0);
    expect(constraintGuards).toHaveLength(constraintAdditions.length);
  });
});
