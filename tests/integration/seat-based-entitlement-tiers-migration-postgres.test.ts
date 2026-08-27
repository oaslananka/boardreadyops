import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

/**
 * Proves migration 0047's data transformation, not just its presence.
 *
 * The migration's own UPDATE statement is unscoped by design -- it must touch every
 * installation carrying the old tier meaning, wherever it is. That is also why it cannot be
 * replayed verbatim here: this test file shares one live Postgres database with every other
 * integration test in the suite (as CI does), and some of those seed their own fixtures with
 * plan_tier 'team' for unrelated entitlement checks. Running the bare statement mid-suite has
 * previously flipped another file's still-active fixture out from under it. The first test
 * still asserts the migration file's exact, unscoped SQL text is what ships; execution against
 * the live database is scoped to this file's own fixture ids to keep that safe to run alongside
 * everything else.
 */

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 1 }) : undefined;
const migrationPath = join(process.cwd(), "packages/db/migrations/0047_seat_based_entitlement_tiers.sql");

const freeInstallation = "9e470000-0000-4000-8000-000000000001";
const proInstallation = "9e470000-0000-4000-8000-000000000002";
const teamInstallation = "9e470000-0000-4000-8000-000000000003";
const allInstallations = [freeInstallation, proInstallation, teamInstallation];

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

beforeAll(async () => {
  if (!executor) return;
  for (const id of allInstallations) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await database().query(
    `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
     values ($1, 47401, 'seat-migration-free', 'Organization', 'free'),
            ($2, 47402, 'seat-migration-pro', 'Organization', 'pro'),
            ($3, 47403, 'seat-migration-team', 'Organization', 'team')`,
    [freeInstallation, proInstallation, teamInstallation],
  );
});

afterAll(async () => {
  if (!executor) return;
  for (const id of allInstallations) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await executor.close();
});

describeDatabase("seat-based entitlement tier migration", () => {
  it("vacates 'team' before it means anything new: pre-migration 'pro' and 'team' both land on 'business'", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const statement = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim();
    expect(statement).toBe("update installations set plan_tier = 'business' where plan_tier in ('pro', 'team');");

    // Scoped replay: same predicate as the migration, plus this file's own fixture ids, so it
    // cannot touch another concurrently-running test's 'team' or 'pro' fixture in this shared
    // database.
    await database().query(
      "update installations set plan_tier = 'business' where plan_tier in ('pro', 'team') and id = any($1::text[])",
      [allInstallations],
    );

    const result = rows(
      await database().query("select id, plan_tier from installations where id = any($1::text[])", [allInstallations]),
    );
    const tierById = new Map(result.map((row) => [row.id, row.plan_tier]));

    expect(tierById.get(freeInstallation)).toBe("free");
    expect(tierById.get(proInstallation)).toBe("business");
    expect(tierById.get(teamInstallation)).toBe("business");
  });

  it("is idempotent: replaying it again changes nothing further", async () => {
    const beforeReplay = rows(
      await database().query("select id, plan_tier from installations where id = any($1::text[])", [allInstallations]),
    );

    await database().query(
      "update installations set plan_tier = 'business' where plan_tier in ('pro', 'team') and id = any($1::text[])",
      [allInstallations],
    );

    const afterReplay = rows(
      await database().query("select id, plan_tier from installations where id = any($1::text[])", [allInstallations]),
    );
    expect(afterReplay).toEqual(beforeReplay);
  });
});
