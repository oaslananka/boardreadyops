import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("documentation accessibility CSS", () => {
  it("keeps Material navigation text at explicit contrast colors", async () => {
    const css = await readFile("docs/stylesheets/accessibility.css", "utf8");

    expect(css).toContain('[data-md-color-scheme="default"] .md-nav__link');
    expect(css).toContain('[data-md-color-scheme="default"] .md-nav__link .md-ellipsis');
    expect(css).toContain('[data-md-color-scheme="default"] .md-nav__label');
    expect(css).toContain('[data-md-color-scheme="default"] .md-nav__title');
    expect(css).toContain("color: #111827;");
    expect(css).toContain('[data-md-color-scheme="slate"] .md-nav__link');
    expect(css).toContain('[data-md-color-scheme="slate"] .md-nav__link .md-ellipsis');
    expect(css).toContain('[data-md-color-scheme="slate"] .md-nav__label');
    expect(css).toContain('[data-md-color-scheme="slate"] .md-nav__title');
    expect(css).toContain("color: #f9fafb;");
  });

  it("uses BoardReadyOps documentation brand variables without weakening scheme-scoped nav contrast", async () => {
    const css = await readFile("docs/stylesheets/accessibility.css", "utf8");

    expect(css).toContain("--bro-docs-bg:");
    expect(css).toContain("--bro-docs-surface:");
    expect(css).toContain("--bro-docs-accent:");
    expect(css).toContain(".md-header");
    expect(css).toContain(".md-tabs");
    expect(css).toContain(".md-typeset code");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps nested navigation labels from inheriting low-opacity theme colors", async () => {
    const css = await readFile("docs/stylesheets/accessibility.css", "utf8");

    expect(css).toContain('[data-md-color-scheme="default"] .md-nav__item--nested > .md-nav__link');
    expect(css).toContain('[data-md-color-scheme="default"] .md-nav__item--nested > .md-nav__link .md-ellipsis');
    expect(css).toContain('[data-md-color-scheme="slate"] .md-nav__item--nested > .md-nav__link');
    expect(css).toContain('[data-md-color-scheme="slate"] .md-nav__item--nested > .md-nav__link .md-ellipsis');
    expect(css.match(/opacity: 1;/g)?.length).toBeGreaterThanOrEqual(8);
  });
});
