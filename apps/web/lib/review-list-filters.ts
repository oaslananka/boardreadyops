/**
 * Filtering and sorting for the review registry.
 *
 * The page listed every visible review as an unfiltered, unsorted, unsearchable stack — fine at
 * two reviews, useless at fifty, which is the number a team with a handful of boards reaches in
 * a month. Kept as pure functions over a structural type so both listing shapes (the bundled
 * fixtures and the database rows, which select different columns) go through one implementation
 * and so the behaviour is testable without rendering a page.
 */

export type ReviewListFilterable = {
  repositoryName: string;
  title: string;
  status: string;
  decision: string;
  createdBy: string;
  pullRequestNumber?: number | undefined;
  updatedAt?: string | undefined;
};

export type ReviewListSort = "decision" | "repository" | "updated";

export type ReviewListFilters = {
  /** Free text across title, repository, author and PR number. */
  query: string | undefined;
  decision: string | undefined;
  status: string | undefined;
  repository: string | undefined;
  sort: ReviewListSort;
};

export const reviewListSorts: readonly ReviewListSort[] = ["updated", "decision", "repository"];

export const reviewSortLabels: Record<ReviewListSort, string> = {
  updated: "Recently updated",
  decision: "Awaiting a decision first",
  repository: "Repository name",
};

/** Decision values shown in the filter, in the order a reviewer cares about them. */
const reviewDecisionOrder: readonly string[] = ["pending", "changes_requested", "approved", "rejected"];

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

function isSort(value: string | undefined): value is ReviewListSort {
  return value !== undefined && (reviewListSorts as readonly string[]).includes(value);
}

export function parseReviewListFilters(
  parameters: Readonly<Record<string, string | string[] | undefined>>,
): ReviewListFilters {
  const sort = single(parameters.sort);
  return {
    // Bounded so a pasted essay cannot become the page's heading text or a slow scan.
    query: single(parameters.q)?.slice(0, 128),
    decision: single(parameters.decision),
    status: single(parameters.status),
    repository: single(parameters.repository),
    sort: isSort(sort) ? sort : "updated",
  };
}

function matchesQuery(review: ReviewListFilterable, query: string): boolean {
  const haystack = [
    review.title,
    review.repositoryName,
    review.createdBy,
    review.pullRequestNumber === undefined ? "" : `#${review.pullRequestNumber}`,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function comparator(sort: ReviewListSort): (a: ReviewListFilterable, b: ReviewListFilterable) => number {
  if (sort === "repository") {
    return (a, b) => a.repositoryName.localeCompare(b.repositoryName) || a.title.localeCompare(b.title);
  }
  if (sort === "decision") {
    // Pending first: the registry's job is to surface what still needs someone.
    return (a, b) => {
      const rank = (review: ReviewListFilterable) => {
        const index = reviewDecisionOrder.indexOf(review.decision);
        return index === -1 ? reviewDecisionOrder.length : index;
      };
      return rank(a) - rank(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    };
  }
  return (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

export function applyReviewListFilters<T extends ReviewListFilterable>(
  reviews: readonly T[],
  filters: ReviewListFilters,
): readonly T[] {
  const matched = reviews.filter((review) => {
    if (filters.decision && review.decision !== filters.decision) return false;
    if (filters.status && review.status !== filters.status) return false;
    if (filters.repository && review.repositoryName !== filters.repository) return false;
    if (filters.query && !matchesQuery(review, filters.query)) return false;
    return true;
  });
  // Sorting a copy: the caller's array is often a frozen fixture list.
  return [...matched].sort(comparator(filters.sort));
}

/** Distinct values present in the unfiltered list, for populating the filter controls. */
export function reviewListFacets(reviews: readonly ReviewListFilterable[]): {
  decisions: readonly string[];
  statuses: readonly string[];
  repositories: readonly string[];
} {
  const decisions = new Set<string>();
  const statuses = new Set<string>();
  const repositories = new Set<string>();
  for (const review of reviews) {
    decisions.add(review.decision);
    statuses.add(review.status);
    repositories.add(review.repositoryName);
  }
  return {
    decisions: [...decisions].sort((a, b) => {
      const rank = (value: string) => {
        const index = reviewDecisionOrder.indexOf(value);
        return index === -1 ? reviewDecisionOrder.length : index;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    }),
    // `localeCompare` rather than a bare sort: these are rendered in a dropdown a person reads,
    // and the default comparator orders by UTF-16 code unit, which misplaces any owner or board
    // name outside ASCII.
    statuses: [...statuses].sort((a, b) => a.localeCompare(b)),
    repositories: [...repositories].sort((a, b) => a.localeCompare(b)),
  };
}

export function hasActiveReviewFilter(filters: ReviewListFilters): boolean {
  return Boolean(filters.query || filters.decision || filters.status || filters.repository);
}
