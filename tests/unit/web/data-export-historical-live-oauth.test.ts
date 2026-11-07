import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  freshLiveGitHubOriginalUserAuthority,
  stageLiveGitHubVerifiedHistoricalPrivatePreflight,
} from "../../../apps/web/lib/data-export-historical-live-oauth.js";
import { encodeUserSession } from "../../../apps/web/lib/user-session.js";

const exportId = randomUUID();
const sessionSecret = "s".repeat(48);
const now = new Date("2026-11-06T03:00:00.000Z");
const identityId = 9_235_789_401;
const validState = randomBytes(32).toString("base64url");
const environment = {
  SESSION_SECRET: sessionSecret,
  GITHUB_CLIENT_ID: "Iv1.test-client",
  GITHUB_CLIENT_SECRET: "server-only-client-secret",
  BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/",
};
const returnTo = `/dashboard?historical_user_export=${exportId}`;
const stateCookie = `${validState}.${encodeURIComponent(returnTo)}`;

const sessionFor = (userId = identityId, issuedAt = new Date(now.getTime() - 60_000)) =>
  encodeUserSession(
    {
      userId,
      login: "original-reused",
      installationIds: [], // Original installation is uninstalled.
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60_000).toISOString(),
    },
    sessionSecret,
  );

function liveFetch(userId = identityId, failure?: "exchange" | "viewer" | "network") {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (failure === "network") throw new Error("Unavailable network");
    if (url === "https://github.com/login/oauth/access_token") {
      return new Response(
        JSON.stringify(
          failure === "exchange" ? { error: "bad_verification_code" } : { access_token: "short-lived-token" },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ id: userId, login: "original-reused" }), {
        status: failure === "viewer" ? 401 : 200,
      });
    }
    if (url.startsWith("https://api.github.com/user/installations?")) {
      // Uninstalled user has no active App installation.
      return new Response(JSON.stringify({ installations: [] }), { status: 200 });
    }
    throw new Error("Unexpected external endpoint");
  });
  return fn as typeof fn & typeof fetch;
}

function proof(fetcher: typeof fetch, patch: Record<string, unknown> = {}) {
  return {
    exportId,
    sessionCookie: sessionFor(),
    oauthStateCookie: stateCookie,
    callbackState: validState,
    authorizationCode: "single-use-callback-code",
    environment,
    now,
    fetch: fetcher,
    ...patch,
  };
}

describe("historical original numeric USER fresh live GitHub OAuth step-up (private only)", () => {
  it("proves immutable USER with a newly exchanged code and GitHub /user, even with zero installations", async () => {
    const fetch = liveFetch();
    expect(await freshLiveGitHubOriginalUserAuthority(proof(fetch))).toEqual({
      exportId,
      verifiedGitHubUserId: identityId,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    const calls = fetch.mock.calls.map((args) => String(args[0]));
    expect(calls).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
      expect.stringContaining("https://api.github.com/user/installations?"),
    ]);
  });

  it("rejects a same-login recycled GitHub account with different numeric USER identity", async () => {
    expect(await freshLiveGitHubOriginalUserAuthority(proof(liveFetch(identityId + 1)))).toBeNull();
    expect(
      await freshLiveGitHubOriginalUserAuthority(
        proof(liveFetch(), {
          sessionCookie: sessionFor(identityId + 1),
        }),
      ),
    ).toBeNull();
  });

  it("denies malformed, unbound, substituted and absent callback state BEFORE any outbound request", async () => {
    const cases = [
      { callbackState: "wrong-".repeat(6) },
      { callbackState: "" },
      { oauthStateCookie: `${randomBytes(32).toString("base64url")}.${encodeURIComponent(returnTo)}` },
      { oauthStateCookie: `${validState}.${encodeURIComponent(`/dashboard?historical_user_export=${randomUUID()}`)}` },
      { oauthStateCookie: `${validState}.${encodeURIComponent("//attacker.example")}` },
      { authorizationCode: "" },
      { authorizationCode: "bad code\n" },
      { authorizationCode: "A".repeat(513) },
      { sessionCookie: "forged" },
      { sessionCookie: sessionFor(identityId, new Date(now.getTime() - 6 * 60_000)) },
      { exportId: "not-a-uuid" },
      { environment: { ...environment, SESSION_SECRET: "invalid" } },
      { environment: { ...environment, BOARDREADYOPS_PUBLIC_URL: "http://boardreadyops.example/" } },
      { environment: { ...environment, BOARDREADYOPS_PUBLIC_URL: "https://user:secret@boardreadyops.example/" } },
      { environment: { ...environment, BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/path" } },
      { environment: { ...environment, BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/?next=callback" } },
      { environment: { ...environment, BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/#fragment" } },
      { environment: { ...environment, BOARDREADYOPS_PUBLIC_URL: "not-a-url" } },
      { environment: { ...environment, GITHUB_CLIENT_SECRET: "" } },
    ];
    for (const patch of cases) {
      const fetch = liveFetch();
      expect(await freshLiveGitHubOriginalUserAuthority(proof(fetch, patch))).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("rejects an OAuth provider response delivered after the signed original-user session becomes stale", async () => {
    let clockMs = 1_794_015_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => clockMs);
    try {
      const fetcher = liveFetch();
      const delayedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const response = await fetcher(url, init);
        if (String(url).startsWith("https://api.github.com/user/installations?")) clockMs += 6 * 60_000;
        return response;
      }) as typeof fetch;
      expect(await freshLiveGitHubOriginalUserAuthority(proof(delayedFetch))).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects an OAuth response if the server clock rolls backward during provider IO", async () => {
    let clockMs = 1_794_015_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => clockMs);
    try {
      const fetcher = liveFetch();
      const rollbackFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const response = await fetcher(url, init);
        if (String(url).startsWith("https://api.github.com/user/installations?")) clockMs -= 1;
        return response;
      }) as typeof fetch;
      expect(await freshLiveGitHubOriginalUserAuthority(proof(rollbackFetch))).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });

  it("denies GitHub authorization-code exchange, /user auth failure and network errors", async () => {
    for (const failure of ["exchange", "viewer", "network"] as const) {
      expect(await freshLiveGitHubOriginalUserAuthority(proof(liveFetch(identityId, failure)))).toBeNull();
    }
  });

  it("never accesses the DB or returns staged bytes if live identity proof fails", async () => {
    const db = {
      query: () => {
        throw new Error("DB must not be reached");
      },
      withTransaction: () => {
        throw new Error("DB must not be reached");
      },
    };
    const result = await stageLiveGitHubVerifiedHistoricalPrivatePreflight(proof(liveFetch(identityId + 1)), {
      db: db as never,
      archiveBytes: Buffer.from("malformed partial ZIP"),
      ttlSeconds: 60,
    });
    expect(result).toBeNull();
  });
});
