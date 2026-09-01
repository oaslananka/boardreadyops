import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReviewsListPage from "../../../apps/web/app/reviews/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("ReviewsListPage", () => {
  it("renders reviews grid with ReviewListItem and toolbar", async () => {
    const source = await readFile("apps/web/app/reviews/page.tsx", "utf8");
    expect(source).toContain("review-registry-toolbar");
    expect(source).toContain("ReviewListItem");

    const page = ReviewsListPage();
    expect(page).toBeDefined();
    expect(page.props).toBeDefined();

    const review = DEMO_REVIEWS[0];
    expect(review).toBeDefined();
    expect(review?.pullRequestNumber).toBe(42);
    expect(review?.findings.length).toBeGreaterThan(0);
  });

  it("counts only decision-pending reviews as awaiting a decision, not the whole list", () => {
    const nonPendingCount = DEMO_REVIEWS.filter((r) => r.decision !== "pending").length;
    expect(nonPendingCount).toBeGreaterThan(0);

    const markup = renderToStaticMarkup(createElement(ReviewsListPage));
    const pendingCount = DEMO_REVIEWS.filter((r) => r.decision === "pending").length;
    expect(markup).not.toContain(`${DEMO_REVIEWS.length}</strong> active reviews`);
    expect(markup).toContain(`<strong>${pendingCount}</strong> awaiting a decision`);
  });
});
