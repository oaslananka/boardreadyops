import { describe, expect, it } from "vitest";
import { applyReviewListFilters, canonicalRepositoryName } from "../../../apps/web/lib/review-list-filters.js";

describe("repository-scoped Reviews navigation", () => {
  it.each([
    ["owner/Board", "owner/board"],
    [" Owner/Board ", "owner/board"],
    ["https://github.com/Owner/Board", "owner/board"],
    ["https://github.com/Owner/Board.git", "owner/board"],
    ["git@github.com:Owner/Board.git", "owner/board"],
    ["owner/board.git", "owner/board.git"],
  ])("normalizes %s to %s", (source, canonical) => {
    expect(canonicalRepositoryName(source)).toBe(canonical);
  });
  it.each([
    "",
    "repo",
    "owner/",
    "owner/repo/extra",
    "owner/../repo",
    "https://github.com.evil.test/owner/repo",
    "https://github.com/owner/repo?x=1",
    "git@other.test:owner/repo",
    "owner/board name",
  ])("rejects invalid identifiers: %s", (source) => {
    expect(canonicalRepositoryName(source)).toBeUndefined();
  });
  it("matches canonical repository identity rather than input casing and form", () => {
    const review = {
      repositoryName: "Owner/Board",
      title: "Review",
      status: "active",
      decision: "pending",
      createdBy: "owner",
    };
    const filters = {
      query: undefined,
      decision: undefined,
      status: undefined,
      repository: "https://github.com/OWNER/board.git",
      sort: "updated" as const,
    };
    expect(applyReviewListFilters([review], filters)).toHaveLength(1);
    expect(applyReviewListFilters([review], { ...filters, repository: "other/board" })).toHaveLength(0);
    expect(
      applyReviewListFilters([review], { ...filters, repository: "https://other.example/Owner/Board" }),
    ).toHaveLength(0);
  });
});
