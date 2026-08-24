import { describe, expect, it } from "vitest";
import {
  configuredSessionSecret,
  decodeUserSession,
  encodeUserSession,
  type UserSession,
} from "../../../apps/web/lib/user-session.js";

const secret = "s".repeat(48);
const issuedAt = new Date("2026-08-25T12:00:00.000Z");

function session(overrides: Partial<UserSession> = {}): UserSession {
  return {
    userId: 4711,
    login: "octo-dev",
    installationIds: [1001, 1002],
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("user session cookie", () => {
  it("round-trips a session it signed itself", () => {
    const token = encodeUserSession(session(), secret);
    expect(decodeUserSession(token, secret, issuedAt)).toEqual(session());
  });

  it("rejects a token signed with a different secret", () => {
    const token = encodeUserSession(session(), secret);
    expect(decodeUserSession(token, "d".repeat(48), issuedAt)).toBeUndefined();
  });

  it("rejects a token whose payload was edited", () => {
    const token = encodeUserSession(session(), secret);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...session(), installationIds: [9999] }), "utf8").toString("base64url");
    expect(payload).not.toBe(forged);
    expect(decodeUserSession(`${forged}.${signature}`, secret, issuedAt)).toBeUndefined();
  });

  it("rejects a token whose signature was truncated", () => {
    const token = encodeUserSession(session(), secret);
    const [payload, signature] = token.split(".");
    expect(decodeUserSession(`${payload}.${signature?.slice(0, 20)}`, secret, issuedAt)).toBeUndefined();
  });

  it("rejects a session that has expired", () => {
    const token = encodeUserSession(session(), secret);
    const afterExpiry = new Date(issuedAt.getTime() + 9 * 60 * 60 * 1000);
    expect(decodeUserSession(token, secret, afterExpiry)).toBeUndefined();
  });

  it("rejects malformed input rather than throwing", () => {
    for (const value of ["", ".", "no-dot", "a.b.c", "!!!.???"]) {
      expect(() => decodeUserSession(value, secret, issuedAt)).not.toThrow();
      expect(decodeUserSession(value, secret, issuedAt)).toBeUndefined();
    }
  });

  it("rejects a payload that decodes to the wrong shape", () => {
    const payload = Buffer.from(JSON.stringify({ userId: "not-a-number" }), "utf8").toString("base64url");
    const token = encodeUserSession(session(), secret);
    const signature = token.split(".")[1] ?? "";
    expect(decodeUserSession(`${payload}.${signature}`, secret, issuedAt)).toBeUndefined();
  });

  it("requires a secret long enough to be worth signing with", () => {
    expect(configuredSessionSecret({ SESSION_SECRET: "s".repeat(32) })).toBe("s".repeat(32));
    expect(configuredSessionSecret({ SESSION_SECRET: "short" })).toBeUndefined();
    expect(configuredSessionSecret({})).toBeUndefined();
  });
});
