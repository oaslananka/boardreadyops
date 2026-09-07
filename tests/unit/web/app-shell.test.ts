import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../apps/web/components/ui.js";
import { ViewerControls } from "../../../apps/web/components/viewer-controls.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/work" }));

describe("AppShell", () => {
  it("uses the task-sequence grouping and stable global destinations", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );

    expect(markup).toContain("BoardReadyOps");
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/projects"');
    expect(markup).toContain('href="/reviews"');
    expect(markup).toContain('href="/deliveries"');
    expect(markup).toContain('href="/parts"');
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain('href="https://docs.boardreadyops.com"');
    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain("Get a board in");
    expect(markup).toContain("Work the findings");
    expect(markup).toContain("Ship it");
    expect(markup.match(/href="\/settings\/billing"/gu)).toHaveLength(1);
    expect(markup).not.toContain(">BR<");
  });

  it("does not show a fake, unwired search shortcut hint", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );
    // The shortcut is real now, but the keycap is filled in client-side from the viewer's own
    // platform -- so the server never claims a Mac chord, and the marker class of the old fake
    // hint stays banned.
    expect(markup).not.toContain("command-hint");
    expect(markup).not.toContain("⌘");
  });

  it("offers a real, discoverable command trigger in the topbar", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );
    expect(markup).toContain("data-command-trigger");
    expect(markup).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(markup).toContain('aria-label="Search"');
  });

  it("renders the breadcrumb trail it is given, in the topbar rather than each page body", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AppShell,
        { breadcrumbs: [{ href: "/dashboard", label: "Dashboard" }, { label: "Policies" }] },
        createElement("main", { id: "main-content" }, "content"),
      ),
    );
    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-current="page"');
    expect(markup.indexOf('aria-label="Breadcrumb"')).toBeLessThan(markup.indexOf("<main"));
  });

  it("puts the signed-in viewer behind an account menu instead of loose text", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AppShell,
        { viewerNav: createElement(ViewerControls, { login: "octocat" }) },
        createElement("main", { id: "main-content" }, "content"),
      ),
    );
    expect(markup).toContain('aria-label="Account menu for octocat"');
    expect(markup).toContain('aria-haspopup="menu"');
  });
});
