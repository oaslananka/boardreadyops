import { describe, expect, it, vi } from "vitest";
import type { ComponentIntelligenceProvider } from "../../../packages/cloud-core/src/component-intelligence.js";
import {
  componentKey,
  createNullComponentIntelligenceProvider,
} from "../../../packages/cloud-core/src/component-intelligence.js";
import {
  runSupplyWatchPass,
  type SupplyWatchStore,
  type WatchBoard,
} from "../../../packages/cloud-core/src/supply-watch.js";

const now = new Date("2026-08-24T12:00:00.000Z");

function board(overrides: Partial<WatchBoard> = {}): WatchBoard {
  return {
    boardId: "board-1",
    snapshotId: "snapshot-1",
    components: [
      { mpn: "STM32F103C8T6", manufacturer: "ST", reference: "U1" },
      { mpn: "RC0603FR-0710KL", manufacturer: "Yageo", reference: "R1" },
    ],
    ...overrides,
  };
}

function storeWith(
  boards: WatchBoard[],
  cached = new Map<string, { status: string; source: string; observedAt: string }>(),
) {
  const completions: Array<{ boardId: string; outcome: string; nextDueAt: Date }> = [];
  const reconciled: Array<{ boardId: string; open: readonly { mpn: string; status: string }[] }> = [];
  const store: SupplyWatchStore = {
    claimDueBoards: vi.fn(async () => boards),
    freshObservations: vi.fn(async () => cached),
    recordObservations: vi.fn(async (observations) => observations.length),
    reconcileFindings: vi.fn(async (boardId, open) => {
      reconciled.push({ boardId, open });
      return { opened: open.length, resolved: 0 };
    }),
    completeEvaluation: vi.fn(async (boardId, outcome, _at, nextDueAt) => {
      completions.push({ boardId, outcome, nextDueAt });
    }),
  };
  return { store, completions, reconciled };
}

function providerReturning(
  statuses: Record<string, "active" | "nrnd" | "eol" | "obsolete" | "unknown">,
): ComponentIntelligenceProvider {
  return {
    name: "test-provider",
    async lookup(parts) {
      return parts.flatMap((part) => {
        const status = statuses[part.mpn];
        return status ? [{ ...part, status, source: "test-provider", observedAt: now }] : [];
      });
    },
  };
}

describe("supply watch pass", () => {
  it("raises a finding for a part that went end of life with no commit involved", async () => {
    const { store, reconciled } = storeWith([board()]);
    const report = await runSupplyWatchPass(store, providerReturning({ STM32F103C8T6: "eol" }), now);

    expect(report.boardsEvaluated).toBe(1);
    expect(reconciled[0]?.open).toEqual([
      expect.objectContaining({ mpn: "STM32F103C8T6", status: "eol", severity: "high", reference: "U1" }),
    ]);
  });

  it("does not raise findings for parts that are still active", async () => {
    const { store, reconciled } = storeWith([board()]);
    await runSupplyWatchPass(store, providerReturning({ STM32F103C8T6: "active", "RC0603FR-0710KL": "active" }), now);

    expect(reconciled[0]?.open).toEqual([]);
  });

  it("only queries the provider for parts missing from the cache", async () => {
    const cached = new Map([
      [
        componentKey({ mpn: "STM32F103C8T6", manufacturer: "ST" }),
        { status: "active", source: "cache", observedAt: now.toISOString() },
      ],
    ]);
    const { store } = storeWith([board()], cached);
    const provider = providerReturning({ "RC0603FR-0710KL": "active" });
    const lookup = vi.spyOn(provider, "lookup");

    const report = await runSupplyWatchPass(store, provider, now);

    expect(report.partsQueried).toBe(1);
    expect(lookup.mock.calls[0]?.[0]).toEqual([{ mpn: "RC0603FR-0710KL", manufacturer: "Yageo" }]);
  });

  it("records no_provider instead of reporting a clean board when nothing is configured", async () => {
    const { store, completions } = storeWith([board()]);
    const report = await runSupplyWatchPass(store, createNullComponentIntelligenceProvider(), now);

    expect(completions[0]?.outcome).toBe("no_provider");
    expect(report.boardsEvaluated).toBe(0);
    expect(report.boardsSkipped).toBe(1);
    expect(store.reconcileFindings).not.toHaveBeenCalled();
  });

  it("skips a board that has captured no components", async () => {
    const { store, completions } = storeWith([board({ components: [], snapshotId: undefined })]);
    const report = await runSupplyWatchPass(store, providerReturning({}), now);

    expect(completions[0]?.outcome).toBe("skipped_no_snapshot");
    expect(report.boardsSkipped).toBe(1);
  });

  it("keeps evaluating the remaining boards when one board fails", async () => {
    const boards = [board({ boardId: "board-failing" }), board({ boardId: "board-healthy" })];
    const { store, completions } = storeWith(boards);
    const provider: ComponentIntelligenceProvider = {
      name: "flaky",
      async lookup(parts) {
        if (parts.length > 0 && completions.length === 0) throw new Error("provider unavailable");
        return parts.map((part) => ({ ...part, status: "active" as const, source: "flaky", observedAt: now }));
      },
    };

    const report = await runSupplyWatchPass(store, provider, now);

    expect(report.failures).toBe(1);
    expect(report.boardsEvaluated).toBe(1);
    expect(completions.map((entry) => entry.outcome)).toEqual(["failed", "evaluated"]);
  });

  it("retries a failed board sooner than a successful one", async () => {
    const { store, completions } = storeWith([board({ boardId: "board-failing" })]);
    const provider: ComponentIntelligenceProvider = {
      name: "always-failing",
      async lookup() {
        throw new Error("provider unavailable");
      },
    };

    await runSupplyWatchPass(store, provider, now, { intervalMs: 86_400_000, retryIntervalMs: 3_600_000 });

    expect(completions[0]?.outcome).toBe("failed");
    expect(completions[0]?.nextDueAt.toISOString()).toBe("2026-08-24T13:00:00.000Z");
  });
});
