import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgQueryExecutor } from "../../../packages/db/src/pg-executor.js";

const fake = vi.hoisted(() => {
  const clientQuery = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows: [{ ok: 1 }] }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  const poolQuery = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows: [{ ok: 2 }] }));
  const close = vi.fn(async () => undefined);
  return { clientQuery, release, connect, poolQuery, close };
});

// The DB workspace has its own pinned pg dependency; spy on that exact Pool.
const driver = createRequire(new URL("../../../packages/db/src/pg-executor.ts", import.meta.url))("pg") as {
  Pool: { prototype: object };
};
const pool = driver.Pool.prototype as {
  connect: typeof fake.connect;
  query: typeof fake.poolQuery;
  end: typeof fake.close;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(pool, "connect").mockImplementation(fake.connect);
  vi.spyOn(pool, "query").mockImplementation(fake.poolQuery);
  vi.spyOn(pool, "end").mockImplementation(fake.close);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PgQueryExecutor transaction modes", () => {
  it("uses a read-only repeatable-read transaction before any statement when opted in", async () => {
    const db = createPgQueryExecutor({ connectionString: "postgres://fake" });
    await expect(
      db.withTransaction((tx) => tx.query("SELECT $1", [7]), {
        consistentRead: true,
        statementTimeoutMs: 5000,
      }),
    ).resolves.toEqual({ rows: [{ ok: 1 }] });

    expect(fake.clientQuery.mock.calls).toEqual([
      ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"],
      ["SELECT set_config('statement_timeout', $1, true)", ["5000"]],
      ["SELECT $1", [7]],
      ["COMMIT"],
    ]);
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("preserves ordinary writable transactions and pooled queries", async () => {
    const db = createPgQueryExecutor({ connectionString: "postgres://fake" });
    await db.withTransaction((tx) => tx.query("UPDATE example SET value=$1", [1]));
    expect(fake.clientQuery.mock.calls).toEqual([["BEGIN"], ["UPDATE example SET value=$1", [1]], ["COMMIT"]]);
    await expect(db.query("SELECT $1", [8])).resolves.toEqual({ rows: [{ ok: 2 }] });
    expect(fake.poolQuery).toHaveBeenCalledWith("SELECT $1", [8]);
    expect(fake.release).toHaveBeenCalledTimes(1);
    await db.close();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases a read-only transaction on invalid statement timeout", async () => {
    const db = createPgQueryExecutor({ connectionString: "postgres://fake" });
    await expect(
      db.withTransaction(async () => undefined, { consistentRead: true, statementTimeoutMs: 0 }),
    ).rejects.toThrow("Invalid transaction statement timeout");
    expect(fake.clientQuery.mock.calls).toEqual([["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"], ["ROLLBACK"]]);
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and preserves query errors without committing", async () => {
    const db = createPgQueryExecutor({ connectionString: "postgres://fake" });
    const rejection = new Error("query interrupted");
    fake.clientQuery.mockImplementationOnce(async () => ({ rows: [{ ok: 1 }] }));
    fake.clientQuery.mockRejectedValueOnce(rejection);
    await expect(db.withTransaction((tx) => tx.query("SELECT fail"), { consistentRead: true })).rejects.toBe(rejection);
    expect(fake.clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT fail",
      "ROLLBACK",
    ]);
    expect(fake.release).toHaveBeenCalledTimes(1);
  });
});
