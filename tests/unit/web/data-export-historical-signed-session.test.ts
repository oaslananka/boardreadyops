import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  inspectSessionBoundHistoricalUserPrivatePreflight,
  recentSignedHistoricalUserAuthority,
  revokeSessionBoundHistoricalUserPrivatePreflight,
  stageSessionBoundHistoricalUserPrivatePreflight,
} from "../../../apps/web/lib/data-export-historical-signed-session.js";
import { encodeUserSession, type UserSession } from "../../../apps/web/lib/user-session.js";

const secret = "s".repeat(48);
const environment = { SESSION_SECRET: secret };
const exportId = randomUUID();
const now = new Date("2026-11-06T03:00:00.000Z");
function signed(overrides: Partial<UserSession> = {}, signingSecret = secret): string {
  const issued = new Date(now.getTime() - 60_000);
  return encodeUserSession(
    {
      userId: 9_235_789_401,
      login: "renamed-original",
      installationIds: [], // App has been uninstalled; this is intentional.
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + 8 * 60 * 60_000).toISOString(),
      ...overrides,
    },
    signingSecret,
  );
}
const expected = { exportId, verifiedGitHubUserId: 9_235_789_401 };
const principal = (cookie: string, overrides: Record<string, unknown> = {}) =>
  recentSignedHistoricalUserAuthority({
    sessionCookie: cookie,
    exportId,
    environment,
    now,
    ...overrides,
  });

describe("historical original USER signed OAuth session boundary (private only)", () => {
  it("binds immutable numeric GitHub USER without an installed App or matching login", () => {
    expect(principal(signed())).toEqual(expected);
    expect(principal(signed({ installationIds: [7777], login: "new-user-name" }))).toEqual(expected);
  });

  it("rejects login recycling: same login signed for a different numeric owner does not recover prior owner", () => {
    expect(principal(signed({ userId: 9_235_789_402, login: "renamed-original" }))).toEqual({
      exportId,
      verifiedGitHubUserId: 9_235_789_402,
    });
    expect(principal(signed({ userId: 9_235_789_402, login: "renamed-original" }))).not.toEqual(expected);
  });

  it("denies missing, incorrect-secret, forged identity, bad export ID and invalid configuration", () => {
    expect(principal("")).toBeNull();
    expect(principal(signed({}, "x".repeat(48)))).toBeNull();
    const valid = signed();
    const signature = valid.split(".")[1];
    const forged = Buffer.from(JSON.stringify({ userId: 9_235_789_402, login: "renamed-original" })).toString(
      "base64url",
    );
    expect(principal(`${forged}.${signature}`)).toBeNull();
    expect(principal(valid, { exportId: "../private" })).toBeNull();
    expect(principal(valid, { environment: { SESSION_SECRET: "short" } })).toBeNull();
  });

  it("denies old sessions even when their 8-hour cookie has not expired", () => {
    const sixMinutesOld = new Date(now.getTime() - 6 * 60_000);
    expect(
      principal(
        signed({
          issuedAt: sixMinutesOld.toISOString(),
          expiresAt: new Date(sixMinutesOld.getTime() + 8 * 60 * 60_000).toISOString(),
        }),
      ),
    ).toBeNull();
  });

  it("rejects future-issued, expired, excessive-lifetime and invalid-clock sessions", () => {
    expect(principal(signed({ issuedAt: new Date(now.getTime() + 31_000).toISOString() }))).toBeNull();
    expect(
      principal(
        signed({
          issuedAt: new Date(now.getTime() - 120_000).toISOString(),
          expiresAt: new Date(now.getTime() - 20_000).toISOString(),
        }),
      ),
    ).toBeNull();
    expect(
      principal(
        signed({
          expiresAt: new Date(now.getTime() + 10 * 60 * 60_000).toISOString(),
        }),
      ),
    ).toBeNull();
    expect(principal(signed(), { now: new Date("invalid") })).toBeNull();
  });

  it("denies private stage, inspect and revoke before DB access on absent/forged identity", async () => {
    const db = {
      withTransaction: () => {
        throw new Error("DB must not be called");
      },
      query: () => {
        throw new Error("DB must not be called");
      },
    };
    const base = {
      db: db as never,
      exportId,
      environment,
      now,
      sessionCookie: signed({}, "x".repeat(48)),
    };
    expect(
      await stageSessionBoundHistoricalUserPrivatePreflight(
        { exportId: base.exportId, environment: base.environment, now: base.now, sessionCookie: base.sessionCookie },
        { db: base.db, archiveBytes: Buffer.from("not an archive"), ttlSeconds: 60 },
      ),
    ).toBeNull();
    expect(
      await inspectSessionBoundHistoricalUserPrivatePreflight(
        { exportId: base.exportId, environment: base.environment, now: base.now, sessionCookie: base.sessionCookie },
        { db: base.db, archiveBytes: Buffer.from("not an archive"), id: randomUUID() },
      ),
    ).toBe("stale");
    expect(
      await revokeSessionBoundHistoricalUserPrivatePreflight({
        ...base,
        id: randomUUID(),
      }),
    ).toBe("stale");
  });
});
