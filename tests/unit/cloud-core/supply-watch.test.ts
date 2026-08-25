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
    // Existing cases assert evaluation behaviour, so the default fixture is on a tier that
    // includes supply watch; the entitlement cases below override it.
    planTier: "pro",
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
    cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
    // Spied so a test can assert the provider was never reached, which is the whole point of
    // the entitlement and cache-bypass cases.
    lookup: vi.fn(async (parts: readonly { mpn: string; manufacturer?: string | undefined }[]) =>
      parts.flatMap((part) => {
        const status = statuses[part.mpn];
        return status ? [{ ...part, status, source: "test-provider", observedAt: now }] : [];
      }),
    ),
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

  it("never queries the provider for a board whose plan excludes supply watch", async () => {
    const { store, completions } = storeWith([board({ planTier: "free" })]);
    const provider = providerReturning({ STM32F103C8T6: "eol" });

    const report = await runSupplyWatchPass(store, provider, now);

    expect(completions[0]?.outcome).toBe("not_entitled");
    expect(report.boardsEvaluated).toBe(0);
    expect(report.boardsSkipped).toBe(1);
    // The part is end of life, so a leak here would both breach the plan and spend a lookup.
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(store.reconcileFindings).not.toHaveBeenCalled();
  });

  it("treats an unreadable plan tier as unentitled rather than granting the capability", async () => {
    // A row written by a newer deployment, or corrupted by hand, must fail closed.
    const { store, completions } = storeWith([board({ planTier: "enterprise-unlimited" })]);
    const provider = providerReturning({ STM32F103C8T6: "eol" });

    await runSupplyWatchPass(store, provider, now);

    expect(completions[0]?.outcome).toBe("not_entitled");
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("keeps a board due after skipping it for entitlement, so upgrading resumes the watch", async () => {
    const { store, completions } = storeWith([board({ planTier: "free" })]);

    await runSupplyWatchPass(store, providerReturning({}), now);

    // Rescheduled on the normal interval rather than disabled: the board stays enrolled and
    // its BOM evidence keeps accruing, so raising the plan needs no backfill.
    expect(completions[0]?.nextDueAt.getTime()).toBeGreaterThan(now.getTime());
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
      cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
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
      cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
      async lookup() {
        throw new Error("provider unavailable");
      },
    };

    await runSupplyWatchPass(store, provider, now, { intervalMs: 86_400_000, retryIntervalMs: 3_600_000 });

    expect(completions[0]?.outcome).toBe("failed");
    expect(completions[0]?.nextDueAt.toISOString()).toBe("2026-08-24T13:00:00.000Z");
  });
  it("never retains an observation longer than the provider's licence permits", async () => {
    const { store } = storeWith([board()]);
    const provider: ComponentIntelligenceProvider = {
      name: "capped",
      // Component data licences commonly cap retention at 24 hours.
      cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: true },
      async lookup(parts) {
        return parts.map((part) => ({
          ...part,
          status: "active" as const,
          source: "capped",
          observedAt: now,
          // A provider suggesting a year must not be able to extend retention past its own cap.
          expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        }));
      },
    };

    await runSupplyWatchPass(store, provider, now, { observationTtlMs: 30 * 24 * 60 * 60 * 1000 });

    const recorded = (store.recordObservations as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? [];
    for (const observation of recorded) {
      expect(observation.expiresAt.getTime()).toBeLessThanOrEqual(now.getTime() + 24 * 60 * 60 * 1000);
    }
  });

  it("does not share cached results across tenants when the licence is non-transferable", async () => {
    const { store } = storeWith([board()]);
    const provider: ComponentIntelligenceProvider = {
      name: "non-transferable",
      cachePolicy: { maximumCacheAgeMs: 24 * 60 * 60 * 1000, shareableAcrossTenants: false },
      async lookup(parts) {
        return parts.map((part) => ({
          ...part,
          status: "active" as const,
          source: "non-transferable",
          observedAt: now,
        }));
      },
    };

    const report = await runSupplyWatchPass(store, provider, now);

    // The shared observation cache is bypassed entirely rather than serving one licensee's
    // answer to another, so every part is looked up and nothing is written to it.
    expect(store.freshObservations).not.toHaveBeenCalled();
    expect(store.recordObservations).not.toHaveBeenCalled();
    expect(report.partsQueried).toBe(2);
    expect(report.boardsEvaluated).toBe(1);
  });
  it("stores nothing for a provider whose terms forbid retaining results", async () => {
    const { store } = storeWith([board()]);
    const provider: ComponentIntelligenceProvider = {
      name: "no-retention",
      // Some distributor terms forbid caching, recording or storing any portion of the content.
      cachePolicy: { maximumCacheAgeMs: 0, shareableAcrossTenants: true },
      async lookup(parts) {
        return parts.map((part) => ({ ...part, status: "eol" as const, source: "no-retention", observedAt: now }));
      },
    };

    const report = await runSupplyWatchPass(store, provider, now);

    // Writing a row and expiring it immediately would still be storing it.
    expect(store.freshObservations).not.toHaveBeenCalled();
    expect(store.recordObservations).not.toHaveBeenCalled();
    // The finding is still raised: the watch works, it just cannot keep the evidence cached.
    expect(report.findingsOpened).toBe(2);
  });
});
