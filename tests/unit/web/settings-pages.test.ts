import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("settings pages and operational layout", () => {
  it("provides settings navigation with all five destinations", async () => {
    const settingsLayout = await readFile("apps/web/app/settings/layout.tsx", "utf8");
    for (const route of ["billing", "security", "data", "tokens", "component-intelligence"]) {
      expect(settingsLayout).toContain(`/settings/${route}`);
    }
    expect(settingsLayout).toContain('aria-label="Settings navigation"');
  });

  it("contains setup progress index and operational styles", async () => {
    const setupPage = await readFile("apps/web/app/setup/page.tsx", "utf8");
    expect(setupPage).toContain("setup-progress-index");
    const runStyles = await readFile("apps/web/app/styles.css", "utf8");
    expect(runStyles).toContain("operational-page");
  });
});
