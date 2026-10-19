import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Projects workspace scope explanation", () => {
  it("tells viewers why a CAD workspace differs from Dashboard GitHub App repositories", async () => {
    const page = await readFile("apps/web/app/projects/page.tsx", "utf8");
    expect(page).toContain("Current CAD workspace");
    expect(page).toContain('<ReviewEmptyVisualPreview mode="onboarding" />');
    expect(page).toContain("GitHub App installations");
    expect(page).toContain('href="/dashboard"');
    expect(page).toContain("Selected workspace");
    expect(page).toContain("result.selected.name");
  });
});
