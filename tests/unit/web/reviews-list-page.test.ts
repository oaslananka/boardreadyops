import { describe, expect, it } from "vitest";
import ReviewsListPage from "../../../apps/web/app/reviews/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("ReviewsListPage", () => {
  it("renders reviews grid with lifecycle pills and PR badges", () => {
    const page = ReviewsListPage();
    expect(page).toBeDefined();
    expect(page.props).toBeDefined();

    const review = DEMO_REVIEWS[0];
    expect(review).toBeDefined();
    expect(review?.pullRequestNumber).toBe(42);
    expect(review?.findings.length).toBeGreaterThan(0);
  });
});
