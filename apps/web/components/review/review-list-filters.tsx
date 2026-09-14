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
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4" aria-label="Review filters">
      {/*
        Wraps rather than forcing one row. Five controls and a button do not fit on one line even
        at desktop width, and the search field — the only one without a fixed minimum — was the
        one that got squeezed to nothing, leaving its label overlapping the next control.
      */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="review-filter-q" className="text-meta font-medium text-foreground">
            Search
          </label>
          <Input
            id="review-filter-q"
            name="q"
            type="search"
            maxLength={128}
            defaultValue={filters.query ?? ""}
            placeholder="Title, repository, author, or #PR"
            className="mt-1"
          />
        </div>

        <div className="min-w-40">
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

        <div className="min-w-40">
          <label htmlFor="review-filter-status" className="text-meta font-medium text-foreground">
            Status
          </label>
          <NativeSelect id="review-filter-status" name="status" defaultValue={filters.status ?? ""} className="mt-1">
            <option value="">Any status</option>
            {facets.statuses.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="min-w-48">
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

        <div className="min-w-52">
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

        <div className="flex shrink-0 items-center gap-2">
          <Button type="submit" size="sm">
            Apply
          </Button>
          {filtered ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/reviews">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <p className="text-sm text-muted-foreground" aria-live="polite">
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
