import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../apps/web/components/ui.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/work" }));

describe("AppShell", () => {
  it("uses the grouped product shell and stable global destinations", () => {
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
    expect(markup).toContain('class="product-shell"');
    expect(markup).toContain("product-rail");
    expect(markup).toContain("product-context-bar");
    expect(markup.match(/href="\/settings\/billing"/gu)).toHaveLength(1);
    expect(markup).not.toContain(">BR<");
  });

  it("does not show a fake, unwired search shortcut hint", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );
    expect(markup).not.toContain("command-hint");
    expect(markup).not.toContain("⌘");
  });
});
