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

function fakeAdmissionDatabase(returnedRows: unknown) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) return { rows: [{ tenant_id: "original-user" }] };
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
    if (sql.includes("active_hold")) return { rows: [{ active_hold: false, active_erasure: false }] };
    if (sql.includes("historical_user_oauth_challenges")) {
      return { rows: typeof returnedRows === "function" ? returnedRows(params) : returnedRows };
    }
    throw new Error("Unexpected SQL fixture");
  });
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<boolean>) => fn({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
}

describe("original-user OAuth challenge DB result verification", () => {
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
