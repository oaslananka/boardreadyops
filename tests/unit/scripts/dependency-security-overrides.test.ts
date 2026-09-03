import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

describe("dependency security overrides", () => {
  it("keeps Pa11y on the audited Puppeteer 25 browser stack", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as {
      overrides?: Record<string, string>;
    };
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    expect(workspace.overrides?.["pa11y>puppeteer"]).toMatch(/^25\.\d+\.\d+$/u);
    expect(lockfile).not.toContain("extract-zip@2.0.1");
  });

  it("keeps the authenticated audit off the vulnerable esbuild 0.27 line", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as {
      overrides?: Record<string, string>;
    };
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    expect(workspace.overrides?.["fontless>esbuild"]).toBe("0.28.2");
    expect(lockfile).not.toContain("esbuild@0.27.7");
  });
});
