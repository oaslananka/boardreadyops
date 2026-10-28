import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function discover(names: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "bro-migration-sequence-"));
  tempDirs.push(dir);
  for (const name of names) writeFileSync(path.join(dir, name), "select 1;\n");
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { listMigrationFiles } from ${JSON.stringify(pathToFileURL(path.resolve("packages/db/scripts/apply-migrations.mjs")).href)};
try { console.log(JSON.stringify(await listMigrationFiles(process.argv[1]))); } catch (error) { console.error(String(error)); process.exitCode = 1; }`,
      dir,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
}

describe("cloud migration sequence guard", () => {
  it("rejects duplicate numeric migration prefixes before connecting to the database", () => {
    const result = discover(["0094_pcb.sql", "0094_unlink.sql"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Duplicate cloud migration sequence 0094");
    expect(result.stderr).toContain("0094_pcb.sql");
    expect(result.stderr).toContain("0094_unlink.sql");
  });

  it("accepts distinct migrations in deterministic order", () => {
    const result = discover(["0097_unlink.sql", "0094_pcb.sql", "0096_stripe.sql"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["0094_pcb.sql", "0096_stripe.sql", "0097_unlink.sql"]);
  });
});
