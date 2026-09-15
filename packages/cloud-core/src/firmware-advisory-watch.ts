import type { Advisory, AdvisoryProvider } from "./advisory-lookup.js";

/**
 * Asks the advisory databases about the firmware identifiers a repository reported.
 *
 * The counters are as much the deliverable as the advisories are. "No advisories found across 40
 * components, 39 of which could not be looked up" is the honest sentence; "no advisories found"
 * is not, and a report built on the second one is the false clean bill that #786, #790 and #793
 * were written to prevent. So `dependenciesSkippedUnidentified`, `rejected` and `unavailable` are
 * reported alongside `advisoriesFound`, and a caller cannot render a summary without them.
 *
 * Shaped after `runSupplyWatchPass`, including the decision to keep going past a failing
 * repository while surfacing it through `onError`, so that "kept going" can never quietly mean
 * "gave up". Part of #755, tracked as #804.
 */

export type FirmwareScanOutcome =
  | "answered"
  | "rejected"
  | "unavailable"
  | "no_provider"
  | "nothing_searchable"
  | "failed";

export type ScannableDependency = {
  name: string;
  manifestPath: string;
  purl?: string | undefined;
  cpe?: string | undefined;
};

export type DueFirmwareScan = {
  repositoryId: string;
  installationId: string;
  snapshotId: string;
  commitSha: string;
  scannable: readonly ScannableDependency[];
  dependencyCount: number;
};

export type FirmwareAdvisoryStore = {
  claimDueScans(now: Date, limit: number): Promise<DueFirmwareScan[]>;
  completeScan(input: {
    repositoryId: string;
    snapshotId: string;
    outcome: FirmwareScanOutcome;
    scannedAt: Date;
    nextDueAt: Date;
  }): Promise<void>;
};

/** One dependency and what the databases said about it. */
export type DependencyAdvisoryResult = {
  dependency: ScannableDependency;
  advisories: readonly Advisory[];
  /**
   * Whether every identifier on this dependency actually got an answer.
   *
   * False when a lookup was refused or the database was unreachable. An empty `advisories` with
   * `answered: false` means nothing was searched, and must never be presented as clean.
   */
  answered: boolean;
};

export type FirmwareAdvisoryReport = {
  repositoriesScanned: number;
  dependenciesQueried: number;
  /** In the snapshot but carrying no usable identifier, so never asked about. */
  dependenciesSkippedUnidentified: number;
  advisoriesFound: number;
  /** Lookups the database refused. Never counted as clean. */
  rejected: number;
  /** Lookups that could not complete. Never counted as clean. */
  unavailable: number;
  failures: number;
};

/**
 * Resolves the provider a scan runs under, or undefined when none is configured.
 *
 * Undefined is a first-class answer rather than an error. A deployment that has not opted into
 * querying third parties completes every due repository as `no_provider`, which records honestly
 * that nothing looked -- the same choice `runSupplyWatchPass` made, and doubly right here because
 * an OSV query by PURL discloses an unreleased board's component list.
 */
export type AdvisoryProviderResolver = (installationId: string) => Promise<AdvisoryProvider | undefined>;

/** Wraps one provider as a resolver, for deployments and tests with a single configuration. */
export function constantAdvisoryProvider(provider: AdvisoryProvider | undefined): AdvisoryProviderResolver {
  return async () => provider;
}

export type FirmwareAdvisoryOptions = {
  /** Gap until a repository is scanned again after a completed pass. */
  intervalMs?: number | undefined;
  /** Gap after an incomplete pass, kept short so a transient outage recovers quickly. */
  retryIntervalMs?: number | undefined;
  maximumRepositoriesPerRun?: number | undefined;
  onError?: ((repositoryId: string, error: unknown) => void) | undefined;
  /**
   * Called with every advisory the pass found for a repository.
   *
   * Given the whole current set rather than only new ones, like `onRiskDetected`: the notification
   * outbox deduplicates, so re-reporting costs nothing and a notification lost to a delivery
   * failure is still recoverable on the next pass.
   */
  onAdvisoriesFound?:
    | ((input: {
        scan: DueFirmwareScan;
        results: readonly DependencyAdvisoryResult[];
        advisoryCount: number;
      }) => Promise<void> | void)
    | undefined;
};

const defaultIntervalMs = 24 * 60 * 60 * 1000;
const defaultRetryIntervalMs = 60 * 60 * 1000;
const defaultMaximumRepositoriesPerRun = 25;

/**
 * Looks up one dependency by whichever identifiers it carries.
 *
 * A dependency may hold both a PURL and a CPE. Both are asked, and `answered` is true only if
 * every attempt came back answered -- one refused lookup is enough to make "nothing found"
 * unsafe to state about this dependency.
 */
