import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewListItem } from "../../../apps/web/components/review/review-list-item.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("ReviewListItem", () => {
  it("puts blockers and decision before secondary lifecycle counts", () => {
    const review = DEMO_REVIEWS[0];
    expect(review).toBeDefined();
    if (!review) return;

    const markup = renderToStaticMarkup(createElement(ReviewListItem, { review, context: "registry" }));
    expect(markup).toContain("review-registry-row");
    expect(markup).toContain("Awaiting decision");
    expect(markup).toContain("3 blockers");
    expect(markup).toContain("PR #42");
    expect(markup.indexOf("3 blockers")).toBeLessThan(markup.indexOf("persistent"));
  });
});
