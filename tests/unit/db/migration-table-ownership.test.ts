import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `create table if not exists` is the house style, and it makes migrations rerunnable — but it
 * also swallows a name collision in silence. When two migrations create the same table with
 * different columns, the second one is a no-op, the runner reports success, and the schema is
 * quietly not what the later migration says it is.
 *
 * That happened: `0052_billing.sql` created `workspace_memberships` for seat billing, keyed by an
 * opaque `tenant_id`; `0063_workspace_project_model.sql` then declared the same name with a
 * `(workspace_id, user_id)` primary key. 0063's definition never ran. Nothing recorded who owned
 * a workspace, so the v2 routes had nothing to authorize against and did not try.
 *
 * The migration suite could not catch it, because it asserts that a string appears in a file —
 * which stayed true the whole time. This checks the property that actually matters: one table,
 * one migration that creates it.
 */

const migrationsDir = join(process.cwd(), "packages/db/migrations");
const createTablePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/giu;

describe("migration table ownership", () => {
  it("never lets two migrations create the same table", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    const owners = new Map<string, string[]>();

    for (const file of files) {
      const sql = (await readFile(join(migrationsDir, file), "utf8")).toLowerCase();
      for (const match of sql.matchAll(createTablePattern)) {
        const table = match[1];
        if (!table) continue;
        owners.set(table, [...(owners.get(table) ?? []), file]);
      }
    }

    expect(files.length).toBeGreaterThan(60);

    const collisions = [...owners.entries()]
      .filter(([, definedIn]) => definedIn.length > 1)
      .map(([table, definedIn]) => `${table}: ${definedIn.join(", ")}`);

    expect(
      collisions,
      `Each of these tables is created by more than one migration. The later definition is a silent no-op, so the live schema is whichever one ran first:\n${collisions.join("\n")}`,
    ).toEqual([]);
  });
});
