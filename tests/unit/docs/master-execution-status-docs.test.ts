import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("master-execution-status.md docs contract", () => {
  const repoRoot = resolve(__dirname, "../../../");
  const masterStatusPath = resolve(repoRoot, "docs/development/master-execution-status.md");
  const mkdocsPath = resolve(repoRoot, "mkdocs.yml");

  it("exists and defines all workstreams W00 through W36", () => {
    const content = readFileSync(masterStatusPath, "utf8");

    // All workstreams must be present in the matrix and detailed sections
    for (let i = 0; i <= 36; i++) {
      const code = `W${i.toString().padStart(2, "0")}`;
      expect(content, `Expected workstream ${code} in master execution status`).toContain(code);
    }
  });

  it("defines all phases 0 through 8", () => {
    const content = readFileSync(masterStatusPath, "utf8");

    for (let phase = 0; phase <= 8; phase++) {
      expect(content, `Expected Phase ${phase} in master execution status`).toMatch(new RegExp(`Phase ${phase}:`, "i"));
    }
  });

  it("is registered in mkdocs.yml navigation", () => {
    const mkdocs = readFileSync(mkdocsPath, "utf8");
    expect(mkdocs).toContain("development/master-execution-status.md");
  });

  it("binds the generated ledger to canonical inventory and issue 191", () => {
    const status = JSON.parse(readFileSync(resolve(repoRoot, "docs/development/master-execution-status.json"), "utf8"));
    expect(status.roadmap.source).toBe("https://github.com/oaslananka/boardreadyops/issues/191");
    expect(status.workstreams.map((entry: { id: string }) => entry.id)).toEqual(
      Array.from({ length: 37 }, (_, index) => `W${String(index).padStart(2, "0")}`),
    );
    expect(readFileSync(masterStatusPath, "utf8")).toContain("<!-- master-execution-status:start -->");
  });

  it("runs ledger drift validation in normal verification", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts["execution-status:render"]).toBe("node scripts/master-execution-status.mjs render");
    expect(packageJson.scripts["verify:execution-status"]).toBe("node scripts/master-execution-status.mjs check");
    expect(packageJson.scripts.verify).toContain("corepack pnpm run verify:execution-status");
  });
});
