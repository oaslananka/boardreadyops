import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/web/app/dashboard/page.tsx", "utf8");
const css = readFileSync("apps/web/app/styles.css", "utf8");

describe("dashboard operational hierarchy", () => {
  it("derives a compact summary from the loaded repository groups", () => {
    expect(source).toContain("summarizeViewerRepositories");
    expect(source).toContain('className="operational-summary"');
    expect(source).toContain("Repositories with findings");
    expect(source).toContain("Supply alerts");
    expect(source).toContain("No run yet");
    expect(source).toContain("Boards watched");
    expect(source).not.toContain("this week");
    expect(source).not.toContain("trend");
  });

  it("renders repository account groups as sections rather than repeated cards", () => {
    expect(source).toContain('tone="section"');
    expect(source.indexOf('className="operational-summary"')).toBeLessThan(source.indexOf("repository-table-wrap"));
    expect(css).toContain(".operational-summary");
  });
});
