import {
  type ComponentIntelligenceProvider,
  type ComponentLifecycleStatus,
  componentKey,
  isRiskyLifecycleStatus,
  queryablePartsOf,
  supplyFindingSeverity,
} from "./component-intelligence.js";

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
};

export type WatchOutcome = "evaluated" | "skipped_no_snapshot" | "no_provider" | "failed";

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
  /** How long a cached observation stays fresh. Lifecycle state changes slowly. */
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

const defaultObservationTtlMs = 7 * 24 * 60 * 60 * 1000;
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
export async function runSupplyWatchPass(
  store: SupplyWatchStore,
  provider: ComponentIntelligenceProvider,
  now: Date,
  options: SupplyWatchOptions = {},
): Promise<SupplyWatchReport> {
  const observationTtlMs = options.observationTtlMs ?? defaultObservationTtlMs;
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
      if (!board.snapshotId || board.components.length === 0) {
        report.boardsSkipped += 1;
        await store.completeEvaluation(board.boardId, "skipped_no_snapshot", now, new Date(now.getTime() + intervalMs));
        continue;
      }

      const parts = queryablePartsOf(board.components);
      const cached = await store.freshObservations(now, parts);
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
        const expiresAt = new Date(now.getTime() + observationTtlMs);
        report.observationsRecorded += await store.recordObservations(
          observed.map((observation) => ({ ...observation, expiresAt: observation.expiresAt ?? expiresAt })),
        );
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
