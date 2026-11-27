import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deterministic portable MCP Review UI artifact", () => {
  it("keeps the generated view inside a scoped Biome size budget", () => {
    const config = JSON.parse(readFileSync("biome.json", "utf8")) as {
      $schema: string;
      files: { maxSize?: number };
      overrides?: Array<{ includes: string[]; files?: { maxSize?: number } }>;
    };
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };
    const view = "apps/web/lib/generated-mcp-review-view.ts";
    const budget = config.overrides?.find((override) => override.includes.length === 1 && override.includes[0] === view)
      ?.files?.maxSize;
    expect(config.$schema).toBe(`https://biomejs.dev/schemas/${pkg.devDependencies["@biomejs/biome"]}/schema.json`);
    expect(config.files.maxSize).toBeUndefined();
    expect(budget).toBe(2 * 1024 * 1024);
    expect(readFileSync(view).byteLength).toBeLessThanOrEqual(budget ?? 0);
  });

  it("matches its original TypeScript and contains no external script/link refs", () => {
    const output = execFileSync(process.execPath, ["scripts/build-mcp-review-view.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(output).toBe("");
    const content = readFileSync("apps/web/lib/generated-mcp-review-view.ts", "utf8");
    expect(content).toContain("text/html");
    expect(content).not.toContain("<script src=");
    expect(content).not.toContain("<iframe");
    expect(content).not.toContain("boardreadyops.com/api/");
  });
});
