import {
  type ComponentIntelligenceProvider,
  type ComponentLifecycleStatus,
  componentKey,
  isRiskyLifecycleStatus,
  queryablePartsOf,
  supplyFindingSeverity,
} from "./component-intelligence.js";
import { planTierOf, supplyWatchEnabled } from "./entitlements.js";

/**
 * Continuous supply watch.
 *
 * Re-evaluates each board's most recent BOM against refreshed component data on a schedule.
 * This is the half a commit-triggered pipeline cannot cover: a design sits still between
 * releases while the supply chain moves, so the risk appears with no commit to trigger a run.
 */

export type WatchBoard = {
  boardId: string;
  components: readonly { mpn: string; manufacturer: string | undefined; reference: string }[];
  snapshotId: string | undefined;
  /** Installation that owns this board; selects whose credentials the lookup runs under. */
  installationId: string;
  /**
   * The stored plan tier of the installation that owns this board.
   *
   * Carried on the board rather than resolved per pass because a single pass spans
   * installations, and an unreadable value must degrade to the least privileged tier rather
   * than granting a paid capability by accident.
   */
  planTier: string | null | undefined;
};

type WatchOutcome = "evaluated" | "skipped_no_snapshot" | "no_provider" | "not_entitled" | "failed";

export type SupplyWatchStore = {
  claimDueBoards(now: Date, limit: number): Promise<WatchBoard[]>;
  freshObservations(
    now: Date,
    keys: readonly { mpn: string; manufacturer?: string | undefined }[],
  ): Promise<Map<string, { status: string; source: string; observedAt: string }>>;
  recordObservations(
    observations: readonly {
      mpn: string;
      manufacturer?: string | undefined;
      status: ComponentLifecycleStatus;
      source: string;
      evidenceUrl?: string | undefined;
      observedAt: Date;
      expiresAt?: Date | undefined;
    }[],
  ): Promise<number>;
  reconcileFindings(
    boardId: string,
    open: readonly {
      boardId: string;
      mpn: string;
      manufacturer?: string | undefined;
      reference?: string | undefined;
      status: "nrnd" | "eol" | "obsolete";
      severity: "critical" | "high" | "medium";
    }[],
    now: Date,
  ): Promise<{ opened: number; resolved: number }>;
  completeEvaluation(boardId: string, outcome: WatchOutcome, now: Date, nextDueAt: Date): Promise<void>;
};

export type SupplyWatchOptions = {
  /**
   * How long a cached observation stays fresh.
   *
   * Always clamped down to the provider's own `maximumCacheAgeMs`: a deployment may choose to
   * refresh more often than the licence requires, never less.
   */
  observationTtlMs?: number;
  /** Gap until a board is evaluated again after a successful pass. */
  intervalMs?: number;
  /** Gap after a failure, kept short so a transient provider outage recovers quickly. */
  retryIntervalMs?: number;
  maximumBoardsPerRun?: number;
  /**
   * Called when a board's evaluation throws.
   *
   * The pass deliberately continues past a failing board, which would otherwise make the
   * cause invisible. Surfacing it here keeps "kept going" from meaning "silently gave up".
   */
  onError?: (boardId: string, error: unknown) => void;
};

export type SupplyWatchReport = {
  boardsEvaluated: number;
  boardsSkipped: number;
  partsQueried: number;
  observationsRecorded: number;
  findingsOpened: number;
  findingsResolved: number;
  failures: number;
};

// Deliberately below the 24-hour retention cap common in component data licences, so the
// default is safe even against a provider that under-declares its own policy.
const defaultObservationTtlMs = 12 * 60 * 60 * 1000;
const defaultIntervalMs = 24 * 60 * 60 * 1000;
const defaultRetryIntervalMs = 60 * 60 * 1000;
const defaultMaximumBoardsPerRun = 100;

/**
 * Runs one pass of the watch.
 *
 * A board is evaluated against cached observations first and only the parts whose cache entry
 * is missing or stale reach the provider, which is what keeps a scheduled watch affordable.
 *
 * One board failing never aborts the pass: its outcome is recorded as `failed` so it retries
 * sooner, and the remaining boards still get evaluated. A watch that gives up on every board
 * because one provider call threw would go quietly blind, which is the failure this feature
 * exists to prevent.
 */
/**
 * Chooses the provider a given installation's lookups run under.
 *
 * A function rather than a single provider because the recommended model is customer-supplied
 * credentials: each installation queries under its own licence, so one shared instance would
 * be exactly the cross-tenant use those licences forbid. Resolving per installation also lets
 * one customer's missing or revoked key degrade to `no_provider` without affecting anyone else.
 */
export type ComponentIntelligenceResolver = (installationId: string) => Promise<ComponentIntelligenceProvider>;

/** Wraps one provider as a resolver, for deployments and tests with a single configuration. */
export function constantComponentIntelligence(provider: ComponentIntelligenceProvider): ComponentIntelligenceResolver {
  return async () => provider;
}

