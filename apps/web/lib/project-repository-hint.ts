import { canonicalRepositoryName } from "./review-list-filters.js";

/**
 * A query parameter only proposes the repository to show in a form.
 * Restrict that hint to repositories the signed-in viewer's GitHub App grants
 * already returned. The project create action still re-authorizes the write.
 */
export function authorizedProjectRepositoryHint(
  requested: string | undefined,
  repositories: readonly { owner: string; name: string }[],
): string | undefined {
  const canonical = requested === undefined ? undefined : canonicalRepositoryName(requested);
  if (!canonical) return undefined;
  const match = repositories.find(
    (repository) => canonicalRepositoryName(`${repository.owner}/${repository.name}`) === canonical,
  );
  return match ? `${match.owner}/${match.name}` : undefined;
}
