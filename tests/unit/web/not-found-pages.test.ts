import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/some/missing/path" }));

const { default: NotFound } = await import("../../../apps/web/app/not-found.js");
const { default: RunNotFound } = await import("../../../apps/web/app/runs/[runId]/not-found.js");

describe("not-found boundary pages have a real, unique H1", () => {
  it("root not-found page has exactly one H1", () => {
    const markup = renderToStaticMarkup(createElement(NotFound));
    expect(markup.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(markup).toContain("Page not found");
  });

  it("run not-found page has exactly one H1", () => {
    const markup = renderToStaticMarkup(createElement(RunNotFound));
    expect(markup.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(markup).toContain("Run unavailable");
  });
});
