import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../../../apps/web/components/ui.js";

describe("AppShell", () => {
  it("uses the BoardReadyOps brand lockup and stable global destinations", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );

    expect(markup).toContain("BoardReadyOps");
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain('href="https://docs.boardreadyops.com"');
    expect(markup).toContain('href="#main-content"');
    expect(markup).not.toContain(">BR<");
  });
});
