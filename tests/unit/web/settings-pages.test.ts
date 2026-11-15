import { readFile } from "node:fs/promises";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/billing",
  useRouter: () => ({ push: vi.fn() }),
}));

const { default: SettingsLayout } = await import("../../../apps/web/app/settings/layout.js");
const { default: SettingsLoading } = await import("../../../apps/web/app/settings/loading.js");

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

  it("does not nest a second application shell, main landmark or skip target during Settings loading", () => {
    const html = renderToString(SettingsLayout({ children: React.createElement(SettingsLoading) }));
    expect(html.match(/<main\b/g) ?? []).toHaveLength(1);
    expect(html.match(/id="main-content"/g) ?? []).toHaveLength(1);
    expect(html.match(/aria-label="Product navigation"/g) ?? []).toHaveLength(1);
    expect(html.match(/aria-label="Settings navigation"/g) ?? []).toHaveLength(1);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading settings section");
  });

  it("offers an active-section mobile selector while preserving the desktop Settings menu", () => {
    const html = renderToString(SettingsLayout({ children: React.createElement("p", null, "Settings content") }));
    expect(html).toContain('id="settings-destination"');
    expect(html).toContain("Settings section");
    expect(html).toContain('value="/settings/billing" selected=""');
    expect(html).toContain("lg:hidden");
    expect(html).toContain("lg:flex");
    expect(html).toContain("Settings content");
  });

  it("caps the API Token repository selector at the mobile viewport instead of expanding page width", async () => {
    const source = await readFile("apps/web/app/settings/tokens/page.tsx", "utf8");
    expect(source).toContain("flex-col");
    expect(source).toContain("sm:flex-row");
    expect(source).toContain("min-w-0");
    expect(source).toContain("max-w-full");
    expect(source).not.toContain('className="w-auto"');
  });

  it("contains setup progress index", async () => {
    const setupInteractive = await readFile("apps/web/components/repository-setup-interactive.tsx", "utf8");
    expect(setupInteractive).toContain("setup-progress-index");
  });
});
