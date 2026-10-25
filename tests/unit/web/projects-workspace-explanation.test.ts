import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Projects workspace scope explanation", () => {
  it("tells viewers why a CAD workspace differs from Dashboard GitHub App repositories", async () => {
    const page = await readFile("apps/web/app/projects/page.tsx", "utf8");
    expect(page).toContain("Current CAD workspace");
    expect(page).toContain('actionHref="/dashboard"');
    expect(page).toContain("No CAD workspace is required");
    expect(page).toContain("separate memberships");
    expect(page).toMatch(/do not\s+automatically import/u);
    expect(page).toContain("GitHub App installations");
    expect(page).toContain('href="/dashboard"');
    expect(page).toContain("Open hardware reviews");
    expect(page).toContain('href="/reviews"');
    expect(page).toContain("View repository reviews");
    expect(page).toContain("canonicalRepositoryName(repository)");
    expect(page).toContain("encodeURIComponent(canonical)");
    expect(page).toContain("Use GitHub owner/name to link repository reviews.");
    expect(page).toContain("Selected workspace");
    expect(page).toContain("result.selected.name");
  });
});
