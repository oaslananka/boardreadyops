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
