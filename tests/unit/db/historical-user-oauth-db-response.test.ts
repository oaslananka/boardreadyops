import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  confirmHistoricalUserLiveOAuthProof,
  consumeHistoricalUserOAuthChallenge,
  inspectHistoricalUserLiveOAuthProof,
  registerHistoricalUserOAuthChallenge,
  revokeHistoricalUserLiveOAuthProof,
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
    if (
      sql.includes("historical_user_oauth_challenges") ||
      sql.includes("historical_user_live_oauth_verified_proofs")
    ) {
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

  it("confirms a live original USER OAuth code only with exact one-row durable acknowledgement", async () => {
    const input = identity();
    const fixture = fakeAdmissionDatabase((params: unknown[]) => [{ id: params[3], state_sha256: params[2] }]);
    expect(await confirmHistoricalUserLiveOAuthProof(fixture.db, input)).toBe(true);
    expect(
      fixture.query.mock.calls.some(
        ([sql, args]) =>
          sql.includes("historical_user_live_oauth_verified_proofs") &&
          sql.includes("c.consumed_at IS NOT NULL") &&
          args?.[0] === input.exportId &&
          args?.[1] === input.verifiedGitHubUserId &&
          typeof args?.[2] === "string" &&
          args?.[2] !== input.state,
      ),
    ).toBe(true);
  });

  it.each([
    ["missing", []],
    ["malformed", [{}]],
    ["wrong UUID", [{ id: randomUUID() }]],
    ["ambiguous", [{ id: randomUUID() }, { id: randomUUID() }]],
    ["bad rows", [null]],
    ["non-array rows", { length: 1 }],
  ])("denies a %s live OAuth confirmation acknowledgement", async (_, returnedRows) => {
    const fixture = fakeAdmissionDatabase(returnedRows);
    expect(await confirmHistoricalUserLiveOAuthProof(fixture.db, identity())).toBe(false);
  });

  it("only inspects and revokes a current exact original-user signed-in proof", async () => {
    const input = identity();
    const fixture = fakeAdmissionDatabase((params: unknown[]) => [{ state_sha256: params[2] }]);
    expect(await inspectHistoricalUserLiveOAuthProof(fixture.db, input)).toBe("current");
    expect(await revokeHistoricalUserLiveOAuthProof(fixture.db, input)).toBe(true);
    expect(fixture.query.mock.calls.some(([sql]) => sql.includes("p.revoked_at IS NULL"))).toBe(true);
    expect(fixture.query.mock.calls.some(([sql]) => sql.includes("p.customer_delivery_allowed=FALSE"))).toBe(true);
  });

  it.each(["owner", "lock", "blockers"] as const)(
    "refuses to confirm, inspect or revoke OAuth evidence without one clear %s admission row",
    async (type) => {
      const ownerRows = [{ tenant_id: "original-user" }, { tenant_id: "original-user" }];
      const lockRows = [{ acquired: true }, { acquired: true }];
      const blockerRows = [
        { active_hold: false, active_erasure: false },
        { active_hold: false, active_erasure: false },
      ];
      const admission = type === "owner" ? { ownerRows } : type === "lock" ? { lockRows } : { blockerRows };
      const fixture = fakeAdmissionDatabase(
        (params: unknown[]) => [{ state_sha256: params[2], id: params[3] }],
        admission,
      );
      expect(await confirmHistoricalUserLiveOAuthProof(fixture.db, identity())).toBe(false);
      expect(await inspectHistoricalUserLiveOAuthProof(fixture.db, identity())).toBe("stale");
      expect(await revokeHistoricalUserLiveOAuthProof(fixture.db, identity())).toBe(false);
      expect(fixture.query.mock.calls.some(([sql]) => sql.includes("historical_user_live_oauth_verified_proofs"))).toBe(
        false,
      );
    },
  );

  it("rejects forged or duplicated proof inspection and revoke database acknowledgements", async () => {
    const input = identity();
    for (const result of [[null], [{}], [{ state_sha256: "f".repeat(64) }], [{}, {}]]) {
      const fixture = fakeAdmissionDatabase(result);
      expect(await inspectHistoricalUserLiveOAuthProof(fixture.db, input)).toBe("stale");
      expect(await revokeHistoricalUserLiveOAuthProof(fixture.db, input)).toBe(false);
    }
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
