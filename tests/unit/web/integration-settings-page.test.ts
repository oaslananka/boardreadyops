import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Integrations & Health settings page", () => {
  it("is discoverable from Settings and renders the real health sources", async () => {
    const [page, nav, routes] = await Promise.all([
      readFile("apps/web/app/settings/integrations/page.tsx", "utf8"),
      readFile("apps/web/app/settings/settings-nav.tsx", "utf8"),
      readFile("qa/audit/routes.ts", "utf8"),
    ]);
    expect(nav).toContain("/settings/integrations");
    expect(nav).toContain("Integrations & Health");
    expect(routes).toContain('id: "settings-integrations"');
    expect(routes).toContain('path: "/settings/integrations"');
    for (const text of [
      "Deployment readiness",
      "GitHub App",
      "Repository setup",
      "Component intelligence",
      "Runner fleet",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("loadIntegrationHealth");
  });
});
