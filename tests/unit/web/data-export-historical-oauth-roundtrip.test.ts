import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => vi.fn());
const lookup = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const executor = vi.hoisted(() => vi.fn());
const registerNonce = vi.hoisted(() => vi.fn());
const consumeNonce = vi.hoisted(() => vi.fn());
vi.mock("../../../packages/db/src/data-export-historical-oauth-challenges.js", () => ({
  registerHistoricalUserOAuthChallenge: registerNonce,
  consumeHistoricalUserOAuthChallenge: consumeNonce,
}));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({
  optionalCloudPersistenceConfiguration: config,
}));
vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: executor,
}));
vi.mock("@boardreadyops/db", () => ({
  DataLifecycleStore: class {
    getVerifiedHistoricalUserExport(input: unknown) {
      return lookup(input);
    }
  },
}));

import { GET as sharedCallback } from "../../../apps/web/app/api/auth/github/callback/route.js";
import { GET as historicalStartRoute } from "../../../apps/web/app/api/auth/github/historical-step-up/route.js";
import {
  consumeHistoricalStepUp,
  historicalStepUpStateCookieName,
  serverCookie,
  shouldConsumeHistoricalStepUp,
  startHistoricalStepUp,
} from "../../../apps/web/lib/data-export-historical-oauth-roundtrip.js";
import { encodeUserSession } from "../../../apps/web/lib/user-session.js";

const exportId = randomUUID();
const newExportId = randomUUID();
const secret = "s".repeat(50);
const userId = 9_235_789_401;
const now = new Date("2026-11-06T03:00:00Z");
const environment = {
  SESSION_SECRET: secret,
  GITHUB_CLIENT_ID: "Iv1.test-client",
  GITHUB_CLIENT_SECRET: "test-only-client-secret",
  BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/",
  BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP: "true",
};
const startUrl = `https://boardreadyops.example/api/auth/github/historical-step-up?exportId=${exportId}`;
const callbackUrl = "https://boardreadyops.example/api/auth/github/callback";

function cookie(user = userId, ageMs = 60_000, reference = now) {
  const issuedAt = new Date(reference.getTime() - ageMs);
  return encodeUserSession(
    {
      userId: user,
      login: "recycled-login",
      installationIds: [],
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60_000).toISOString(),
    },
    secret,
  );
}

function network(liveId = userId, failure?: "code" | "identity" | "network") {
  return vi.fn(async (input: Request | URL | string) => {
    if (failure === "network") throw new Error("GitHub network unavailable");
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token")
      return new Response(
        JSON.stringify(
          failure === "code" ? { error: "bad_verification_code" } : { access_token: "ephemeral-test-token" },
        ),
      );
    if (url === "https://api.github.com/user")
      return new Response(JSON.stringify({ id: liveId, login: "recycled-login" }), {
        status: failure === "identity" ? 401 : 200,
      });
    if (url.startsWith("https://api.github.com/user/installations?"))
      return new Response(JSON.stringify({ installations: [] }));
    throw new Error("Unexpected GitHub URL");
  }) as typeof fetch & ReturnType<typeof vi.fn>;
}

async function begin(age = 60_000, reference = now) {
  const response = await startHistoricalStepUp(
    new Request(startUrl, {
      headers: { cookie: `brops_session=${cookie(userId, age, reference)}` },
    }),
    environment,
    reference,
  );
  const cookieLine = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  const state = new URL(response.headers.get("location") ?? "https://example.invalid/").searchParams.get("state");
  return { response, cookieLine, state };
}
function callbackRequest(state: string | null, specialCookie: string, session = cookie()) {
  const url = new URL(callbackUrl);
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("code", "one-use-valid-test-code");
  return new Request(url, {
    headers: { cookie: `brops_session=${session}; ${specialCookie}` },
  });
}