async function lookupDependency(
  provider: AdvisoryProvider,
  dependency: ScannableDependency,
): Promise<{ result: DependencyAdvisoryResult; rejected: number; unavailable: number }> {
  const advisories: Advisory[] = [];
  let rejected = 0;
  let unavailable = 0;
  let answered = true;

  if (dependency.purl !== undefined) {
    const outcome = await provider.findByPurl(dependency.purl);
    if (outcome.status === "answered") advisories.push(...outcome.advisories);
    else {
      answered = false;
      if (outcome.status === "rejected") rejected += 1;
      else unavailable += 1;
    }
  }

  if (dependency.cpe !== undefined) {
    const outcome = await provider.findByCpe(dependency.cpe);
    if (outcome.status === "answered") advisories.push(...outcome.advisories);
    else {
      answered = false;
      if (outcome.status === "rejected") rejected += 1;
      else unavailable += 1;
    }
  }

  return { result: { dependency, advisories, answered }, rejected, unavailable };
}

/**
 * The outcome recorded for a repository.
 *
 * `answered` requires every lookup to have answered. A pass where one identifier was refused and
 * the rest came back clean is not an answered pass, because the gap is exactly what a reader would
 * otherwise never learn about.
 */
function outcomeFor(input: { queried: number; rejected: number; unavailable: number }): FirmwareScanOutcome {
  if (input.queried === 0) return "nothing_searchable";
  if (input.unavailable > 0) return "unavailable";
  if (input.rejected > 0) return "rejected";
  return "answered";
}

export async function runFirmwareAdvisoryPass(
  store: FirmwareAdvisoryStore,
  resolveProvider: AdvisoryProviderResolver,
  now: Date,
  options: FirmwareAdvisoryOptions = {},
): Promise<FirmwareAdvisoryReport> {
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const retryIntervalMs = options.retryIntervalMs ?? defaultRetryIntervalMs;
  const limit = options.maximumRepositoriesPerRun ?? defaultMaximumRepositoriesPerRun;

  const report: FirmwareAdvisoryReport = {
    repositoriesScanned: 0,
    dependenciesQueried: 0,
    dependenciesSkippedUnidentified: 0,
    advisoriesFound: 0,
    rejected: 0,
    unavailable: 0,
    failures: 0,
  };

  const due = await store.claimDueScans(now, limit);

  for (const scan of due) {
    // Counted for every due repository, provider or not: the components nobody can look up are
    // the standing gap, and a pass that only counted them when a provider happened to be
    // configured would hide it exactly when there is nothing else to report.
    report.dependenciesSkippedUnidentified += Math.max(0, scan.dependencyCount - scan.scannable.length);

    try {
      const provider = await resolveProvider(scan.installationId);
      if (provider === undefined) {
        report.repositoriesScanned += 1;
        await store.completeScan({
          repositoryId: scan.repositoryId,
          snapshotId: scan.snapshotId,
          outcome: "no_provider",
          scannedAt: now,
          nextDueAt: new Date(now.getTime() + intervalMs),
        });
        continue;
      }

      const results: DependencyAdvisoryResult[] = [];
      let rejected = 0;
      let unavailable = 0;
      for (const dependency of scan.scannable) {
        const outcome = await lookupDependency(provider, dependency);
        results.push(outcome.result);
        rejected += outcome.rejected;
        unavailable += outcome.unavailable;
      }

      const advisoryCount = results.reduce((total, entry) => total + entry.advisories.length, 0);
      const outcome = outcomeFor({ queried: scan.scannable.length, rejected, unavailable });

      report.repositoriesScanned += 1;
      report.dependenciesQueried += scan.scannable.length;
      report.advisoriesFound += advisoryCount;
      report.rejected += rejected;
      report.unavailable += unavailable;

      if (advisoryCount > 0 && options.onAdvisoriesFound) {
        await options.onAdvisoriesFound({ scan, results, advisoryCount });
      }

      await store.completeScan({
        repositoryId: scan.repositoryId,
        snapshotId: scan.snapshotId,
        outcome,
        scannedAt: now,
        // An incomplete pass comes back sooner, so a transient outage does not cost a full
        // interval of coverage.
        nextDueAt: new Date(
          now.getTime() + (outcome === "answered" || outcome === "nothing_searchable" ? intervalMs : retryIntervalMs),
        ),
      });
    } catch (error) {
      report.failures += 1;
      options.onError?.(scan.repositoryId, error);
      // Recording the failure matters more than the pass continuing: an unrecorded failure
      // leaves the repository due forever and the reason invisible.
      await store
        .completeScan({
          repositoryId: scan.repositoryId,
          snapshotId: scan.snapshotId,
          outcome: "failed",
          scannedAt: now,
          nextDueAt: new Date(now.getTime() + retryIntervalMs),
        })
        .catch((completionError) => options.onError?.(scan.repositoryId, completionError));
    }
  }

  return report;
}
