import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deterministic portable MCP Review UI artifact", () => {
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
