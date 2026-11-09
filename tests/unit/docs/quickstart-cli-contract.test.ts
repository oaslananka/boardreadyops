import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local-first quickstart command", () => {
  it("uses a supported CLI option instead of a nonexistent safe-mode flag", () => {
    const guide = readFileSync("docs/quickstart.md", "utf8");
    const section = guide.split("### Path D: Private / Local-Only First Check")[1]?.split("\n---")[0];
    expect(section).toBeDefined();
    expect(section).toContain("boardreadyops check . --fail-on never");
    expect(section).not.toContain("boardreadyops check . --safe-mode");
    expect(section).toContain("not** a GitHub Actions OIDC-signed hosted result");
  });
});
