import { describe, expect, it } from "vitest";
import {
  issueProtectedIntentCsrfToken,
  parseProtectedIntentJson,
  protectedIntentSecret,
  validProtectedIntentCsrfToken,
  validProtectedIntentOrigin,
} from "../../../apps/web/lib/protected-release-intent-request.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const now = new Date("2026-10-13T11:00:00Z");
const secret = "x".repeat(48);
const repoId = "repo-123";
const env = { BOARDREADYOPS_PUBLIC_URL: "https://app.example.com" };
const session: UserSession = {
  userId: 701,
  login: "maintainer",
  issuedAt: "2026-10-13T10:00:00Z",
  expiresAt: "2026-10-13T18:00:00Z",
  installationIds: [501],
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.com/api/v1/repositories/repo-123/protected-release-intent", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.com", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("non-executing protected release CSRF and strict body", () => {
  it("binds short-lived CSRF token to purpose, repository and signed session identity", () => {
    const token = issueProtectedIntentCsrfToken(session, repoId, secret, now);
    expect(validProtectedIntentCsrfToken(token, session, repoId, secret, now)).toBe(true);
    expect(validProtectedIntentCsrfToken(token, session, "repo-999", secret, now)).toBe(false);
    expect(validProtectedIntentCsrfToken(token, { ...session, userId: 702 }, repoId, secret, now)).toBe(false);
    expect(
      validProtectedIntentCsrfToken(token, { ...session, issuedAt: "2026-10-13T10:02:00Z" }, repoId, secret, now),
    ).toBe(false);
    expect(validProtectedIntentCsrfToken(token, session, repoId, secret, new Date(now.getTime() + 600_001))).toBe(
      false,
    );
  });

  it("refuses expired, modified, invalid, future and wrong-secret tokens", () => {
    const token = issueProtectedIntentCsrfToken(session, repoId, secret, now);
    const future = issueProtectedIntentCsrfToken(session, repoId, secret, new Date(now.getTime() + 3_600_000));
    expect(validProtectedIntentCsrfToken(future, session, repoId, secret, now)).toBe(false);
    expect(validProtectedIntentCsrfToken(`${token}x`, session, repoId, secret, now)).toBe(false);
    expect(validProtectedIntentCsrfToken("not-a-token", session, repoId, secret, now)).toBe(false);
    expect(validProtectedIntentCsrfToken(null, session, repoId, secret, now)).toBe(false);
    expect(validProtectedIntentCsrfToken(token, session, repoId, "z".repeat(48), now)).toBe(false);
    expect(protectedIntentSecret({ SESSION_SECRET: "short" })).toBeUndefined();
    expect(protectedIntentSecret({ SESSION_SECRET: secret })).toBe(secret);
  });

  it("rejects cross-site origin, missing origin and untrusted configuration", () => {
    expect(validProtectedIntentOrigin(post({}), env)).toBe(true);
    expect(validProtectedIntentOrigin(post({}, { "sec-fetch-site": "cross-site" }), env)).toBe(false);
    expect(validProtectedIntentOrigin(post({}, { origin: "https://evil.example.com" }), env)).toBe(false);
    expect(validProtectedIntentOrigin(post({}, { origin: "https://app.example.com.evil.test" }), env)).toBe(false);
    expect(validProtectedIntentOrigin(post({}, { origin: "" }), env)).toBe(false);
    expect(validProtectedIntentOrigin(post({}), {})).toBe(false);
    expect(validProtectedIntentOrigin(post({}), { BOARDREADYOPS_PUBLIC_URL: "http://app.example.com" })).toBe(false);
  });

  it("accepts only small exact sha + request ID JSON", async () => {
    const value = { sha: "a".repeat(40), requestId: "click-123456" };
    expect(await parseProtectedIntentJson(post(value))).toEqual(value);
    expect(await parseProtectedIntentJson(post({ ...value, trustMode: "protected" }))).toBeUndefined();
    expect(await parseProtectedIntentJson(post({ ...value, sha: "invalid" }))).toBeUndefined();
    expect(await parseProtectedIntentJson(post({ ...value, requestId: "x" }))).toBeUndefined();
    expect(await parseProtectedIntentJson(post("{ invalid json"))).toBeUndefined();
    expect(await parseProtectedIntentJson(post(value, { "content-type": "text/plain" }))).toBeUndefined();
    expect(await parseProtectedIntentJson(post("x".repeat(1100)))).toBeUndefined();
  });
});