describe("historical GitHub USER step-up OAuth browser round-trip (no customer delivery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerNonce.mockResolvedValue(true);
    consumeNonce.mockResolvedValue(true);
    lookup.mockResolvedValue({ id: exportId, status: "pending", expiresAt: null });
    config.mockReturnValue({ mode: "postgres", databaseUrl: "postgresql://fixture-only" });
    executor.mockImplementation(() => ({ close: close.mockResolvedValue(undefined) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("mints an export-bound __Host HttpOnly state then consumes it after exact GitHub /user recheck", async () => {
    const { response, cookieLine, state } = await begin();
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("; HttpOnly; Secure; SameSite=Lax; Max-Age=300");
    expect(cookieLine).toContain(`${historicalStepUpStateCookieName}=`);
    const authorize = new URL(response.headers.get("location") ?? "");
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(callbackUrl);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(cookieLine).toContain(encodeURIComponent(`/dashboard?historical_user_export=${exportId}`));

    const fetcher = network();
    const cb = await consumeHistoricalStepUp(callbackRequest(state, cookieLine), environment, { fetch: fetcher }, now);
    expect(cb.status).toBe(303);
    expect(cb.headers.get("location")).toBe(`/dashboard?historical_user_export=${exportId}`);
    expect(cb.headers.getSetCookie()).toEqual([
      `${historicalStepUpStateCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      "__Host-brops_historical_stepup_proof=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ]);
    expect(cb.headers.get("set-cookie")).not.toContain("brops_session");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(lookup).toHaveBeenCalledWith({ exportId, verifiedGitHubUserId: userId });
    expect(registerNonce).toHaveBeenCalledOnce();
    expect(registerNonce.mock.calls[0]?.[1]).toEqual({
      exportId,
      verifiedGitHubUserId: userId,
      state,
    });
    expect(consumeNonce).toHaveBeenCalledOnce();
    expect(consumeNonce.mock.calls[0]?.[1]).toEqual({
      exportId,
      verifiedGitHubUserId: userId,
      state,
    });
    expect(close).toHaveBeenCalledTimes(4);
  });

  it("rejects wrong, missing, cross-export or ordinary login state without contacting GitHub", async () => {
    const { cookieLine, state } = await begin();
    const foreign = cookieLine.replace(exportId, newExportId);
    for (const request of [
      callbackRequest(randomBytes(32).toString("base64url"), cookieLine),
      callbackRequest(null, cookieLine),
      callbackRequest(state, foreign),
    ]) {
      const fetcher = network();
      const response = await consumeHistoricalStepUp(request, environment, { fetch: fetcher }, now);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(fetcher).not.toHaveBeenCalled();
    }
    expect(shouldConsumeHistoricalStepUp(callbackRequest(state, cookieLine), undefined)).toBe(true);
    const regular = randomBytes(32).toString("base64url");
    const normal = `${regular}.${encodeURIComponent("/dashboard")}`;
    expect(shouldConsumeHistoricalStepUp(callbackRequest(regular, cookieLine), normal)).toBe(false);
    expect(shouldConsumeHistoricalStepUp(callbackRequest(state, cookieLine), normal)).toBe(true);
  });

  it("requires durable nonce registration before OAuth redirect, failing closed if DB cannot store it", async () => {
    registerNonce.mockResolvedValueOnce(false);
    const failed = await begin();
    expect(failed.response.status).toBe(503);
    expect(failed.response.headers.get("location")).toBeNull();
    expect(failed.response.headers.getSetCookie()).toHaveLength(0);
    expect(consumeNonce).not.toHaveBeenCalled();
  });

  it("consumes DB nonce BEFORE GitHub, prevents replay or cross-worker concurrent callbacks", async () => {
    const { state, cookieLine } = await begin();
    consumeNonce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const first = network();
    const successful = await consumeHistoricalStepUp(
      callbackRequest(state, cookieLine),
      environment,
      { fetch: first },
      now,
    );
    expect(successful.headers.get("location")).toBe(`/dashboard?historical_user_export=${exportId}`);
    expect(first).toHaveBeenCalledTimes(3);
    const second = network();
    const replay = await consumeHistoricalStepUp(
      callbackRequest(state, cookieLine),
      environment,
      { fetch: second },
      now,
    );
    expect(replay.headers.get("location")).toBe("/dashboard");
    expect(replay.headers.getSetCookie()).toHaveLength(2);
    expect(second).not.toHaveBeenCalled();
    expect(consumeNonce).toHaveBeenCalledTimes(2);
  });

  it("burns a nonce before a failed provider exchange, without restoring authority", async () => {
    const { state, cookieLine } = await begin();
    consumeNonce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const first = network(userId, "network");
    expect(
      (
        await consumeHistoricalStepUp(callbackRequest(state, cookieLine), environment, { fetch: first }, now)
      ).headers.get("location"),
    ).toBe("/dashboard");
    const second = network();
    expect(
      (
        await consumeHistoricalStepUp(callbackRequest(state, cookieLine), environment, { fetch: second }, now)
      ).headers.get("location"),
    ).toBe("/dashboard");
    expect(second).not.toHaveBeenCalled();
    expect(consumeNonce).toHaveBeenCalledTimes(2);
  });

  it("HMAC-bound challenge rejects edited expiry, nonce, export or original numeric USER before GitHub", async () => {
    const { cookieLine, state } = await begin();
    const editedExport = cookieLine.replace(exportId, newExportId);
    const changedChallenge = cookieLine.replace(/(__Host-brops_historical_stepup_proof=)[^.]/u, "$1Z");
    const older = await begin(60_000, new Date(now.getTime() - 6 * 60_000));
    for (const special of [editedExport, changedChallenge, older.cookieLine]) {
      const fetcher = network();
      const response = await consumeHistoricalStepUp(
        callbackRequest(special === older.cookieLine ? older.state : state, special),
        environment,
        { fetch: fetcher },
        now,
      );
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(response.headers.getSetCookie()).toHaveLength(2);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("denies wrong GitHub numeric USER, old session, failed provider and revoked export; clears cookie", async () => {
    const { cookieLine, state } = await begin();
    for (const user of [userId + 1]) {
      const response = await consumeHistoricalStepUp(
        callbackRequest(state, cookieLine),
        environment,
        { fetch: network(user) },
        now,
      );
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
    for (const failure of ["code", "identity", "network"] as const) {
      const response = await consumeHistoricalStepUp(
        callbackRequest(state, cookieLine),
        environment,
        { fetch: network(userId, failure) },
        now,
      );
      expect(response.headers.get("location")).toBe("/dashboard");
    }
    expect(
      (
        await consumeHistoricalStepUp(
          callbackRequest(state, cookieLine, cookie(userId, 6 * 60_000)),
          environment,
          { fetch: network() },
          now,
        )
      ).headers.get("location"),
    ).toBe("/dashboard");
    lookup.mockResolvedValueOnce({ id: exportId, status: "failed", expiresAt: null });
    expect(
      (
        await consumeHistoricalStepUp(callbackRequest(state, cookieLine), environment, { fetch: network() }, now)
      ).headers.get("location"),
    ).toBe("/dashboard");
  });

  it("rejects unauthorized/malformed/cross-site start before GitHub redirect or DB lookup", async () => {
    for (const request of [
      new Request(startUrl, { headers: { "sec-fetch-site": "cross-site", cookie: `brops_session=${cookie()}` } }),
      new Request(startUrl, { headers: { origin: "https://attacker.example", cookie: `brops_session=${cookie()}` } }),
      new Request(`${startUrl}&exportId=${newExportId}`, { headers: { cookie: `brops_session=${cookie()}` } }),
      new Request(startUrl.replace(exportId, "../escape"), { headers: { cookie: `brops_session=${cookie()}` } }),
      new Request(startUrl, { headers: { cookie: "brops_session=forged" } }),
      new Request(startUrl, { headers: { cookie: `brops_session=${cookie(userId, 6 * 60_000)}` } }),
    ]) {
      const response = await startHistoricalStepUp(request, environment, now);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("does not start an OAuth proof for a wrong, expired, failed or unavailable original-user export", async () => {
    for (const status of [
      { id: exportId, status: "failed", expiresAt: null },
      { id: exportId, status: "pending", expiresAt: "2026-11-06T02:00:00Z" },
      null,
    ]) {
      lookup.mockResolvedValueOnce(status);
      const response = await begin();
      expect(response.response.status).toBe(404);
    }
    config.mockReturnValueOnce(undefined);
    expect((await begin()).response.status).toBe(404);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("routes a matched historical callback through the existing shared GitHub URI without minting ordinary sign-in", async () => {
    const { cookieLine, state } = await begin(60_000, new Date());
    vi.stubEnv("SESSION_SECRET", secret);
    vi.stubEnv("GITHUB_CLIENT_ID", environment.GITHUB_CLIENT_ID);
    vi.stubEnv("GITHUB_CLIENT_SECRET", environment.GITHUB_CLIENT_SECRET);
    vi.stubEnv("BOARDREADYOPS_PUBLIC_URL", environment.BOARDREADYOPS_PUBLIC_URL);
    vi.stubEnv("BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP", "true");
    vi.stubGlobal("fetch", network());
    // The real route's clock is current, so mint a fresh real-time session.
    const actual = new Date();
    const session = encodeUserSession(
      {
        userId,
        login: "recycled-login",
        installationIds: [],
        issuedAt: new Date(actual.getTime() - 500).toISOString(),
        expiresAt: new Date(actual.getTime() + 8 * 60 * 60_000 - 500).toISOString(),
      },
      secret,
    );
    const response = await sharedCallback(callbackRequest(state, cookieLine, session));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/dashboard?historical_user_export=${exportId}`);
    expect(response.headers.get("set-cookie")).not.toContain("brops_session");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("exercises the actual Next.js historical-start route with an opt-in flag and a fresh signed session", async () => {
    const reference = new Date();
    const session = cookie(userId, 500, reference);
    vi.stubEnv("SESSION_SECRET", secret);
    vi.stubEnv("GITHUB_CLIENT_ID", environment.GITHUB_CLIENT_ID);
    vi.stubEnv("GITHUB_CLIENT_SECRET", environment.GITHUB_CLIENT_SECRET);
    vi.stubEnv("BOARDREADYOPS_PUBLIC_URL", environment.BOARDREADYOPS_PUBLIC_URL);
    vi.stubEnv("BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP", "true");
    const response = await historicalStartRoute(
      new Request(startUrl, { headers: { cookie: `brops_session=${session}` } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("github.com/login/oauth/authorize");
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie().every((line) => line.includes("HttpOnly; Secure"))).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(lookup).toHaveBeenCalledWith({ exportId, verifiedGitHubUserId: userId });
  });

  it("does not confuse ordinary GitHub login state with the separate historical cookie", () => {
    const session = cookie();
    const regular = randomBytes(32).toString("base64url");
    const oldState = "abc.def";
    const request = new Request(`${callbackUrl}?state=${regular}&code=real-code`, {
      headers: { cookie: `brops_session=${session}; ${historicalStepUpStateCookieName}=${oldState}` },
    });
    expect(shouldConsumeHistoricalStepUp(request, `${regular}.${encodeURIComponent("/dashboard")}`)).toBe(false);
  });

  it("keeps live OAuth start disabled by default and clears state on disabled callback", async () => {
    const disabled = { ...environment, BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP: "false" };
    const start = await startHistoricalStepUp(
      new Request(startUrl, { headers: { cookie: `brops_session=${cookie()}` } }),
      disabled,
      now,
    );
    expect(start.status).toBe(404);
    expect(start.headers.get("set-cookie")).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    const original = await begin();
    const fetcher = network();
    const callback = await consumeHistoricalStepUp(
      callbackRequest(original.state, original.cookieLine),
      disabled,
      { fetch: fetcher },
      now,
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/dashboard");
    expect(callback.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never reads a historical state from URL or body in place of HttpOnly cookies", () => {
    const request = new Request(`${callbackUrl}?state=forged&code=token`);
    expect(serverCookie(request, historicalStepUpStateCookieName)).toBeUndefined();
    expect(shouldConsumeHistoricalStepUp(request, undefined)).toBe(false);
  });
});
