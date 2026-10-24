import type { RepositoryGroup, RepositorySummary } from "./repository-dashboard.js";

/**
 * Rank actionable latest-run findings by recency, not by raw finding count.
 * A finding count is not a severity/risk score. Keep ties stable across
 * installations, group order, and data-source ordering.
 */
export function repositoriesRequiringReview(groups: readonly RepositoryGroup[]): RepositorySummary[] {
  return groups
    .flatMap((group) => group.repositories)
    .filter((repository) => Boolean(repository.latestRunId) && repository.openFindings > 0)
    .sort((left, right) => {
      const time = (value: string | undefined) => {
        const parsed = value ? Date.parse(value) : NaN;
        return Number.isFinite(parsed) ? parsed : -Infinity;
      };
      const chronological = time(right.latestRunAt) - time(left.latestRunAt);
      if (!Number.isNaN(chronological) && chronological !== 0) return chronological;
      const name = `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`);
      return name || left.id.localeCompare(right.id);
    });
}
