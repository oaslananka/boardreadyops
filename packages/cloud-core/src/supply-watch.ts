import {
  type ComponentDistributorClassification,
  type ComponentIntelligenceProvider,
  type ComponentLifecycleStatus,
  type ComponentQuery,
  componentKey,
  isRiskyLifecycleStatus,
  type PriceBreak,
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
  components: readonly { mpn: string; manufacturer?: string | undefined; reference: string }[];
  snapshotId?: string | undefined;
  /** Installation that owns this board; selects whose credentials the lookup runs under. */
  installationId: string;
  /**
   * The stored plan tier of the installation that owns this board.
   *
   * Carried on the board rather than resolved per pass because a single pass spans
   * installations, and an unreadable value must degrade to the least privileged tier rather
   * than granting a paid capability by accident.
   */
  planTier?: string | null | undefined;
};

type WatchOutcome = "evaluated" | "skipped_no_snapshot" | "no_provider" | "not_entitled" | "failed";

export type SupplyWatchStore = {
  claimDueBoards(now: Date, limit: number): Promise<WatchBoard[]>;
  freshObservations(
    now: Date,
    keys: readonly { mpn: string; manufacturer?: string | undefined }[],
  ): Promise<
    Map<
      string,
      {
        status: string;
        source: string;
        observedAt: string;
        distributorClassification?: ComponentDistributorClassification | undefined;
        priceBreaks?: readonly PriceBreak[] | undefined;
      }
    >
  >;
  recordObservations(
    observations: readonly {
      mpn: string;
      manufacturer?: string | undefined;
      status: ComponentLifecycleStatus;
      source: string;
      evidenceUrl?: string | undefined;
      observedAt: Date;
      expiresAt?: Date | undefined;
      distributorClassification?: ComponentDistributorClassification | undefined;
      priceBreaks?: readonly PriceBreak[] | undefined;
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
  completeEvaluation(boardId: string, outcome: WatchOutcome, evaluatedAt: Date, nextDueAt: Date): Promise<void>;
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

function buildOpenRiskyFindings(
  board: WatchBoard,
  parts: readonly ComponentQuery[],
  statuses: Map<string, ComponentLifecycleStatus>,
) {
  const referenceByKey = new Map<string, string>();
  for (const component of board.components) {
    if (!component.mpn?.trim()) continue;
    const key = componentKey({ mpn: component.mpn, manufacturer: component.manufacturer });
    if (!referenceByKey.has(key)) referenceByKey.set(key, component.reference);
  }

  return parts.flatMap((part) => {
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
}

async function queryMissingObservations(
  missing: readonly ComponentQuery[],
  provider: ComponentIntelligenceProvider,
  cacheUsable: boolean,
  observationTtlMs: number,
  store: SupplyWatchStore,
  now: Date,
  statuses: Map<string, ComponentLifecycleStatus>,
): Promise<{ partsQueried: number; observationsRecorded: number }> {
  if (missing.length === 0) return { partsQueried: 0, observationsRecorded: 0 };
  const partsQueried = missing.length;
  const observed = await provider.lookup(missing);
  let observationsRecorded = 0;
  if (cacheUsable) {
    const expiresAt = new Date(now.getTime() + observationTtlMs);
    observationsRecorded = await store.recordObservations(
      observed.map((observation) => ({
        ...observation,
        expiresAt: new Date(Math.min((observation.expiresAt ?? expiresAt).getTime(), expiresAt.getTime())),
      })),
    );
  }
  for (const observation of observed) statuses.set(componentKey(observation), observation.status);
  return { partsQueried, observationsRecorded };
}

async function evaluateSingleBoard(
  board: WatchBoard,
  store: SupplyWatchStore,
  resolveProvider: ComponentIntelligenceResolver,
  now: Date,
  intervalMs: number,
  options: SupplyWatchOptions,
): Promise<{
  skipped: boolean;
  partsQueried: number;
  observationsRecorded: number;
  findingsOpened: number;
  findingsResolved: number;
}> {
  if (!supplyWatchEnabled(planTierOf(board.planTier))) {
    await store.completeEvaluation(board.boardId, "not_entitled", now, new Date(now.getTime() + intervalMs));
    return { skipped: true, partsQueried: 0, observationsRecorded: 0, findingsOpened: 0, findingsResolved: 0 };
  }

  if (!board.snapshotId || board.components.length === 0) {
    await store.completeEvaluation(board.boardId, "skipped_no_snapshot", now, new Date(now.getTime() + intervalMs));
    return { skipped: true, partsQueried: 0, observationsRecorded: 0, findingsOpened: 0, findingsResolved: 0 };
  }

  const provider = await resolveProvider(board.installationId);
  const observationTtlMs = Math.min(
    options.observationTtlMs ?? defaultObservationTtlMs,
    provider.cachePolicy.maximumCacheAgeMs,
  );
  const cacheUsable = provider.cachePolicy.shareableAcrossTenants && provider.cachePolicy.maximumCacheAgeMs > 0;
  const parts = queryablePartsOf(board.components);
  const cached = cacheUsable ? await store.freshObservations(now, parts) : new Map();
  const missing = parts.filter((part) => !cached.has(componentKey(part)));

  if (missing.length > 0 && provider.name === "none") {
    await store.completeEvaluation(board.boardId, "no_provider", now, new Date(now.getTime() + intervalMs));
    return { skipped: true, partsQueried: 0, observationsRecorded: 0, findingsOpened: 0, findingsResolved: 0 };
  }

  const statuses = new Map<string, ComponentLifecycleStatus>();
  for (const [key, observation] of cached) statuses.set(key, observation.status as ComponentLifecycleStatus);

  const { partsQueried, observationsRecorded } = await queryMissingObservations(
    missing,
    provider,
    cacheUsable,
    observationTtlMs,
    store,
    now,
    statuses,
  );

  const open = buildOpenRiskyFindings(board, parts, statuses);
  const reconciled = await store.reconcileFindings(board.boardId, open, now);
  await store.completeEvaluation(board.boardId, "evaluated", now, new Date(now.getTime() + intervalMs));

  return {
    skipped: false,
    partsQueried,
    observationsRecorded,
    findingsOpened: reconciled.opened,
    findingsResolved: reconciled.resolved,
  };
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
      const result = await evaluateSingleBoard(board, store, resolveProvider, now, intervalMs, options);
      if (result.skipped) {
        report.boardsSkipped += 1;
      } else {
        report.boardsEvaluated += 1;
        report.partsQueried += result.partsQueried;
        report.observationsRecorded += result.observationsRecorded;
        report.findingsOpened += result.findingsOpened;
        report.findingsResolved += result.findingsResolved;
      }
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
