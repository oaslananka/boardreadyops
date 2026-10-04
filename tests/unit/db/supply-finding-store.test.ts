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
