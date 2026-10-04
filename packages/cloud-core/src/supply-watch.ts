import {
  type ComponentDataTrust,
  type ComponentIntelligenceProvider,
  type ComponentLifecycleStatus,
  type ComponentObservation,
  type ComponentObservationSignals,
  type ComponentQuery,
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

export type SupplyRiskStatus = "nrnd" | "eol" | "obsolete" | "unavailable" | "restricted";

/** One part on one board that is no longer safe to design in. */
export type RiskyComponentFinding = {
  boardId: string;
  mpn: string;
  manufacturer?: string | undefined;
  reference?: string | undefined;
  status: SupplyRiskStatus;
  severity: "critical" | "high" | "medium";
  /** Provider identifier that justified this finding; raw provider payloads are not retained here. */
  source: string;
  restrictedSubstances?: boolean | undefined;
  complianceNotes?: readonly string[] | undefined;
  trust?: ComponentDataTrust | undefined;
};

export type ObservationCacheScope =
  | { kind: "shared"; providerName: string }
  | { kind: "installation"; installationId: string; providerName: string };

export type CachedSupplyObservation = ComponentObservationSignals & {
  status: string;
  source: string;
  observedAt: string;
};

export type SupplyWatchStore = {
  claimDueBoards(now: Date, limit: number): Promise<WatchBoard[]>;
  freshObservations(
    scope: ObservationCacheScope,
    now: Date,
    keys: readonly { mpn: string; manufacturer?: string | undefined }[],
  ): Promise<Map<string, CachedSupplyObservation>>;
  recordObservations(scope: ObservationCacheScope, observations: readonly ComponentObservation[]): Promise<number>;
  reconcileFindings(
    boardId: string,
    open: readonly RiskyComponentFinding[],
    now: Date,
  ): Promise<{ opened: number; resolved: number }>;
  /**
   * Part identities whose currently-open finding is under a time-bound suppression.
   *
   * Optional for non-SQL/test stores. A lookup failure must fail open in the evaluator so a
   * broken suppression subsystem can never silently discard a real supply alert.
   */
  suppressedPartKeys?(boardId: string, now: Date): Promise<ReadonlySet<string>>;
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
  /**
   * Called with every currently-risky part on a board the pass just evaluated.
   *
   * The whole risky set rather than only the newly-opened rows, deliberately: the notification
   * outbox deduplicates on a key derived from the board and the part, so re-reporting a part
   * that was already announced costs nothing and a notification lost to a delivery failure is
   * still recoverable on the next pass. Detecting an end-of-life part and telling nobody was
   * the gap this exists to close.
   */
  onRiskDetected?: (input: {
    board: WatchBoard;
    findings: readonly RiskyComponentFinding[];
    newlyOpened: number;
  }) => Promise<void> | void;
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

type RiskObservationInput = Pick<
  ComponentObservation,
  "status" | "source" | "availableUnits" | "restrictedSubstances" | "complianceNotes" | "trust"
>;

type RiskObservation = RiskObservationInput & {
  /** Whether provider terms allow normalized evidence beyond the derived risk decision to persist. */
  retainEvidence: boolean;
};

function riskObservationFrom(observation: RiskObservationInput, retainEvidence: boolean): RiskObservation {
  return {
    status: observation.status,
    source: observation.source,
    retainEvidence,
    ...(observation.availableUnits === undefined ? {} : { availableUnits: observation.availableUnits }),
    ...(observation.restrictedSubstances === undefined
      ? {}
      : { restrictedSubstances: observation.restrictedSubstances }),
    ...(observation.complianceNotes === undefined ? {} : { complianceNotes: observation.complianceNotes }),
    ...(observation.trust === undefined ? {} : { trust: observation.trust }),
  };
}

function riskStatus(observation: RiskObservation): SupplyRiskStatus | undefined {
  if (isRiskyLifecycleStatus(observation.status)) return observation.status;
  if (observation.availableUnits === 0) return "unavailable";
  return observation.restrictedSubstances === true ? "restricted" : undefined;
}

function riskSeverity(status: SupplyRiskStatus): "critical" | "high" | "medium" {
  if (status === "unavailable" || status === "restricted") return "high";
  return supplyFindingSeverity(status);
}

function buildOpenRiskyFindings(
  board: WatchBoard,
  parts: readonly ComponentQuery[],
  observations: Map<string, RiskObservation>,
) {
  const referenceByKey = new Map<string, string>();
  for (const component of board.components) {
    if (!component.mpn?.trim()) continue;
    const key = componentKey({ mpn: component.mpn, manufacturer: component.manufacturer });
    if (!referenceByKey.has(key)) referenceByKey.set(key, component.reference);
  }

  return parts.flatMap((part) => {
    const key = componentKey(part);
    const observation = observations.get(key);
    if (!observation) return [];
    const status = riskStatus(observation);
    if (!status) return [];
    return [
      {
        boardId: board.boardId,
        mpn: part.mpn,
        ...(part.manufacturer ? { manufacturer: part.manufacturer } : {}),
        ...(referenceByKey.get(key) ? { reference: referenceByKey.get(key) } : {}),
        status,
        severity: riskSeverity(status),
        source: observation.source,
        ...(observation.retainEvidence && observation.restrictedSubstances !== undefined
          ? { restrictedSubstances: observation.restrictedSubstances }
          : {}),
        ...(observation.retainEvidence && observation.complianceNotes !== undefined
          ? { complianceNotes: observation.complianceNotes }
          : {}),
        ...(observation.retainEvidence && observation.trust !== undefined ? { trust: observation.trust } : {}),
      },
    ];
  });
}

async function queryMissingObservations(
  missing: readonly ComponentQuery[],
  provider: ComponentIntelligenceProvider,
  cacheScope: ObservationCacheScope | undefined,
  observationTtlMs: number,
  store: SupplyWatchStore,
  now: Date,
  observations: Map<string, RiskObservation>,
): Promise<{ partsQueried: number; observationsRecorded: number }> {
  if (missing.length === 0) return { partsQueried: 0, observationsRecorded: 0 };
  const partsQueried = missing.length;
  const observed = await provider.lookup(missing);
  let observationsRecorded = 0;
  if (cacheScope) {
    const expiresAt = new Date(now.getTime() + observationTtlMs);
    observationsRecorded = await store.recordObservations(
      cacheScope,
      observed.map((observation) => ({
        ...observation,
        expiresAt: new Date(Math.min((observation.expiresAt ?? expiresAt).getTime(), expiresAt.getTime())),
      })),
    );
  }
  for (const observation of observed) {
    observations.set(componentKey(observation), riskObservationFrom(observation, cacheScope !== undefined));
  }
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
  const cacheScope: ObservationCacheScope | undefined =
    provider.cachePolicy.maximumCacheAgeMs <= 0
      ? undefined
      : provider.cachePolicy.shareableAcrossTenants
        ? { kind: "shared", providerName: provider.name }
        : { kind: "installation", installationId: board.installationId, providerName: provider.name };
  const parts = queryablePartsOf(board.components);
  const cached = cacheScope ? await store.freshObservations(cacheScope, now, parts) : new Map();
  const missing = parts.filter((part) => !cached.has(componentKey(part)));

  if (missing.length > 0 && provider.name === "none") {
    await store.completeEvaluation(board.boardId, "no_provider", now, new Date(now.getTime() + intervalMs));
    return { skipped: true, partsQueried: 0, observationsRecorded: 0, findingsOpened: 0, findingsResolved: 0 };
  }

  const observations = new Map<string, RiskObservation>();
  for (const [key, observation] of cached) {
    observations.set(
      key,
      riskObservationFrom({ ...observation, status: observation.status as ComponentLifecycleStatus }, true),
    );
  }

  const { partsQueried, observationsRecorded } = await queryMissingObservations(
    missing,
    provider,
    cacheScope,
    observationTtlMs,
    store,
    now,
    observations,
  );

  const open = buildOpenRiskyFindings(board, parts, observations);
  const reconciled = await store.reconcileFindings(board.boardId, open, now);
  await store.completeEvaluation(board.boardId, "evaluated", now, new Date(now.getTime() + intervalMs));

  let notifiable = open;
  if (open.length > 0 && store.suppressedPartKeys) {
    try {
      const suppressed = await store.suppressedPartKeys(board.boardId, now);
      notifiable = open.filter((finding) => !suppressed.has(componentKey(finding)));
    } catch (error) {
      // Fail open: suppression is a noise-control feature, never an authorization boundary.
      options.onError?.(board.boardId, error);
    }
  }

  if (notifiable.length > 0 && options.onRiskDetected) {
    // Awaited so a pass cannot outrun its own notifications, but never allowed to fail the
    // evaluation: the finding is already persisted and is the durable record.
    try {
      await options.onRiskDetected({ board, findings: notifiable, newlyOpened: reconciled.opened });
    } catch (error) {
      options.onError?.(board.boardId, error);
    }
  }

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
