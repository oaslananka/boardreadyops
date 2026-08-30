import { readFile } from "node:fs/promises";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DataSettingsPage from "../../../apps/web/app/settings/data/page.js";
import SettingsLayout from "../../../apps/web/app/settings/layout.js";

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
    const settingsLayout = await readFile("apps/web/app/settings/layout.tsx", "utf8");
    for (const route of ["billing", "security", "data", "tokens", "component-intelligence"]) {
      expect(settingsLayout).toContain(`/settings/${route}`);
    }
    expect(settingsLayout).toContain('aria-label="Settings navigation"');
  });

  it("shows retention by data class without implying destructive expiry", () => {
    const html = renderToString(DataSettingsPage()).replaceAll("<!-- -->", "").replaceAll("&amp;", "&");
    expect(html).toContain("Managed-artifact expiry preview is suppressed by active tenant legal holds");
    expect(html).not.toContain("Legal holds block automatic expiry candidates");
    expect(html).toContain("Webhook terminal metadata");
    expect(html).toContain("30 days");
    expect(html).toContain("Completed delivery & reconciliation history");
    expect(html).toContain("90 days");
    expect(html).toContain("Managed artifacts");
    expect(html).toContain("Free 30 days; Team 365 days");
    expect(html).toContain("Logical runs & findings");
    expect(html).toContain("No automatic age-based expiry");
    expect(html).toContain("Audit events");
    expect(html).toContain("Source workspaces");
    expect(html).toContain("Not retained by the control plane");
    expect(html).toContain("Physical age-based artifact deletion remains disabled");
  });

  it("contains setup progress index and operational styles", async () => {
    const setupPage = await readFile("apps/web/app/setup/page.tsx", "utf8");
    expect(setupPage).toContain("setup-progress-index");
    const runStyles = await readFile("apps/web/app/styles.css", "utf8");
    expect(runStyles).toContain("operational-page");
  });
});
