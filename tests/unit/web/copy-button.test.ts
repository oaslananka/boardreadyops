import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyButton } from "../../../apps/web/components/copy-button.js";

describe("CopyButton component", () => {
  it("renders with initial label and accessible live region", () => {
    const markup = renderToStaticMarkup(createElement(CopyButton, { label: "Copy SHA-256", value: "abc123" }));

    expect(markup).toContain("Copy SHA-256");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("copy-control");
    expect(markup).toContain("button-compact");
  });
});
