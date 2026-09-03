import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type WorkspacePolicy = {
  minimumReleaseAgeExclude?: string[];
  overrides?: Record<string, string>;
};

describe("dependency security overrides", () => {
  it("keeps Pa11y on the audited Puppeteer 25 browser stack", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as WorkspacePolicy;
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    expect(workspace.overrides?.["pa11y>puppeteer"]).toMatch(/^25\.\d+\.\d+$/u);
    expect(lockfile).not.toContain("extract-zip@2.0.1");
  });

  it("keeps the authenticated audit off the vulnerable esbuild 0.27 line", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as WorkspacePolicy;
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    expect(workspace.overrides?.["fontless>esbuild"]).toBe("0.28.2");
    expect(lockfile).not.toContain("esbuild@0.27.7");
  });

  it("keeps full OSV scans on the patched fast-uri and qs security releases", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as WorkspacePolicy;
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    expect(workspace.overrides?.["fast-uri@>=3 <3.1.6"]).toBe("3.1.6");
    expect(workspace.overrides?.["qs@>=6.11.1 <6.16.0"]).toBe("6.16.0");
    expect(workspace.minimumReleaseAgeExclude).toEqual(expect.arrayContaining(["fast-uri@3.1.6", "qs@6.16.0"]));
    expect(lockfile).not.toContain("fast-uri@3.1.5");
    expect(lockfile).not.toContain("qs@6.15.3");
  });
});
