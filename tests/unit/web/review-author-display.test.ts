import { describe, expect, it } from "vitest";
import { displayReviewAuthor } from "../../../apps/web/lib/review-author-display.js";

describe("review author display", () => {
  it("never renders a machine identity as a human-readable author", () => {
    expect(displayReviewAuthor("620f1df3-f731-497b-9a8c-c5425f762c7d")).toBe("Recorded member");
    expect(displayReviewAuthor("620F1DF3-F731-497B-9A8C-C5425F762C7D")).toBe("Recorded member");
  });

  it("keeps recorded non-UUID author strings unchanged", () => {
    expect(displayReviewAuthor("reviewer@example.com")).toBe("reviewer@example.com");
    expect(displayReviewAuthor("github-reviewer")).toBe("github-reviewer");
  });

  it("provides a safe fallback when no author label was recorded", () => {
    expect(displayReviewAuthor("")).toBe("Unknown creator");
  });
});
