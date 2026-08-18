import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

function runtimeEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    BOARDREADYOPS_RUNNER_MODE: "disabled",
  };
}

describe("control-plane production runtime bundles", () => {
  it("loads PostgreSQL at runtime without an ESM dynamic-require failure", () => {
    const build = spawnSync(process.execPath, ["scripts/build-control-plane-worker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: runtimeEnvironment(),
    });
    expect(build.status, build.stderr).toBe(0);

    const metadata = JSON.parse(fs.readFileSync("apps/web/.next/worker-meta.json", "utf8"));
    const imports = metadata.outputs["apps/web/.next/worker.mjs"]?.imports ?? [];
    expect(imports).toContainEqual(expect.objectContaining({ path: "pg", external: true }));

    const worker = spawnSync(process.execPath, ["apps/web/.next/worker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: runtimeEnvironment(),
    });
    expect(worker.status).toBe(1);
    expect(worker.stderr).toContain("DATABASE_URL is required for the control-plane worker");
    expect(worker.stderr).not.toContain("Dynamic require");

    const migration = spawnSync(process.execPath, ["apps/web/.next/migrate.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: runtimeEnvironment(),
    });
    expect(migration.status).toBe(1);
    expect(migration.stderr).toContain("DATABASE_URL is required to apply BoardReadyOps Cloud migrations");
    expect(migration.stderr).not.toContain("Dynamic require");
  });
});