export async function runSupplyWatchPass(
  store: SupplyWatchStore,
  resolveProvider: ComponentIntelligenceResolver,
  now: Date,
  options: SupplyWatchOptions = {},
): Promise<SupplyWatchReport> {
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const retryIntervalMs = options.retryIntervalMs ?? defaultRetryIntervalMs;
  const limit = options.maximumBoardsPerRun ?? defaultMaximumBoardsPerRun;

  const report: SupplyWatchReport = {
    boardsEvaluated: 0,
    boardsSkipped: 0,
    partsQueried: 0,
    observationsRecorded: 0,
    findingsOpened: 0,
    findingsResolved: 0,
    failures: 0,
  };

  const boards = await store.claimDueBoards(now, limit);

  for (const board of boards) {
    try {
      // Supply watch is a paid capability. A board on a plan without it stays enrolled and
      // keeps accumulating BOM evidence, so raising the plan starts watching it with no
      // backfill; it is simply never queried. Reported as its own outcome because every other
      // value would misdescribe it - 'evaluated' claims a check that did not happen.
      if (!supplyWatchEnabled(planTierOf(board.planTier))) {
        report.boardsSkipped += 1;
        await store.completeEvaluation(board.boardId, "not_entitled", now, new Date(now.getTime() + intervalMs));
        continue;
      }

      if (!board.snapshotId || board.components.length === 0) {
        report.boardsSkipped += 1;
        await store.completeEvaluation(board.boardId, "skipped_no_snapshot", now, new Date(now.getTime() + intervalMs));
        continue;
      }

      const provider = await resolveProvider(board.installationId);
      // The licence wins over the configured value, never the other way round, and it is this
      // installation's licence: policy is read from the resolved provider rather than a
      // process-wide one, so two installations on different providers cannot share a window.
      const observationTtlMs = Math.min(
        options.observationTtlMs ?? defaultObservationTtlMs,
        provider.cachePolicy.maximumCacheAgeMs,
      );
      // Caching is only permitted when the licence allows both retaining a result and reusing
      // it for another licensee. Some distributor terms forbid storing any portion of the
      // content, so a zero retention window bypasses the cache rather than writing and
      // instantly expiring it - storing it at all would be the breach, not serving it.
      const cacheUsable = provider.cachePolicy.shareableAcrossTenants && provider.cachePolicy.maximumCacheAgeMs > 0;

      const parts = queryablePartsOf(board.components);
      // A non-transferable licence means one installation's answer may not serve another, and
      // the observation cache is shared, so it is bypassed entirely rather than leaked across
      // tenants. Every installation then pays for its own lookups.
      const cached = cacheUsable ? await store.freshObservations(now, parts) : new Map();
      const missing = parts.filter((part) => !cached.has(componentKey(part)));

      if (missing.length > 0 && provider.name === "none") {
        // No provider configured: record the fact rather than reporting a clean board, which
        // would be indistinguishable from "checked and found nothing wrong".
        report.boardsSkipped += 1;
        await store.completeEvaluation(board.boardId, "no_provider", now, new Date(now.getTime() + intervalMs));
        continue;
      }

      const statuses = new Map<string, ComponentLifecycleStatus>();
      for (const [key, observation] of cached) statuses.set(key, observation.status as ComponentLifecycleStatus);

      if (missing.length > 0) {
        report.partsQueried += missing.length;
        const observed = await provider.lookup(missing);
        if (cacheUsable) {
          const expiresAt = new Date(now.getTime() + observationTtlMs);
          report.observationsRecorded += await store.recordObservations(
            observed.map((observation) => ({
              ...observation,
              // Never retained past the licence's cap, even if the provider suggests longer.
              expiresAt: new Date(Math.min((observation.expiresAt ?? expiresAt).getTime(), expiresAt.getTime())),
            })),
          );
        }
        for (const observation of observed) statuses.set(componentKey(observation), observation.status);
      }

      const referenceByKey = new Map<string, string>();
      for (const component of board.components) {
        if (!component.mpn?.trim()) continue;
        const key = componentKey({ mpn: component.mpn, manufacturer: component.manufacturer });
        if (!referenceByKey.has(key)) referenceByKey.set(key, component.reference);
      }

      const open = parts.flatMap((part) => {
        const key = componentKey(part);
        const status = statuses.get(key);
        if (!status || !isRiskyLifecycleStatus(status)) return [];
        return [
          {
            boardId: board.boardId,
            mpn: part.mpn,
            ...(part.manufacturer ? { manufacturer: part.manufacturer } : {}),
            ...(referenceByKey.get(key) ? { reference: referenceByKey.get(key) } : {}),
            status,
            severity: supplyFindingSeverity(status),
          },
        ];
      });

      const reconciled = await store.reconcileFindings(board.boardId, open, now);
      report.findingsOpened += reconciled.opened;
      report.findingsResolved += reconciled.resolved;
      report.boardsEvaluated += 1;
      await store.completeEvaluation(board.boardId, "evaluated", now, new Date(now.getTime() + intervalMs));
    } catch (error) {
      report.failures += 1;
      options.onError?.(board.boardId, error);
      try {
        await store.completeEvaluation(board.boardId, "failed", now, new Date(now.getTime() + retryIntervalMs));
      } catch {
        // Recording the failure is best effort; the next pass picks the board up regardless.
      }
    }
  }

  return report;
}
