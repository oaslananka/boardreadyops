import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewEmptyVisualPreview } from "../../../apps/web/components/review/review-empty-visual-preview.js";

describe("visual-first hardware onboarding", () => {
  it("shows source-derived PCB and schematic examples without claiming they are a customer release", () => {
    const html = renderToStaticMarkup(createElement(ReviewEmptyVisualPreview, { mode: "onboarding" }));
    expect(html).toContain("Your next hardware review starts with the board");
    expect(html).toContain("Example only");
    expect(html).toContain("/demo/zaptrace-sample-pcb.png");
    expect(html).toContain("/demo/zaptrace-sample-schematic.png");
    expect(html).toContain("not your repository, not recorded findings or manufacturing approval");
    expect(html).toContain('aria-label="From design to production review"');
    expect(html).toContain('href="/setup"');
    expect(html).toContain("Connect a repository");
    expect(html).not.toContain('href="/reviews#publish-review"');
  });

  it("uses explicit sign-in routing for signed-out visitors while keeping example labeling", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewEmptyVisualPreview, {
        mode: "onboarding",
        actionHref: "/api/auth/github/login",
        actionLabel: "Sign in to connect a board",
      }),
    );
    expect(html).toContain('href="/api/auth/github/login"');
    expect(html).toContain("Sign in to connect a board");
    expect(html).not.toContain('href="/setup"');
    expect(html).toContain("Example only");
  });

  it("preserves the existing review publishing path outside onboarding", () => {
    const html = renderToStaticMarkup(createElement(ReviewEmptyVisualPreview));
    expect(html).toContain("See the design, not just a report");
    expect(html).toContain('href="/reviews#publish-review"');
    expect(html).not.toContain("From design to production review");
  });
});
