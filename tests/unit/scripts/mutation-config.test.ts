import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mutation configuration", () => {
  it("keeps source-text guards out of Stryker dry runs", async () => {
    const config = await readFile("stryker.config.mjs", "utf8");

    expect(config).toContain('ignorePatterns: ["tests/unit/kicad/source-guards.test.ts"]');
  });
});
