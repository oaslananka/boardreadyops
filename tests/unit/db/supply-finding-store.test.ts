import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { createSqlSupplyFindingStore } from "../../../packages/db/src/supply-finding-store.js";

const now = new Date("2026-10-04T17:45:00.000Z");

function executor(outcome: string) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ outcome }] }));
  return { store: createSqlSupplyFindingStore({ query } as unknown as SqlQueryExecutor), query };
}

describe("supply finding acknowledgement store", () => {
  it("acknowledges an open finding inside the requested repository and records the first actor/time", async () => {
    const { store, query } = executor("acknowledged");
    await expect(store.acknowledge("repo-1", "finding-1", "alice", now)).resolves.toBe("acknowledged");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("join boards on boards.id = finding.board_id");
    expect(sql).toContain("boards.repository_id = $2");
    expect(sql).toContain("finding.resolved_at is null");
    expect(sql).toContain("target.acknowledged_at is null");
    expect(sql).toContain("acknowledged_at = $4::timestamptz");
    expect(sql).toContain("acknowledged_by = $3");
    expect(params).toEqual(["finding-1", "repo-1", "alice", now.toISOString()]);
  });

  it("reports an already-acknowledged finding without rewriting its actor/time", async () => {
    const { store, query } = executor("already_acknowledged");
    await expect(store.acknowledge("repo-1", "finding-1", "bob", now)).resolves.toBe("already_acknowledged");

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("when exists (select 1 from target) then 'already_acknowledged'");
  });

  it("does not acknowledge a missing, resolved, or cross-repository finding", async () => {
    const { store } = executor("not_found");
    await expect(store.acknowledge("repo-1", "finding-other", "alice", now)).resolves.toBe("not_found");
  });

  it("rejects invalid identifiers before issuing SQL", async () => {
    const { store, query } = executor("acknowledged");
    await expect(store.acknowledge(" ", "finding-1", "alice", now)).rejects.toThrow("repositoryId is required");
    await expect(store.acknowledge("repo-1", " ", "alice", now)).rejects.toThrow("findingId is required");
    await expect(store.acknowledge("repo-1", "finding-1", " ", now)).rejects.toThrow("actor is required");
    await expect(store.acknowledge("repo-1", "finding-1", "a".repeat(129), now)).rejects.toThrow(
      "actor must be at most 128 characters",
    );
    expect(query).not.toHaveBeenCalled();
  });
});

describe("supply finding suppression store", () => {
  it("creates a time-bound suppression inside the requested repository and preserves history", async () => {
    const { store, query } = executor("suppressed");
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await expect(
      store.suppress("repo-1", "finding-1", "alice", "Approved alternate is already qualified", expiresAt, now),
    ).resolves.toBe("suppressed");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("join boards on boards.id = finding.board_id");
    expect(sql).toContain("boards.repository_id = $2");
    expect(sql).toContain("finding.resolved_at is null");
    expect(sql).toContain("update supply_finding_suppressions as suppression");
    expect(sql).toContain("cleared_by = 'system:expiry'");
    expect(sql).toContain("insert into supply_finding_suppressions");
    expect(sql).toContain("cross join (select count(*) as expired_count from expired) as expiry_gate");
    expect(sql).toContain("where not exists (select 1 from active)");
    expect(sql).toContain("expiry_gate.expired_count >= 0");
    expect(sql).toContain("on conflict do nothing");
    expect(params).toEqual([
      "finding-1",
      "repo-1",
      "alice",
      "Approved alternate is already qualified",
      expiresAt.toISOString(),
      now.toISOString(),
    ]);
  });

  it("orders expiry cleanup before replacement insertion in the same statement", async () => {
    const { store, query } = executor("suppressed");
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await expect(
      store.suppress("repo-1", "finding-1", "alice", "Expired exception replaced", expiresAt, now),
    ).resolves.toBe("suppressed");

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    const expiredCte = sql.indexOf("expired as (");
    const expiryGate = sql.indexOf("cross join (select count(*) as expired_count from expired) as expiry_gate");
    const insertedCte = sql.indexOf("inserted as (");
    expect(expiredCte).toBeGreaterThanOrEqual(0);
    expect(expiryGate).toBeGreaterThan(expiredCte);
    expect(insertedCte).toBeGreaterThan(expiredCte);
  });

  it("does not overwrite an active suppression", async () => {
    const { store } = executor("already_suppressed");
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await expect(
      store.suppress("repo-1", "finding-1", "bob", "Temporary sourcing exception", expiresAt, now),
    ).resolves.toBe("already_suppressed");
  });

  it("clears an active suppression without deleting its audit row", async () => {
    const { store, query } = executor("cleared");

    await expect(store.clearSuppression("repo-1", "finding-1", "alice", now)).resolves.toBe("cleared");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("update supply_finding_suppressions as suppression");
    expect(sql).toContain("cleared_at = $4::timestamptz");
    expect(sql).toContain("cleared_by = $3");
    expect(sql).not.toContain("delete from supply_finding_suppressions");
    expect(params).toEqual(["finding-1", "repo-1", "alice", now.toISOString()]);
  });

  it("validates suppression reason, expiry and actor before issuing SQL", async () => {
    const { store, query } = executor("suppressed");
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await expect(store.suppress("repo-1", "finding-1", "alice", "  ", tomorrow, now)).rejects.toThrow(
      "reason must be at least 3 characters",
    );
    await expect(store.suppress("repo-1", "finding-1", "alice", "x".repeat(501), tomorrow, now)).rejects.toThrow(
      "reason must be at most 500 characters",
    );
    await expect(store.suppress("repo-1", "finding-1", "alice", "Temporary exception", now, now)).rejects.toThrow(
      "expiresAt must be after now",
    );
    await expect(
      store.suppress("repo-1", "finding-1", "a".repeat(129), "Temporary exception", tomorrow, now),
    ).rejects.toThrow("actor must be at most 128 characters");
    expect(query).not.toHaveBeenCalled();
  });
});
