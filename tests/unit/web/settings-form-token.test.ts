import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueSettingsFormToken, settingsFormTokenValid } from "../../../apps/web/lib/settings-form-token.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const secret = randomBytes(32).toString("base64");
const now = new Date("2026-08-25T12:00:00.000Z");

function session(overrides: Partial<UserSession> = {}): UserSession {
  return {
    userId: 4242,
    login: "octocat",
    installationIds: [111],
    issuedAt: "2026-08-25T08:00:00.000Z",
    expiresAt: "2026-08-25T16:00:00.000Z",
    ...overrides,
  };
}

describe("settings form token", () => {
  it("accepts a token for the session and installation it was issued for", () => {
    const token = issueSettingsFormToken(session(), "installation-1", secret, now);

    expect(settingsFormTokenValid(token, session(), "installation-1", secret, now)).toBe(true);
  });

  it("refuses a token replayed against a different installation", () => {
    // Otherwise one installation's form could write a credential to another.
    const token = issueSettingsFormToken(session(), "installation-1", secret, now);

    expect(settingsFormTokenValid(token, session(), "installation-2", secret, now)).toBe(false);
  });

  it("refuses a token issued to a different user", () => {
    const token = issueSettingsFormToken(session({ userId: 1 }), "installation-1", secret, now);

    expect(settingsFormTokenValid(token, session({ userId: 2 }), "installation-1", secret, now)).toBe(false);
  });

  it("refuses a token from an earlier session of the same user", () => {
    // Signing out and back in must invalidate outstanding forms.
    const token = issueSettingsFormToken(session({ issuedAt: "2026-08-25T07:00:00.000Z" }), "i-1", secret, now);

    expect(settingsFormTokenValid(token, session(), "i-1", secret, now)).toBe(false);
  });

  it("refuses a token signed with a different secret", () => {
    const token = issueSettingsFormToken(session(), "installation-1", randomBytes(32).toString("base64"), now);

    expect(settingsFormTokenValid(token, session(), "installation-1", secret, now)).toBe(false);
  });

  it("expires", () => {
    const token = issueSettingsFormToken(session(), "installation-1", secret, now);
    const later = new Date(now.getTime() + 61 * 60 * 1000);

    expect(settingsFormTokenValid(token, session(), "installation-1", secret, later)).toBe(false);
  });

  it("refuses tampering with the embedded expiry", () => {
    const token = issueSettingsFormToken(session(), "installation-1", secret, now);
    const signature = token.slice(token.indexOf(".") + 1);
    const extended = `${now.getTime() + 10 * 60 * 60 * 1000}.${signature}`;

    // The expiry is inside the signed payload, so moving it invalidates the signature.
    expect(settingsFormTokenValid(extended, session(), "installation-1", secret, now)).toBe(false);
  });

  it("refuses malformed input without throwing", () => {
    for (const bad of [undefined, null, "", ".", "abc", "notanumber.sig", `${now.getTime() + 1000}.`]) {
      expect(settingsFormTokenValid(bad, session(), "installation-1", secret, now)).toBe(false);
    }
  });

  it("refuses an absurdly long token rather than hashing it", () => {
    expect(settingsFormTokenValid("a".repeat(5000), session(), "installation-1", secret, now)).toBe(false);
  });
});
