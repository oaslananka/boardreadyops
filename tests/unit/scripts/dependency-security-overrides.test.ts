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

  it("keeps full OSV scans on patched dependency security floors", async () => {
    const workspace = yaml.load(await readFile("pnpm-workspace.yaml", "utf8")) as WorkspacePolicy;
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");
    const actionBundle = await readFile("dist/action/index.cjs", "utf8");

    expect(workspace.overrides?.["brace-expansion@>=5 <5.0.12"]).toBe("5.0.12");
    expect(workspace.overrides?.["fast-uri@>=3 <3.1.8"]).toBe("3.1.8");
    expect(workspace.overrides?.["ip-address@<10.7.1"]).toBe("10.7.1");
    expect(workspace.overrides?.["undici@>=8.0.0 <8.11.0"]).toBe("8.11.0");
    expect(workspace.overrides?.["qs@>=6.11.1 <6.16.0"]).toBe("6.16.0");
    expect(workspace.minimumReleaseAgeExclude).toEqual(
      expect.arrayContaining(["fast-uri@3.1.8", "ip-address@10.7.1", "qs@6.16.0"]),
    );
    expect(workspace.minimumReleaseAgeExclude).not.toContain("brace-expansion@5.0.9");
    expect(workspace.minimumReleaseAgeExclude).not.toContain("brace-expansion@5.0.12");
    expect(workspace.minimumReleaseAgeExclude).not.toContain("undici@8.9.0");
    expect(workspace.minimumReleaseAgeExclude).not.toContain("undici@8.10.2");
    expect(workspace.minimumReleaseAgeExclude).not.toContain("undici@8.11.0");
    expect(lockfile).not.toContain("brace-expansion@5.0.9");
    expect(lockfile).not.toContain("fast-uri@3.1.5");
    expect(lockfile).not.toContain("fast-uri@3.1.6");
    expect(lockfile).not.toContain("ip-address@10.3.1");
    expect(lockfile).not.toContain("js-yaml@5.3.0");
    expect(lockfile).not.toContain("undici@8.9.0");
    expect(lockfile).not.toContain("undici@8.10.2");
    // The vulnerable 8.x consumer is currently absent after the authenticated-audit dependency cleanup.
    // Keep the override above as a future floor, but do not require an otherwise-unused 8.x package in the graph.
    expect(actionBundle).not.toContain(
      "h2Options.maxConcurrentStreams != null && (!Number.isInteger(h2Options.connectionWindowSize)",
    );
    expect(actionBundle).toContain("node_modules/undici/lib/dispatcher/client.js");
    expect(actionBundle).toContain("maxConcurrentStreams must be a positive integer, greater than 0");
    expect(lockfile).not.toContain("qs@6.15.3");
    expect(lockfile).not.toContain("braces@3.0.3");
    expect(lockfile).not.toContain("http-cache-semantics@4.2.0");
  });
});
