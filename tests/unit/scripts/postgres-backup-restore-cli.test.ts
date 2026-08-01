import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../../../scripts/postgres-backup-restore.mjs", import.meta.url));

describe("PostgreSQL backup restore CLI", () => {
  it("loads its runtime dependencies before validating operator input", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("isolated restore confirmation is required");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
