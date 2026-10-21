import { describe, expect, it } from "vitest";
import { buildRunPaginationLinks } from "../../../apps/web/lib/run-pagination-links.js";

function params(url: string) {
  return new URL(url, "https://example.test").searchParams;
}

describe("runs cursor pagination back-stack", () => {
  it("round-trips from page three to page two and back to page one", () => {
    const first = buildRunPaginationLinks({ next: "cursor_page_2", limit: 5 });
    expect(first.previousHref).toBeUndefined();
    expect(first.nextHref).toBeTruthy();

    const pageTwoParams = params(first.nextHref ?? "");
    const second = buildRunPaginationLinks({
      cursor: pageTwoParams.get("cursor") ?? undefined,
      back: pageTwoParams.get("back") ?? undefined,
      next: "cursor_page_3",
      limit: 5,
    });
    expect(second.previousHref).toBe("/runs?limit=5");

    const pageThreeParams = params(second.nextHref ?? "");
    const third = buildRunPaginationLinks({
      cursor: pageThreeParams.get("cursor") ?? undefined,
      back: pageThreeParams.get("back") ?? undefined,
      limit: 5,
    });
    expect(third.nextHref).toBeUndefined();
    expect(third.previousHref).toBe(first.nextHref);

    const backToTwo = params(third.previousHref ?? "");
    const secondAgain = buildRunPaginationLinks({
      cursor: backToTwo.get("cursor") ?? undefined,
      back: backToTwo.get("back") ?? undefined,
      next: "cursor_page_3",
      limit: 5,
    });
    expect(secondAgain.previousHref).toBe("/runs?limit=5");
    expect(secondAgain.nextHref).toBe(second.nextHref);
  });

  it("rejects malformed history and avoids exposing a Previous link for raw deep links", () => {
    expect(buildRunPaginationLinks({ cursor: "cursor_page_2", back: "invalid-history", limit: 5 }).previousHref).toBe(
      undefined,
    );
    expect(buildRunPaginationLinks({ cursor: "cursor_page_2", limit: 5 }).previousHref).toBeUndefined();
    expect(buildRunPaginationLinks({ back: "ignored", limit: 25 }).previousHref).toBeUndefined();
    const tooLong = "A".repeat(16385);
    expect(buildRunPaginationLinks({ cursor: "cursor_page_2", back: tooLong, limit: 5 }).previousHref).toBeUndefined();
  });

  it("keeps a bounded history after many forward links", () => {
    let cursor: string | undefined;
    let back: string | undefined;
    let lastHref: string | undefined;
    for (let n = 1; n <= 30; n++) {
      const links = buildRunPaginationLinks({ cursor, back, next: `cursor_${n}`, limit: 10 });
      lastHref = links.nextHref;
      const query = params(lastHref ?? "");
      cursor = query.get("cursor") ?? undefined;
      back = query.get("back") ?? undefined;
    }
    expect(lastHref).toContain("limit=10");
    expect(back?.length).toBeLessThan(2500);
    expect(buildRunPaginationLinks({ cursor, back, limit: 10 }).previousHref).toBeTruthy();
  });
});
