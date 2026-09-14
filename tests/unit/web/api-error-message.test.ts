import { describe, expect, it } from "vitest";
import { describeApiFailure, describeNetworkFailure } from "../../../apps/web/lib/api-error-message.js";

describe("API failure wording", () => {
  it("turns the bare 401 code into a sentence with a way out", () => {
    // `/policies` used to render the response body verbatim, so a signed-out visitor saw the
    // lowercase string "authentication required" in a red banner with nothing to click.
    const failure = describeApiFailure(401, "authentication required", "governance policies");
    expect(failure.message).toBe("Sign in to see and change governance policies.");
    expect(failure.action).toEqual({ label: "Sign in with GitHub", href: "/api/auth/github/login" });
  });

  it("keeps a message that was already written for a person, and still offers sign-in on a 401", () => {
    const written = "Automated setup PR creation requires Contents (write) permission.";
    expect(describeApiFailure(403, written).message).toBe(written);
    const unauthorized = describeApiFailure(401, written);
    expect(unauthorized.message).toBe(written);
    expect(unauthorized.action?.href).toBe("/api/auth/github/login");
  });

  it("replaces developer shorthand regardless of status", () => {
    for (const shorthand of ["not_found", "db error", "ERR_CONN", "forbidden repository scope"]) {
      expect(describeApiFailure(500, shorthand).message).not.toContain(shorthand);
    }
  });

  it("explains each failure class differently rather than with one generic line", () => {
    const messages = [403, 404, 409, 429, 503, 500, 418].map((status) => describeApiFailure(status).message);
    expect(new Set(messages).size).toBe(messages.length);
    expect(describeApiFailure(403).message).toContain("Settings → Members");
    expect(describeApiFailure(409).message).toContain("Reload");
    expect(describeApiFailure(429).message).toContain("Wait a moment");
  });

  it("offers sign-in only where signing in is the remedy", () => {
    for (const status of [403, 404, 409, 429, 500, 503]) {
      expect(describeApiFailure(status).action).toBeUndefined();
    }
  });

  it("names the subject it was given, capitalized when it opens the sentence", () => {
    expect(describeApiFailure(503, undefined, "run history").message).toContain("Run history is temporarily");
    expect(describeApiFailure(401, undefined, "run history").message).toContain("see and change run history");
  });

  it("has a distinct message for a request that never reached the server", () => {
    expect(describeNetworkFailure().message).toContain("network");
    expect(describeNetworkFailure().action).toBeUndefined();
  });
});
