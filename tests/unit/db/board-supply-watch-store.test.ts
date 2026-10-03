import { describe, expect, it, vi } from "vitest";
import { createSqlBoardSupplyWatchStore } from "../../../packages/db/src/board-supply-watch-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

function executor(rows: Record<string, unknown>[]) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows }));
  return { store: createSqlBoardSupplyWatchStore({ query } as unknown as SqlQueryExecutor), query };
}

const now = new Date("2026-08-24T12:00:00.000Z");
const sharedScope = { kind: "shared" as const, providerName: "nexar" };
const tenantScope = {
  kind: "installation" as const,
  installationId: "installation-1",
  providerName: "nexar",
};

describe("board supply watch store: distributor classification and price breaks", () => {
  it("writes distributor classification and price breaks alongside an observation", async () => {
    const { store, query } = executor([{ id: "obs-1" }]);

    await store.recordObservations(sharedScope, [
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
        availableUnits: 4200,
        leadTimeDays: 28,
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
      available_units: 4200,
      lead_time_days: 28,
    });
  });

  it("writes a null classification and an empty price-break array when the observation carries neither", async () => {
    const { store, query } = executor([{ id: "obs-2" }]);

    await store.recordObservations(sharedScope, [
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

    const fresh = await store.freshObservations(sharedScope, now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
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

    const fresh = await store.freshObservations(sharedScope, now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
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

    const fresh = await store.freshObservations(sharedScope, now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
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

    const fresh = await store.freshObservations(sharedScope, now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);
    const entry = [...fresh.values()][0];

    expect(entry?.priceBreaks).toEqual([{ quantity: 1, price: 2.5, currency: "USD" }]);
  });
});

describe("board supply watch store: cache scope", () => {
  it("filters shared cache reads by provider namespace and returns normalized availability fields", async () => {
    const { store, query } = executor([
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observed_at: now,
        distributor_classification: null,
        price_breaks: [],
        available_units: 4200,
        lead_time_days: 28,
      },
    ]);

    const fresh = await store.freshObservations(sharedScope, now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("from component_lifecycle_observations");
    expect(sql).toContain("provider = $3");
    expect(params[2]).toBe("nexar");
    expect([...fresh.values()][0]).toMatchObject({
      status: "active",
      source: "nexar",
      availableUnits: 4200,
      leadTimeDays: 28,
    });
  });

  it("upserts shared observations inside the provider namespace", async () => {
    const { store, query } = executor([{ id: "shared-obs-1" }]);

    await store.recordObservations(sharedScope, [
      { mpn: "STM32F103C8T6", manufacturer: "ST", status: "active", source: "nexar", observedAt: now },
    ]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("provider, mpn, manufacturer");
    expect(sql).toContain("on conflict (lower(mpn), lower(coalesce(manufacturer, ''))) do update");
    expect(sql).toContain("provider = excluded.provider");
    expect(params[1]).toBe("nexar");
  });

  it("keeps provider cache namespace separate from observation provenance source", async () => {
    const { store, query } = executor([{ id: "shared-obs-2" }]);

    await store.recordObservations(sharedScope, [
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "upstream-catalogue",
        observedAt: now,
      },
    ]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("provider, mpn, manufacturer");
    expect(params[1]).toBe("nexar");
    const payload = JSON.parse(String(params[0])) as Record<string, unknown>[];
    expect(payload[0]?.source).toBe("upstream-catalogue");
  });

  it("reads a non-transferable provider only from its owning installation and provider", async () => {
    const { store, query } = executor([]);

    await store.freshObservations(tenantScope, now, [{ mpn: "STM32F103C8T6", manufacturer: "ST" }]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("from installation_component_observations");
    expect(sql).toContain("installation_id = $1");
    expect(sql).toContain("provider = $2");
    expect(params[0]).toBe("installation-1");
    expect(params[1]).toBe("nexar");
  });

  it("writes normalized observations into the installation-scoped cache", async () => {
    const { store, query } = executor([{ id: "tenant-obs-1" }]);

    await store.recordObservations(tenantScope, [
      {
        mpn: "STM32F103C8T6",
        manufacturer: "ST",
        status: "active",
        source: "nexar",
        observedAt: now,
        availableUnits: 4200,
        leadTimeDays: 28,
      },
    ]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("insert into installation_component_observations");
    expect(sql).toContain("installation_id, provider");
    expect(sql).toContain("available_units");
    expect(sql).toContain("lead_time_days");
    expect(params[0]).toBe("installation-1");
    expect(params[1]).toBe("nexar");
    const payload = JSON.parse(String(params[2])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({ available_units: 4200, lead_time_days: 28 });
  });
});

describe("board supply watch store: finding provenance", () => {
  it("captures the provider source when a finding first opens without updating existing open findings", async () => {
    const { store, query } = executor([{ opened: 1, resolved: 0 }]);

    const result = await store.reconcileFindings(
      "board-1",
      [
        {
          boardId: "board-1",
          mpn: "STM32F103C8T6",
          manufacturer: "ST",
          reference: "U1",
          status: "eol",
          severity: "high",
          source: "nexar",
        },
      ],
      now,
    );

    expect(result).toEqual({ opened: 1, resolved: 0 });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("observation_source");
    expect(sql).toContain("incoming.source");
    expect(sql).toContain("on conflict do nothing");

    const payload = JSON.parse(String(params[1])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({
      mpn: "STM32F103C8T6",
      status: "eol",
      severity: "high",
      source: "nexar",
    });
  });
});
