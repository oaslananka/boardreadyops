import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Neon Function deployment bundle", () => {
  it("builds a standalone index.mjs and refuses unsolicited calls while disabled", () => {
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "production",
    };
    const build = spawnSync(process.execPath, ["scripts/build-control-plane-worker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(build.status, build.stderr).toBe(0);

    const path = "apps/web/.next/neon/index.mjs";
    expect(existsSync(path)).toBe(true);
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import("./apps/web/.next/neon/index.mjs").then(async ({ default: handler }) => {' +
          ' const result = await handler.fetch(new Request("https://example.invalid/", { method: "POST" }));' +
          " const body = await result.json();" +
          ' if (result.status !== 503 || result.headers.get("cache-control") !== "no-store"' +
          ' || body.error !== "temporarily_unavailable") throw new Error("fail-closed violated");' +
          ' console.log("NEON_DISABLED=PASS");' +
          " }).catch((error) => { console.error(error); process.exitCode = 1; });",
      ],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("NEON_DISABLED=PASS");
    expect(run.stderr).not.toContain("Dynamic require");
  });
});
