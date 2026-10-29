import { describe, expect, it, vi } from "vitest";
import {
  classifyFenceInventoryFailure,
  inspectArtifactUnlinkFences,
} from "../../../scripts/inspect-artifact-unlink-fences.mjs";

function clientWithRows(rows: { unresolved_count: string; oldest_started_at: Date | null }[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("pg_catalog.pg_class")) return { rows: [{ relrowsecurity: false }] };
    if (sql.includes("count(*)")) return { rows };
    return { rows: [] };
  });
  return { client: { query }, query };
}

describe("read-only unresolved artifact unlink fence inventory", () => {
  it("returns a verified zero, with explicit read-only transaction boundaries", async () => {
    const { client, query } = clientWithRows([{ unresolved_count: "0", oldest_started_at: null }]);
    await expect(inspectArtifactUnlinkFences(client)).resolves.toEqual({
      status: "observed",
      unresolvedCount: 0,
      oldestStartedAt: null,
    });
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe("BEGIN READ ONLY");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql.join("\n")).toContain("SET LOCAL statement_timeout");
    expect(sql.join("\n")).toContain("SET LOCAL lock_timeout");
    expect(sql.join("\n")).toContain("WHERE settled_at IS NULL");
    expect(sql.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|GRANT|ALTER)\b/i);
  });

  it("returns only aggregate count and oldest timestamp, no tenant, path or token", async () => {
    const date = new Date("2026-10-28T10:00:00Z");
    const { client } = clientWithRows([{ unresolved_count: "3", oldest_started_at: date }]);
    await expect(inspectArtifactUnlinkFences(client)).resolves.toEqual({
      status: "observed",
      unresolvedCount: 3,
      oldestStartedAt: date.toISOString(),
    });
  });

  it("fails closed on missing column grant and rolls back", async () => {
    const { client, query } = clientWithRows([]);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_catalog.pg_class")) return { rows: [{ relrowsecurity: false }] };
      if (sql.includes("count(*)")) throw Object.assign(new Error("private detail"), { code: "42501" });
      return { rows: [] };
    });
    await expect(inspectArtifactUnlinkFences(client)).rejects.toMatchObject({ code: "42501" });
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(classifyFenceInventoryFailure({ code: "42501" })).toBe("permission_denied");
  });

  it("rejects an RLS-protected fence table to avoid a misleading zero", async () => {
    const { client, query } = clientWithRows([]);
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("pg_catalog.pg_class") ? [{ relrowsecurity: true }] : [],
    }));
    await expect(inspectArtifactUnlinkFences(client)).rejects.toThrow("row_security_unverified");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it.each([
    [{ unresolved_count: "-1", oldest_started_at: null }],
    [{ unresolved_count: "2", oldest_started_at: null }],
    [{ unresolved_count: "0", oldest_started_at: new Date() }],
    [{ unresolved_count: "9007199254740993", oldest_started_at: new Date() }],
  ])("never reports malformed database aggregates as observed", async (row) => {
    const { client, query } = clientWithRows([row]);
    await expect(inspectArtifactUnlinkFences(client)).rejects.toThrow("invalid_aggregate");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("keeps connection failures generic, without exposing error details", () => {
    expect(classifyFenceInventoryFailure(new Error("password=secret host=private"))).toBe("observation_failed");
    expect(classifyFenceInventoryFailure({ code: "42P01" })).toBe("schema_unavailable");
  });
});
