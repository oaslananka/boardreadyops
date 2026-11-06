import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  releaseHistoricalUserPrivatePartialRead,
  reserveHistoricalUserPrivatePartialRead,
} from "../../../packages/db/src/data-export-historical-partial-read.js";
import { assessHistoricalUserPrivateReadRecovery } from "../../../packages/db/src/data-export-historical-partial-recovery.js";

const goodBinding = () => ({
  exportId: randomUUID(),
  verifiedGitHubUserId: 415,
  preflightId: randomUUID(),
  sha256: "a".repeat(64),
  byteLength: 1024,
});

describe("historical original-user private reader input gate", () => {
  it("rejects malformed or missing reservation bindings before accessing PostgreSQL", async () => {
    const withTransaction = vi.fn();
    const db = { withTransaction } as never;
    for (const binding of [
      null,
      {},
      { ...goodBinding(), exportId: null },
      { ...goodBinding(), verifiedGitHubUserId: "415" },
      { ...goodBinding(), preflightId: undefined },
      { ...goodBinding(), sha256: null },
      { ...goodBinding(), byteLength: Number.POSITIVE_INFINITY },
      { ...goodBinding(), byteLength: 64 * 1024 * 1024 + 1 },
    ]) {
      expect(await reserveHistoricalUserPrivatePartialRead(db, binding as never)).toBeNull();
    }
    expect(await reserveHistoricalUserPrivatePartialRead(null as never, goodBinding())).toBeNull();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("does not release a reservation for a forged or missing token", async () => {
    const query = vi.fn();
    const db = { query } as never;
    for (const token of [null, undefined, "", "not-a-uuid"]) {
      expect(await releaseHistoricalUserPrivatePartialRead(db, { ...goodBinding(), token } as never)).toBe(false);
    }
    expect(
      await releaseHistoricalUserPrivatePartialRead(null as never, { ...goodBinding(), token: randomUUID() }),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not accept multiple or malformed durable release acknowledgements", async () => {
    const input = { ...goodBinding(), token: randomUUID() };
    for (const response of [
      { rows: [{ token: input.token }, { token: input.token }] },
      { rows: [null, { token: input.token }] },
      { rows: [{ token: randomUUID() }] },
      { rows: [{ token: input.token, extra: "not required" }, { token: randomUUID() }] },
      { rows: { length: 1 } },
      { rows: null },
      null,
    ]) {
      const query = vi.fn().mockResolvedValue(response);
      expect(await releaseHistoricalUserPrivatePartialRead({ query } as never, input)).toBe(false);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it("only accepts one matching release acknowledgement", async () => {
    const input = { ...goodBinding(), token: randomUUID() };
    const query = vi.fn().mockResolvedValue({ rows: [{ token: input.token }] });
    expect(await releaseHistoricalUserPrivatePartialRead({ query } as never, input)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("refuses ambiguous inserts during durable private reader registration", async () => {
    const binding = goodBinding();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("LOCK TABLE")) return { rows: [] };
      if (sql.includes("SELECT e.tenant_id")) return { rows: [{ tenant_id: "original-user" }] };
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("AS held")) return { rows: [{ held: false, erasure: false }] };
      if (sql.includes("INSERT INTO public.historical_user_partial_read_reservations")) {
        return { rows: [{ token: params?.[0] }, { token: params?.[0] }] };
      }
      throw new Error("Unexpected SQL in private reader registration fixture");
    });
    let rollbackSignaled = false;
    const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>) => {
      try {
        return await fn({ query });
      } catch (error) {
        // The real database adapter rolls back on a thrown callback. Verify
        // that an ambiguous INSERT takes this path, not a successful commit.
        rollbackSignaled = true;
        throw error;
      }
    });
    expect(await reserveHistoricalUserPrivatePartialRead({ withTransaction } as never, binding)).toBeNull();
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(rollbackSignaled).toBe(true);
  });

  it("cannot treat malformed recovery authority as proof a reader is dead", async () => {
    const withTransaction = vi.fn();
    const db = { withTransaction } as never;
    const base = { db, authority: { exportId: randomUUID(), verifiedGitHubUserId: 415 }, preflightId: randomUUID() };
    for (const input of [
      null,
      {},
      { ...base, authority: null },
      { ...base, authority: { ...base.authority, exportId: null } },
      { ...base, authority: { ...base.authority, verifiedGitHubUserId: 0 } },
      { ...base, preflightId: 18 },
      { ...base, db: null },
    ]) {
      expect(await assessHistoricalUserPrivateReadRecovery(input as never)).toEqual({
        status: "unverified",
        releaseAllowed: false,
      });
    }
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
