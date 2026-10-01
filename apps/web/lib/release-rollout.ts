import {
  releaseRepositoryEnabled,
  releaseRepositoryRolloutPolicyFromEnvironment,
} from "@boardreadyops/db/lifecycle-store";

export type ReleaseRepositoryDispatchAvailability = { enabled: true } | { enabled: false; reason: string };

export const releaseRepositoryRolloutBlockedReason =
  "Cloud readiness runs are not enabled for this repository on this deployment yet. " +
  "Repository setup and existing evidence remain available. A pull request will start a readiness run " +
  "after an operator enables this repository for the rollout.";

export function releaseRepositoryDispatchAvailability(
  fullName: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReleaseRepositoryDispatchAvailability {
  const policy = releaseRepositoryRolloutPolicyFromEnvironment({ ...environment });
  return releaseRepositoryEnabled(fullName, policy)
    ? { enabled: true }
    : { enabled: false, reason: releaseRepositoryRolloutBlockedReason };
}
