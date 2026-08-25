import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0044_supply_watch_entitlement_outcome.sql");

describe("supply watch entitlement outcome", () => {
  it("publishes schema v44", () => {
    expect(cloudDatabaseSchemaVersion).toBeGreaterThanOrEqual(44);
  });

  it("admits not_entitled without dropping any existing outcome", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("drop constraint if exists board_supply_watch_outcome_valid");
    expect(sql).toContain("'not_entitled'");
    // Widening a vocabulary by rewriting the whole check is an easy place to lose a value.
    for (const existing of ["'evaluated'", "'skipped_no_snapshot'", "'no_provider'", "'failed'"]) {
      expect(sql).toContain(existing);
    }
    // A never-evaluated board still has no outcome at all.
    expect(sql).toContain("last_outcome is null");
  });

  it("registers itself in the migration ledger", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("'0044_supply_watch_entitlement_outcome'");
    expect(sql).toContain("on conflict (version) do nothing");
  });
});
