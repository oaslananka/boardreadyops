import { readFile } from "node:fs/promises";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/billing",
}));

const { default: SettingsLayout } = await import("../../../apps/web/app/settings/layout.js");

describe("settings pages and operational layout", () => {
  it("renders SettingsLayout with navigation links and children slot", () => {
    const html = renderToString(
      SettingsLayout({
        children: React.createElement("div", { id: "test-child" }, "Child Content"),
      }),
    );
    expect(html).toContain("Workspace Settings");
    expect(html).toContain("/settings/billing");
    expect(html).toContain("/settings/security");
    expect(html).toContain("/settings/data");
    expect(html).toContain("/settings/tokens");
    expect(html).toContain("/settings/component-intelligence");
    expect(html).toContain("Child Content");
  });

  it("provides settings navigation with all five destinations", async () => {
    const settingsNav = await readFile("apps/web/app/settings/settings-nav.tsx", "utf8");
    for (const route of ["billing", "security", "data", "tokens", "component-intelligence"]) {
      expect(settingsNav).toContain(`/settings/${route}`);
    }
    expect(settingsNav).toContain('aria-label="Settings navigation"');
  });

  it("marks exactly the current settings destination with aria-current", () => {
    const html = renderToString(
      SettingsLayout({
        children: React.createElement("div", { id: "test-child" }, "Child Content"),
      }),
    );
    const navStart = html.indexOf('data-testid="settings-nav-list"');
    const navSection = html.slice(navStart, html.indexOf("</ul>", navStart));
    const ariaCurrentMatches = navSection.match(/aria-current="page"/g) ?? [];
    expect(ariaCurrentMatches).toHaveLength(1);
    expect(navSection).toContain('aria-current="page" href="/settings/billing"');
    expect(navSection).not.toContain('aria-current="page" href="/settings/security"');
  });

  it("contains setup progress index", async () => {
    const setupPage = await readFile("apps/web/app/setup/page.tsx", "utf8");
    expect(setupPage).toContain("setup-progress-index");
  });
});
