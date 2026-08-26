import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

describe("dependency security overrides", () => {
  it("keeps Pa11y on the audited Puppeteer 25 browser stack", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as {
      overrides?: Record<string, string>;
    };
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    // The audited stack is Puppeteer 25. Which patch of it Pa11y sits on is free to move; a
    // major move is not, because that is a different browser stack and a different audit.
    expect(workspace.overrides?.["pa11y>puppeteer"]).toMatch(/^25\.\d+\.\d+$/u);
    expect(lockfile).not.toContain("extract-zip@2.0.1");
  });
});
