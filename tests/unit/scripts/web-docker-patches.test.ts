import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("web Docker dependency layer", () => {
  it("copies every pnpm patch before installing dependencies", async () => {
    const workspace = load(await readFile("pnpm-workspace.yaml", "utf8")) as {
      patchedDependencies?: Record<string, string>;
    };
    const dockerfile = await readFile("apps/web/Dockerfile", "utf8");
    const installAt = dockerfile.indexOf("RUN corepack pnpm run deps:install-web");
    expect(installAt).toBeGreaterThan(0);
    for (const patch of Object.values(workspace.patchedDependencies ?? {})) {
      expect(patch.startsWith("patches/")).toBe(true);
      expect(existsSync(patch)).toBe(true);
    }
    if (Object.keys(workspace.patchedDependencies ?? {}).length > 0) {
      const copyAt = dockerfile.indexOf("COPY patches patches");
      expect(copyAt).toBeGreaterThan(0);
      expect(copyAt).toBeLessThan(installAt);
      expect((await readFile(".dockerignore", "utf8")).split("\n")).not.toContain("patches");
    }
  });
});
