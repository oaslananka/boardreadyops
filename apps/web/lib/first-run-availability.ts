import { releaseRepositoryDispatchAvailability } from "./release-rollout.js";
import type { RepositoryGroup } from "./repository-dashboard.js";

/** Repository-scope must already come from the signed-in viewer's authorized installations. */
export function firstRunAvailability(
  groups: readonly RepositoryGroup[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const withoutRuns = groups.flatMap((group) => group.repositories).filter((repository) => !repository.latestRunId);
  const gatedRepositoryIds = new Set<string>();
  let firstEnabledRepositoryId: string | undefined;

  for (const repository of withoutRuns) {
    const dispatch = releaseRepositoryDispatchAvailability(`${repository.owner}/${repository.name}`, environment);
    if (!dispatch.enabled) gatedRepositoryIds.add(repository.id);
    else firstEnabledRepositoryId ??= repository.id;
  }

  return {
    withoutRuns: withoutRuns.length,
    gated: gatedRepositoryIds.size,
    eligible: withoutRuns.length - gatedRepositoryIds.size,
    gatedRepositoryIds,
    firstEnabledRepositoryId,
  };
}
