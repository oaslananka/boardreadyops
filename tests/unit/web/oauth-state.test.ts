import { describe, expect, it } from "vitest";
import { parseOAuthStateCookie, safeReturnPath, stateMatches } from "../../../apps/web/lib/oauth-state.js";

describe("safeReturnPath", () => {
  it("allows a same-site absolute path", () => {
    expect(safeReturnPath("/reviews")).toBe("/reviews");
  });

  it("falls back to the dashboard for a missing, empty, or oversized value", () => {
    expect(safeReturnPath(undefined)).toBe("/dashboard");
    expect(safeReturnPath(null)).toBe("/dashboard");
    expect(safeReturnPath("")).toBe("/dashboard");
    expect(safeReturnPath(`/${"a".repeat(600)}`)).toBe("/dashboard");
  });

  it("rejects an open-redirect attempt: protocol-relative, backslash, or embedded scheme", () => {
    expect(safeReturnPath("//evil.example")).toBe("/dashboard");
    expect(safeReturnPath("/\\evil.example")).toBe("/dashboard");
    expect(safeReturnPath("/redirect?to=https://evil.example")).toBe("/dashboard");
    expect(safeReturnPath("https://evil.example")).toBe("/dashboard");
    expect(safeReturnPath("not-a-path")).toBe("/dashboard");
  });
});

describe("parseOAuthStateCookie", () => {
  it("splits a well-formed cookie into its state and return path", () => {
    expect(parseOAuthStateCookie(`abc123.${encodeURIComponent("/reviews")}`)).toEqual({
      state: "abc123",
      returnTo: "/reviews",
    });
  });

  it("returns undefined for a missing, malformed, or empty-state cookie", () => {
    expect(parseOAuthStateCookie(undefined)).toBeUndefined();
    expect(parseOAuthStateCookie("no-separator")).toBeUndefined();
    expect(parseOAuthStateCookie(".returnTo")).toBeUndefined();
  });

  it("returns undefined when the return-path segment cannot be percent-decoded", () => {
    expect(parseOAuthStateCookie("abc123.%")).toBeUndefined();
  });

  it("routes an unsafe embedded return path through safeReturnPath", () => {
    expect(parseOAuthStateCookie(`abc123.${encodeURIComponent("//evil.example")}`)).toEqual({
      state: "abc123",
      returnTo: "/dashboard",
    });
  });
});

describe("stateMatches", () => {
  it("accepts the exact expected state", () => {
    expect(stateMatches("expected-state", "expected-state")).toBe(true);
  });

  it("rejects a mismatched, missing, empty, or oversized presented value", () => {
    expect(stateMatches("expected-state", "wrong-state")).toBe(false);
    expect(stateMatches("expected-state", undefined)).toBe(false);
    expect(stateMatches("expected-state", null)).toBe(false);
    expect(stateMatches("expected-state", "")).toBe(false);
    expect(stateMatches("expected-state", "x".repeat(300))).toBe(false);
  });
});
