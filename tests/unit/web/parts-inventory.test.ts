import { describe, expect, it, vi } from "vitest";
import { loadPartsInventory, parsePartLifecycle } from "../../../apps/web/lib/parts-inventory.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const query = vi.fn();
const close = vi.fn();

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

const session: UserSession = {
  userId: 1,
  login: "octocat",
  installationIds: [900001],
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const postgres = { DATABASE_URL: "postgresql://user@localhost:5432/db" } as NodeJS.ProcessEnv;

function partRow(overrides: Record<string, unknown> = {}) {
  return {
    mpn_key: "stm32f405rgt6",
    manufacturer_key: "stmicroelectronics",
    mpn: "STM32F405RGT6",
    manufacturer: "STMicroelectronics",
    board_count: 2,
    total_quantity: 3,
    board_names: ["Gateway", "Sensor node"],
    lifecycle_status: "eol",
    lifecycle_observed_at: "2026-08-01T00:00:00.000Z",
    lifecycle_source: "octopart",
    finding_count: 1,
    severity_rank: 2,
    ...overrides,
  };
}

/** The listing query resolves first, the unidentified-count query second. */
function answer(parts: readonly unknown[], unidentified = 0) {
  query.mockReset();
  query.mockImplementation((sql: string) =>
    sql.includes("component.mpn is null")
      ? Promise.resolve({ rows: [{ total: unidentified }] })
      : Promise.resolve({ rows: parts }),
  );
}

describe("parsePartLifecycle", () => {
  it("accepts the statuses the schema allows", () => {
    expect(parsePartLifecycle("eol")).toBe("eol");
    expect(parsePartLifecycle(" OBSOLETE ")).toBe("obsolete");
    expect(parsePartLifecycle("unobserved")).toBe("unobserved");
  });

  it("rejects anything else, so a hand-edited URL cannot reach the query", () => {
    expect(parsePartLifecycle("'; drop table boards; --")).toBeUndefined();
    expect(parsePartLifecycle("")).toBeUndefined();
    expect(parsePartLifecycle(undefined)).toBeUndefined();
  });
});

describe("loadPartsInventory", () => {
  it("maps a part row, including the boards it sits on", async () => {
    answer([partRow()], 4);

    const result = await loadPartsInventory(session, {}, postgres);

    expect(result).toEqual({
      state: "ok",
      unidentifiedComponentCount: 4,
      parts: [
        {
          key: JSON.stringify(["stm32f405rgt6", "stmicroelectronics"]),
          mpn: "STM32F405RGT6",
          manufacturer: "STMicroelectronics",
          boardCount: 2,
          boardNames: ["Gateway", "Sensor node"],
          totalQuantity: 3,
          lifecycle: "eol",
          lifecycleObservedAt: "2026-08-01T00:00:00.000Z",
          lifecycleSource: "octopart",
          openFindingCount: 1,
          worstSeverity: "high",
        },
      ],
    });
  });

  it("scopes boards, snapshots and findings to the session's installations", async () => {
    answer([]);

    await loadPartsInventory(session, {}, postgres);

    const listing = query.mock.calls.find(([sql]) => !String(sql).includes("component.mpn is null"));
    const [sql, parameters] = listing as [string, unknown[]];
    expect(sql).toContain("installations.github_installation_id = any($1::bigint[])");
    expect(parameters[0]).toEqual([900001]);
    // The lifecycle cache is shared across tenants on purpose (migration 0041's header says so),
    // so it must be joined on part identity alone — not narrowed by installation.
    expect(sql).toContain("left join component_lifecycle_observations");
    expect(sql).not.toMatch(/component_lifecycle_observations[\s\S]{0,400}github_installation_id/u);
  });

  it("counts unidentified rows through the same tenant scope as the listing", async () => {
    answer([], 7);

    const result = await loadPartsInventory(session, {}, postgres);

    const counting = query.mock.calls.find(([sql]) => String(sql).includes("component.mpn is null"));
    expect(String((counting as [string, unknown[]])[0])).toContain(
      "installations.github_installation_id = any($1::bigint[])",
    );
    expect(result.state === "ok" && result.unidentifiedComponentCount).toBe(7);
  });

  it("treats a part with no observation as unchecked rather than fine", async () => {
    // "Nobody has looked" and "we looked and it is active" are different answers, and the second
    // is the one that would wrongly reassure someone.
    answer([partRow({ lifecycle_status: null, lifecycle_source: null, lifecycle_observed_at: null })]);

    const result = await loadPartsInventory(session, {}, postgres);
    expect(result.state === "ok" && result.parts[0]?.lifecycle).toBe("unobserved");
  });

  it("maps a status the schema does not recognise to unknown, not to the raw string", async () => {
    answer([partRow({ lifecycle_status: "end-of-production" })]);

    const result = await loadPartsInventory(session, {}, postgres);
    expect(result.state === "ok" && result.parts[0]?.lifecycle).toBe("unknown");
  });

  it("ranks severity by meaning, not alphabetically", async () => {
    answer([
      partRow({ mpn_key: "a", severity_rank: 3 }),
      partRow({ mpn_key: "b", severity_rank: 1 }),
      partRow({ mpn_key: "c", severity_rank: 0, finding_count: 0 }),
    ]);

    const result = await loadPartsInventory(session, {}, postgres);
    expect(result.state === "ok" && result.parts.map((part) => part.worstSeverity)).toEqual([
      "critical",
      "medium",
      undefined,
    ]);
  });

  it("escapes wildcards so a typed % searches for a percent sign", async () => {
    answer([]);

    await loadPartsInventory(session, { query: "100%_TOL" }, postgres);

    const listing = query.mock.calls.find(([sql]) => !String(sql).includes("component.mpn is null"));
    expect((listing as [string, unknown[]])[1][1]).toBe("100\\%\\_tol");
  });

  it("passes the at-risk flag and lifecycle filter through as bound parameters", async () => {
    answer([]);

    await loadPartsInventory(session, { lifecycle: "obsolete", risk: "at-risk" }, postgres);

    const listing = query.mock.calls.find(([sql]) => !String(sql).includes("component.mpn is null"));
    const parameters = (listing as [string, unknown[]])[1];
    expect(parameters[2]).toBe("obsolete");
    expect(parameters[3]).toBe(true);
  });

  it("drops a row with no part number, which cannot be matched against anything", async () => {
    answer([partRow(), partRow({ mpn: null, mpn_key: "" })]);

    const result = await loadPartsInventory(session, {}, postgres);
    expect(result.state === "ok" && result.parts).toHaveLength(1);
  });

  it("clamps the page size", async () => {
    answer([]);
    await loadPartsInventory(session, { limit: 99_999 }, postgres);
    const listing = query.mock.calls.find(([sql]) => !String(sql).includes("component.mpn is null"));
    expect((listing as [string, unknown[]])[1][4]).toBe(500);
  });

  it("reports not-configured without a database and signed-out without installations", async () => {
    query.mockReset();

    await expect(loadPartsInventory(session, {}, {} as NodeJS.ProcessEnv)).resolves.toEqual({
      state: "not-configured",
    });
    await expect(loadPartsInventory({ ...session, installationIds: [] }, {}, postgres)).resolves.toEqual({
      state: "signed-out",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("closes the connection even when a query throws", async () => {
    close.mockReset();
    query.mockReset().mockRejectedValue(new Error("connection reset"));

    await expect(loadPartsInventory(session, {}, postgres)).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
