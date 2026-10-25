import Link from "next/link";
import type { ReviewListFilters, ReviewListSort } from "../../lib/review-list-filters.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";
import { humanize } from "../ui.js";

export type ReviewListFilterBarProps = {
  filters: ReviewListFilters;
  facets: {
    decisions: readonly string[];
    statuses: readonly string[];
    repositories: readonly string[];
  };
  sorts: readonly ReviewListSort[];
  sortLabels: Record<ReviewListSort, string>;
  /** Shown next to the controls so the count always reflects what is on screen. */
  shown: number;
  total: number;
  awaiting: number;
  filtered: boolean;
};

/**
 * A GET form rather than client state.
 *
 * Every other filtered list in the app (`/rules`, `/parts`, `/runs`) filters through search
 * params so a filtered view is a URL a reviewer can bookmark and paste into a standup. Keeping
 * this one consistent also means it works with JavaScript disabled and needs no hydration.
 */
export function ReviewListFilterBar({
  filters,
  facets,
  sorts,
  sortLabels,
  shown,
  total,
  awaiting,
  filtered,
}: Readonly<ReviewListFilterBarProps>) {
  return (
    <section
      className="rounded-xl border border-border bg-card px-4 py-4 shadow-e1 sm:px-5"
      aria-label="Review filters"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">Your review queue</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Filter by source, decision or repository. Saved filters stay shareable.
          </p>
        </div>
        <Link
          href="/reviews?decision=pending&sort=decision"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/15"
          aria-label={`Show ${awaiting} reviews awaiting a decision`}
        >
          <span>Awaiting decision</span>
          <span className="rounded-md bg-primary/15 px-2 py-0.5 tabular-nums">{awaiting}</span>
        </Link>
      </div>
      <form method="get" className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-52 flex-1">
            <label htmlFor="review-filter-q" className="sr-only">
              Search reviews
            </label>
            <Input
              id="review-filter-q"
              name="q"
              type="search"
              maxLength={128}
              defaultValue={filters.query ?? ""}
              placeholder="Search review title, repository or PR"
              aria-label="Search reviews"
            />
          </div>
          <Button type="submit" size="sm">
            Search
          </Button>
        </div>

        <details className="group border-t border-border/60 pt-3">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-muted-foreground marker:hidden hover:text-foreground">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="text-primary">
                ≡
              </span>
              {filtered
                ? "Filters active · refine decision, status, repository and sort"
                : "Refine by decision, status, repository and sort"}
            </span>
            <span aria-hidden="true" className="transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label htmlFor="review-filter-decision" className="text-meta font-medium text-foreground">
                Decision
              </label>
              <NativeSelect
                id="review-filter-decision"
                name="decision"
                defaultValue={filters.decision ?? ""}
                className="mt-1"
              >
                <option value="">Any decision</option>
                {facets.decisions.map((decision) => (
                  <option key={decision} value={decision}>
                    {humanize(decision)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="review-filter-status" className="text-meta font-medium text-foreground">
                Status
              </label>
              <NativeSelect
                id="review-filter-status"
                name="status"
                defaultValue={filters.status ?? ""}
                className="mt-1"
              >
                <option value="">Any status</option>
                {facets.statuses.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="review-filter-repository" className="text-meta font-medium text-foreground">
                Repository
              </label>
              <NativeSelect
                id="review-filter-repository"
                name="repository"
                defaultValue={filters.repository ?? ""}
                className="mt-1"
              >
                <option value="">Every repository</option>
                {facets.repositories.map((repository) => (
                  <option key={repository} value={repository}>
                    {repository}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="review-filter-sort" className="text-meta font-medium text-foreground">
                Sort by
              </label>
              <NativeSelect id="review-filter-sort" name="sort" defaultValue={filters.sort} className="mt-1">
                {sorts.map((sort) => (
                  <option key={sort} value={sort}>
                    {sortLabels[sort]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" size="sm">
              Apply filters
            </Button>
          </div>
        </details>
      </form>
      {filtered ? (
        <Link
          href="/reviews"
          className="mt-2 inline-flex min-h-9 items-center text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          Clear filters
        </Link>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {filtered ? (
          <>
            Showing <strong className="text-foreground tabular-nums">{shown}</strong> of{" "}
            <strong className="text-foreground tabular-nums">{total}</strong> review{total === 1 ? "" : "s"}
          </>
        ) : (
          <>
            <strong className="text-foreground tabular-nums">{total}</strong> review{total === 1 ? "" : "s"},{" "}
            <strong className="text-foreground tabular-nums">{awaiting}</strong> awaiting a decision
          </>
        )}
      </p>
    </section>
  );
}
