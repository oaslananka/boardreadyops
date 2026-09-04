import { describe, expect, it, vi } from "vitest";
import { createSqlBoardSupplyWatchStore } from "../../../packages/db/src/board-supply-watch-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

function executor(rows: Record<string, unknown>[]) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows }));
  return { store: createSqlBoardSupplyWatchStore({ query } as unknown as SqlQueryExecutor), query };
}

const now = new Date("2026-08-24T12:00:00.000Z");

describe("board supply watch store: distributor classification and price breaks", () => {
  it("writes distributor classification and price breaks alongside an observation", async () => {
    const { store, query } = executor([{ id: "obs-1" }]);

    await store.recordObservations([
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observedAt: now,
        distributorClassification: "authorized-distributor",
        priceBreaks: [
          { quantity: 1, price: 2.5, currency: "USD" },
          { quantity: 100, price: 1.9, currency: "USD" },
        ],
      },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("distributor_classification");
    expect(sql).toContain("price_breaks");

    const payload = JSON.parse(String(params[0])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({
      mpn: "STM32F103C8T6",
      distributor_classification: "authorized-distributor",
      price_breaks: [
        { quantity: 1, price: 2.5, currency: "USD" },
        { quantity: 100, price: 1.9, currency: "USD" },
      ],
    });
  });

  it("writes a null classification and an empty price-break array when the observation carries neither", async () => {
    const { store, query } = executor([{ id: "obs-2" }]);

    await store.recordObservations([
      { mpn: "RC0603FR-0710KL", manufacturer: "Yageo", status: "active", source: "nexar", observedAt: now },
    ]);

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    const payload = JSON.parse(String(params[0])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({ distributor_classification: null, price_breaks: [] });
  });

  it("reads distributor classification and price breaks back out of a fresh observation", async () => {
    const { store } = executor([
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observed_at: now,
        distributor_classification: "authorized-distributor",
        price_breaks: [{ quantity: 1, price: 2.5, currency: "USD" }],
      },
    ]);

    const fresh = await store.freshObservations(now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
    const entry = [...fresh.values()][0];

    expect(entry).toEqual({
      status: "active",
      source: "nexar",
      observedAt: now.toISOString(),
      distributorClassification: "authorized-distributor",
      priceBreaks: [{ quantity: 1, price: 2.5, currency: "USD" }],
    });
  });

  it("parses a JSON-string price_breaks column the same as a native jsonb array", async () => {
    const { store } = executor([
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observed_at: now,
        distributor_classification: "marketplace",
        price_breaks: JSON.stringify([{ quantity: 10, price: 0.5, currency: "EUR" }]),
      },
    ]);

    const fresh = await store.freshObservations(now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
    const entry = [...fresh.values()][0];

    expect(entry?.distributorClassification).toBe("marketplace");
    expect(entry?.priceBreaks).toEqual([{ quantity: 10, price: 0.5, currency: "EUR" }]);
  });

  it("omits classification and price breaks when the row carries neither, rather than reporting empty placeholders", async () => {
    const { store } = executor([
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observed_at: now,
        distributor_classification: null,
        price_breaks: [],
      },
    ]);

    const fresh = await store.freshObservations(now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
    const entry = [...fresh.values()][0];

    expect(entry?.distributorClassification).toBeUndefined();
    expect(entry?.priceBreaks).toBeUndefined();
  });

  it("drops a malformed price-break entry rather than surfacing a partial or NaN tier", async () => {
    const { store } = executor([
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observed_at: now,
        distributor_classification: "unknown",
        price_breaks: [
          { quantity: 1, price: 2.5, currency: "USD" },
          { quantity: "not-a-number", price: 2.1, currency: "USD" },
        ],
      },
    ]);

    const fresh = await store.freshObservations(now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
    const entry = [...fresh.values()][0];

    expect(entry?.priceBreaks).toEqual([{ quantity: 1, price: 2.5, currency: "USD" }]);
  });
});
