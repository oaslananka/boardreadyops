import { describe, expect, it, vi } from "vitest";
import { createSqlAffectedBoardsStore } from "../../../packages/db/src/affected-boards-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

/**
 * The supply watch runs board-first, which is right for a scan and wrong for the alert the scan
 * exists to produce. When a part goes NRND, or a CVE lands on it, the question is which shipped
 * boards contain it -- and nothing could answer that. One resolution, two triggers: #449 for
 * lifecycle, #755 for the CRA's reporting window.
 */

function executorReturning(rows: Record<string, unknown>[]): {
  executor: SqlQueryExecutor;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => ({ rows }));
  return { executor: { query } as unknown as SqlQueryExecutor, query };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    board_id: "brd_1",
    display_name: "Sensor Node",
    project_path: "hardware/sensor",
    repository_id: "repo_1",
    repository_full_name: "acme/sensor-node",
    snapshot_id: "snap_9",
    commit_sha: "8ae31f0",
    captured_at: new Date("2026-08-01T10:00:00.000Z"),
    in_current_revision: true,
    refs: ["U7"],
    ...overrides,
  };
}

describe("resolveAffectedBoards", () => {
  it("returns the boards a part appears on", async () => {
    const { executor } = executorReturning([row()]);
    const store = createSqlAffectedBoardsStore(executor);

    const result = await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }]);

    expect(result.truncated).toBe(false);
    expect(result.boards).toEqual([
      {
        boardId: "brd_1",
        displayName: "Sensor Node",
        projectPath: "hardware/sensor",
        repositoryId: "repo_1",
        repositoryFullName: "acme/sensor-node",
        snapshotId: "snap_9",
        commitSha: "8ae31f0",
        capturedAt: "2026-08-01T10:00:00.000Z",
        references: ["U7"],
        inCurrentRevision: true,
      },
    ]);
  });

  it("asks for nothing when given no parts", async () => {
    const { executor, query } = executorReturning([row()]);
    const store = createSqlAffectedBoardsStore(executor);

    const result = await store.resolveAffectedBoards("inst_1", []);

    // A lifecycle pass with nothing risky must not send a query that matches every component.
    expect(query).not.toHaveBeenCalled();
    expect(result).toEqual({ boards: [], truncated: false });
  });

  it("scopes every query to the installation", async () => {
    const { executor, query } = executorReturning([]);
    const store = createSqlAffectedBoardsStore(executor);

    await store.resolveAffectedBoards("inst_42", [{ mpn: "TPS62840" }]);

    const [sql, params] = query.mock.calls[0] ?? [];
    // A part identity is a fact about the world; which of your boards contains it is not.
    expect(String(sql)).toContain("repositories.installation_id = $1");
    expect((params as unknown[])[0]).toBe("inst_42");
  });

  it("lower-cases the part keys it matches on", async () => {
    const { executor, query } = executorReturning([]);
    const store = createSqlAffectedBoardsStore(executor);

    await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840DLCR", manufacturer: "Texas Instruments" }]);

    const params = (query.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(params[1]).toEqual(["tps62840dlcr"]);
    expect(params[2]).toEqual(["texas instruments"]);
  });

  it("passes a null manufacturer through rather than an empty string", async () => {
    const { executor, query } = executorReturning([]);
    const store = createSqlAffectedBoardsStore(executor);

    await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }]);

    const params = (query.mock.calls[0]?.[1] ?? []) as unknown[];
    // A lifecycle notice often names the part without naming who makes it. Matching on an empty
    // manufacturer would find only components that also recorded none, and under-report silently.
    expect(params[2]).toEqual([null]);
  });

  it("distinguishes a part still in the current revision from one only in an older snapshot", async () => {
    const { executor } = executorReturning([
      row({ board_id: "brd_current", in_current_revision: true }),
      row({ board_id: "brd_superseded", in_current_revision: false, snapshot_id: "snap_3" }),
    ]);
    const store = createSqlAffectedBoardsStore(executor);

    const result = await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }]);

    // Collapsing these would either alarm a team about a part designed out months ago, or miss a
    // device already in the field -- and for the CRA the shipped one is what has to be reported.
    expect(result.boards.map((board) => [board.boardId, board.inCurrentRevision])).toEqual([
      ["brd_current", true],
      ["brd_superseded", false],
    ]);
  });

  it("reports truncation instead of presenting a partial set as complete", async () => {
    const { executor, query } = executorReturning([
      row({ board_id: "a" }),
      row({ board_id: "b" }),
      row({ board_id: "c" }),
    ]);
    const store = createSqlAffectedBoardsStore(executor);

    const result = await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }], { limit: 2 });

    expect(result.boards).toHaveLength(2);
    expect(result.truncated).toBe(true);
    // One row beyond the limit is requested, so truncation is known rather than guessed at.
    const params = (query.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(params[3]).toBe(3);
  });

  it("clamps a limit that would return the whole table", async () => {
    const { executor, query } = executorReturning([]);
    const store = createSqlAffectedBoardsStore(executor);

    await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }], { limit: 10_000_000 });

    const params = (query.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(params[3]).toBe(1001);
  });

  it("clamps a limit of zero to something that can return a row", async () => {
    const { executor, query } = executorReturning([]);
    const store = createSqlAffectedBoardsStore(executor);

    await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }], { limit: 0 });

    const params = (query.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(params[3]).toBe(2);
  });

  it("excludes do-not-populate components and archived boards", async () => {
    const { executor, query } = executorReturning([]);
    const store = createSqlAffectedBoardsStore(executor);

    await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }]);

    const sql = String(query.mock.calls[0]?.[0] ?? "");
    // A DNP part is on the drawing and not on the board, so it cannot be affected by a shortage.
    expect(sql).toContain("components.dnp = false");
    expect(sql).toContain("boards.archived_at is null");
  });

  it("reads a captured_at that arrives as a string", async () => {
    const { executor } = executorReturning([row({ captured_at: "2026-08-01T10:00:00.000Z" })]);
    const store = createSqlAffectedBoardsStore(executor);

    const result = await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }]);
    expect(result.boards[0]?.capturedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("survives a row whose references arrive as a comma-joined string", async () => {
    const { executor } = executorReturning([row({ refs: "U7,U8" })]);
    const store = createSqlAffectedBoardsStore(executor);

    const result = await store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }]);
    expect(result.boards[0]?.references).toEqual(["U7", "U8"]);
  });

  it("throws on a row missing a column rather than inventing a board", async () => {
    const { executor } = executorReturning([{ board_id: "brd_1" }]);
    const store = createSqlAffectedBoardsStore(executor);

    // A silently half-populated affected-products list is worse than an error: somebody would
    // report it to a regulator.
    await expect(store.resolveAffectedBoards("inst_1", [{ mpn: "TPS62840" }])).rejects.toThrow(/expected column/u);
  });
});
