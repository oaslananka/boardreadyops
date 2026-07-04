import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("BoardReadyOps Cloud migrations", () => {
  it("discovers SQL migrations in deterministic order", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort();

    expect(files).toEqual(["0001_cloud_schema.sql"]);
  });

  it("keeps the initial schema idempotent", async () => {
    const sql = await readFile(join(migrationsDir, "0001_cloud_schema.sql"), "utf8");

    expect(sql).toContain("create table if not exists installations");
    expect(sql).toContain("create table if not exists repositories");
    expect(sql).toContain("create table if not exists release_runs");
    expect(sql).toContain("cloud_schema_migrations");
    expect(sql).toContain("idempotency_key text unique");
    expect(sql).toContain("github_check_run_id bigint");
  });
});
