import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("documentation discovery build integration", () => {
  it("decorates strict MkDocs builds with public discovery artifacts", () => {
    const source = readFileSync("scripts/docs-build.mjs", "utf8");
    expect(source).toContain('from "./docs-discovery.mjs"');
    expect(source).toContain("generateDocsDiscovery");
    expect(source).toContain('"--site-dir"');
  });

  it("uses the discovery-aware docs builder in CI and Pages deployment", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const docs = readFileSync(".github/workflows/docs.yml", "utf8");

    expect(ci).toContain("run: node scripts/docs-build.mjs --site-dir site");
    expect(docs).toContain("run: node scripts/docs-build.mjs --site-dir site");
    expect(docs).toContain("- scripts/docs-discovery.mjs");
  });
});
