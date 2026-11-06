import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  consumeHistoricalUserOAuthChallenge,
  registerHistoricalUserOAuthChallenge,
} from "../../../packages/db/src/data-export-historical-oauth-challenges.js";

const identity = () => ({
  exportId: randomUUID(),
  verifiedGitHubUserId: 42,
  state: "A".repeat(43),
});

function fakeAdmissionDatabase(
  returnedRows: unknown,
  admission?: { ownerRows?: unknown; lockRows?: unknown; blockerRows?: unknown },
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) return { rows: admission?.ownerRows ?? [{ tenant_id: "original-user" }] };
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: admission?.lockRows ?? [{ acquired: true }] };
    if (sql.includes("active_hold"))
      return { rows: admission?.blockerRows ?? [{ active_hold: false, active_erasure: false }] };
    if (sql.includes("historical_user_oauth_challenges")) {
      return { rows: typeof returnedRows === "function" ? returnedRows(params) : returnedRows };
    }
    throw new Error("Unexpected SQL fixture");
  });
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<boolean>) => fn({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
}

describe("original-user OAuth challenge DB result verification", () => {
  it("rejects invalid or non-ASCII nonce characters before opening a transaction", async () => {
    const input = identity();
    const invalid = [
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}.`,
      `${"A".repeat(42)} `,
      `${"A".repeat(42)}\n`,
      `${"A".repeat(42)}\0`,
      `${"A".repeat(42)}é`,
      `${"A".repeat(41)}🔒`,
    ];
    for (const state of invalid) {
      const fixture = fakeAdmissionDatabase([]);
      for (const operation of [registerHistoricalUserOAuthChallenge, consumeHistoricalUserOAuthChallenge]) {
        expect(await operation(fixture.db, { ...input, state })).toBe(false);
      }
      expect(fixture.withTransaction).not.toHaveBeenCalled();
    }
    for (const state of [`${"A".repeat(41)}_-`, `${"z".repeat(43)}`]) {
      const fixture = fakeAdmissionDatabase((params: unknown[]) => [{ state_sha256: params[2] }]);
      expect(await registerHistoricalUserOAuthChallenge(fixture.db, { ...input, state })).toBe(true);
      expect(fixture.withTransaction).toHaveBeenCalledOnce();
    }
  });

  it("denies an INSERT acknowledgement without the exact requested nonce digest", async () => {
    const input = identity();
    for (const returnedRows of [{ length: 1 }, [null], [{}], [{ state_sha256: "f".repeat(64) }]]) {
      const { db } = fakeAdmissionDatabase(returnedRows);
      expect(await registerHistoricalUserOAuthChallenge(db, input)).toBe(false);
    }
  });

  it("denies a consumed-challenge acknowledgement without the exact requested digest", async () => {
    const input = identity();
    for (const returnedRows of [{ length: 1 }, [{}], [{ state_sha256: "f".repeat(64) }]]) {
      const { db } = fakeAdmissionDatabase(returnedRows);
      expect(await consumeHistoricalUserOAuthChallenge(db, input)).toBe(false);
    }
  });

  it("only acknowledges a returned digest exactly equal to the issued or consumed state", async () => {
    const input = identity();
    const { db } = fakeAdmissionDatabase((params: unknown[]) => [{ state_sha256: params[2] }]);
    expect(await registerHistoricalUserOAuthChallenge(db, input)).toBe(true);
    expect(await consumeHistoricalUserOAuthChallenge(db, input)).toBe(true);
  });

  it.each(["owner", "lock", "blockers"] as const)(
    "denies issue and consumption of private OAuth nonce with ambiguous %s evidence",
    async (type) => {
      const input = identity();
      const ownerRows = [{ tenant_id: "original-user" }, { tenant_id: "original-user" }];
      const lockRows = [{ acquired: true }, { acquired: true }];
      const blockerRows = [
        { active_hold: false, active_erasure: false },
        { active_hold: false, active_erasure: false },
      ];
      const admission = type === "owner" ? { ownerRows } : type === "lock" ? { lockRows } : { blockerRows };
      for (const operation of [registerHistoricalUserOAuthChallenge, consumeHistoricalUserOAuthChallenge]) {
        const fixture = fakeAdmissionDatabase((params: unknown[]) => [{ state_sha256: params[2] }], admission);
        expect(await operation(fixture.db, input)).toBe(false);
        expect(fixture.query.mock.calls.some((call) => call[0].includes("historical_user_oauth_challenges"))).toBe(
          false,
        );
      }
    },
  );

  it("rejects malformed owner identity before requesting a DB transaction", async () => {
    const fixture = fakeAdmissionDatabase([]);
    expect(
      await registerHistoricalUserOAuthChallenge(fixture.db, {
        ...identity(),
        verifiedGitHubUserId: "42",
      } as never),
    ).toBe(false);
    expect(fixture.withTransaction).not.toHaveBeenCalled();
  });
});
