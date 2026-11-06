import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  consumeHistoricalUserOAuthChallenge,
  registerHistoricalUserOAuthChallenge,
} from "../../../packages/db/src/data-export-historical-oauth-challenges.js";
import { optionalCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import { freshLiveGitHubOriginalUserAuthority } from "./data-export-historical-live-oauth.js";
import { recentSignedHistoricalUserAuthority } from "./data-export-historical-signed-session.js";
import { configuredGitHubOAuth, githubAuthorizeUrl } from "./github-user-access.js";
import { parseOAuthStateCookie, stateMatches } from "./oauth-state.js";
import { configuredSessionSecret } from "./user-session.js";
import { sessionCookieName } from "./viewer-authorization.js";

export const historicalStepUpStateCookieName = "__Host-brops_historical_stepup_state";
const historicalStepUpProofCookieName = "__Host-brops_historical_stepup_proof";
const challengeLifetimeMs = 5 * 60_000;
const maximumClockSkewMs = 30_000;
const domainSeparator = "boardreadyops-historical-oauth-challenge-v1";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const validState = /^[A-Za-z0-9_-]{24,256}$/u;
const safeResponseHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

const clearState = `${historicalStepUpStateCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const clearProof = `${historicalStepUpProofCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

type Challenge = { exportId: string; userId: number; state: string; issuedAtMs: number };

function challengeSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(domainSeparator).update("\0").update(payload).digest("base64url");
}

function mintChallenge(value: Challenge, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${challengeSignature(payload, secret)}`;
}

/** Server-bound nonce/owner/export and a five-minute age limit, even if
 * browser Max-Age is bypassed using a manually replayed Cookie header.
 * A separate persisted digest and conditional DB consume enforce global
 * one-use semantics; GitHub additionally consumes the OAuth code.
 */
function validChallenge(value: string | undefined, secret: string, now: Date): Challenge | null {
  if (!value || value.length > 1024 || !Number.isFinite(now.getTime())) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = Buffer.from(challengeSignature(payload, secret), "utf8");
  const supplied = Buffer.from(signature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const challenge = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Challenge;
    if (
      !challenge ||
      !uuid.test(challenge.exportId) ||
      !validState.test(challenge.state) ||
      !Number.isSafeInteger(challenge.userId) ||
      challenge.userId <= 0 ||
      !Number.isSafeInteger(challenge.issuedAtMs) ||
      now.getTime() - challenge.issuedAtMs > challengeLifetimeMs ||
      challenge.issuedAtMs - now.getTime() > maximumClockSkewMs
    )
      return null;
    return challenge;
  } catch {
    return null;
  }
}

/** Only the server-side Cookie header is trusted. There is no body/query
 * parameter that can substitute for signed GitHub session cookies. */
export function serverCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 16384) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** Only a static registered callback under the configured HTTPS origin. */
function trustedCallbackOrigin(environment: Readonly<Record<string, string | undefined>>): string | null {
  const configured = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    const origin = new URL(configured);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    )
      return null;
    return new URL("/api/auth/github/callback", origin).toString();
  } catch {
    return null;
  }
}

/** This read-only check is not a customer entitlement. It avoids sending
 * unrelated users through OAuth for an unknown or expired export. */
async function currentOwnerExport(exportId: string, userId: number, now: Date): Promise<boolean> {
  const configuration = optionalCloudPersistenceConfiguration();
  if (configuration?.mode !== "postgres") return false;
  const db = createPgQueryExecutor({ connectionString: configuration.databaseUrl });
  try {
    const exportStatus = await new DataLifecycleStore(db).getVerifiedHistoricalUserExport({
      exportId,
      verifiedGitHubUserId: userId,
    });
    return (
      exportStatus?.id === exportId &&
      exportStatus.status === "pending" &&
      (exportStatus.expiresAt === null || Date.parse(exportStatus.expiresAt) > now.getTime())
    );
  } catch {
    return false;
  } finally {
    await db.close();
  }
}

/** Server-side durable, original-USER-scoped nonce record/atomic consume.
 * Database errors fail closed. Only a state SHA digest is persisted.
 * The feature is default OFF until migration 0122 and acceptance exist.
 */
async function persistHistoricalOAuthNonce(input: {
  exportId: string;
  verifiedGitHubUserId: number;
  state: string;
  operation: "register" | "consume";
}): Promise<boolean> {
  const config = optionalCloudPersistenceConfiguration();
  if (config?.mode !== "postgres") return false;
  const db = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const nonce = {
      exportId: input.exportId,
      verifiedGitHubUserId: input.verifiedGitHubUserId,
      state: input.state,
    };
    return input.operation === "register"
      ? await registerHistoricalUserOAuthChallenge(db, nonce)
      : await consumeHistoricalUserOAuthChallenge(db, nonce);
  } catch {
    return false;
  } finally {
    await db.close();
  }
}

function denied(status: number): Response {
  return Response.json(
    { ok: false, error: "historical identity verification unavailable" },
    {
      status,
      headers: safeResponseHeaders,
    },
  );
}

/**
 * An authenticated browser starts a DIFFERENT OAuth state from ordinary
 * sign-in. The same existing GitHub callback URI is used, so no alternate
 * OAuth App / redirect configuration is required. No archive is prepared.
 */
export async function startHistoricalStepUp(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): Promise<Response> {
  if (environment.BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP !== "true") return denied(404);
  const url = new URL(request.url);
  if (
    url.searchParams.size !== 1 ||
    url.searchParams.getAll("exportId").length !== 1 ||
    (request.headers.get("origin") && request.headers.get("origin") !== url.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return denied(400);
  const exportId = url.searchParams.get("exportId");
  if (!exportId || !uuid.test(exportId)) return denied(404);

  const authority = recentSignedHistoricalUserAuthority({
    exportId,
    sessionCookie: serverCookie(request, sessionCookieName) ?? "",
    environment,
    now,
  });
  if (!authority) return denied(401);
  const configuration = configuredGitHubOAuth(environment);
  const redirectUri = trustedCallbackOrigin(environment);
  if (!configuration || !redirectUri) return denied(503);
  if (!(await currentOwnerExport(exportId, authority.verifiedGitHubUserId, now))) return denied(404);

  const secret = configuredSessionSecret(environment);
  if (!secret) return denied(503);
  const state = randomBytes(32).toString("base64url");
  const challenge = mintChallenge(
    {
      exportId,
      userId: authority.verifiedGitHubUserId,
      state,
      issuedAtMs: now.getTime(),
    },
    secret,
  );
  const returnPath = `/dashboard?historical_user_export=${exportId}`;
  // An OAuth redirect is forbidden unless the DB accepted this hashed
  // nonce under exact original numeric USER ownership. A failure leaves
  // no customer capability and no browser state cookie behind.
  if (
    !(await persistHistoricalOAuthNonce({
      exportId,
      verifiedGitHubUserId: authority.verifiedGitHubUserId,
      state,
      operation: "register",
    }))
  )
    return denied(503);
  const location = githubAuthorizeUrl(configuration, redirectUri, state);
  return new Response(null, {
    status: 302,
    headers: new Headers([
      ["location", location],
      [
        "set-cookie",
        historicalStepUpStateCookieName +
          "=" +
          state +
          "." +
          encodeURIComponent(returnPath) +
          "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300",
      ],
      [
        "set-cookie",
        `${historicalStepUpProofCookieName}=${challenge}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
      ],
      ...Object.entries(safeResponseHeaders),
    ]),
  });
}

function consumed(allowedExportId: string | null): Response {
  // Do not issue or refresh the ordinary GitHub login session. Nothing here
  // grants a ZIP, capability, persisted live-identity attestation or rights.
  const destination = allowedExportId ? `/dashboard?historical_user_export=${allowedExportId}` : "/dashboard";
  return new Response(null, {
    status: 303,
    headers: new Headers([
      ["location", destination],
      ["set-cookie", clearState],
      ["set-cookie", clearProof],
      ...Object.entries(safeResponseHeaders),
    ]),
  });
}

type VerifiedHistoricalCallback = {
  readonly exportId: string;
  readonly stateCookie: string | undefined;
  readonly callbackState: string;
  readonly authorizationCode: string;
  readonly challenge: Challenge;
};

/** Only a matching, signed, export-bound and unambiguous callback may enter the DB consume gate. */
function verifiedHistoricalCallback(
  request: Request,
  environment: Readonly<Record<string, string | undefined>>,
  now: Date,
): VerifiedHistoricalCallback | null {
  const stateCookie = serverCookie(request, historicalStepUpStateCookieName);
  const secret = configuredSessionSecret(environment);
  const challenge = secret ? validChallenge(serverCookie(request, historicalStepUpProofCookieName), secret, now) : null;
  const state = parseOAuthStateCookie(stateCookie);
  const parameters = new URL(request.url).searchParams;
  const callbackState = parameters.get("state");
  if (
    !state ||
    !validState.test(state.state) ||
    !stateMatches(state.state, callbackState) ||
    !challenge ||
    challenge.state !== state.state ||
    parameters.getAll("code").length !== 1 ||
    parameters.getAll("state").length !== 1 ||
    parameters.has("error")
  )
    return null;
  try {
    const target = new URL(state.returnTo, "https://boardreadyops.invalid");
    const exportId = target.searchParams.get("historical_user_export");
    if (
      target.origin !== "https://boardreadyops.invalid" ||
      target.pathname !== "/dashboard" ||
      target.searchParams.size !== 1 ||
      !exportId ||
      !uuid.test(exportId) ||
      challenge.exportId !== exportId
    )
      return null;
    return {
      exportId,
      stateCookie,
      callbackState: callbackState ?? "",
      authorizationCode: parameters.get("code") ?? "",
      challenge,
    };
  } catch {
    return null;
  }
}

/**
 * Browser callback branch: STATE cookie is always cleared, including
 * invalid/missing code, wrong account, revoked export or GitHub downtime.
 * The database atomically consumes the nonce BEFORE calling GitHub.
 * Clearing browser cookies is independent defense-in-depth. This remains
 * no customer delivery token, ZIP or downloadable archive.
 */
export async function consumeHistoricalStepUp(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { fetch: typeof fetch } | undefined = undefined,
  now = new Date(),
): Promise<Response> {
  // A disabled callback must consume stale state without contacting GitHub.
  if (environment.BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP !== "true") return consumed(null);
  const callback = verifiedHistoricalCallback(request, environment, now);
  if (!callback) return consumed(null);
  const { exportId, challenge } = callback;

  const signed = recentSignedHistoricalUserAuthority({
    exportId,
    sessionCookie: serverCookie(request, sessionCookieName) ?? "",
    environment,
    now,
  });
  if (signed?.verifiedGitHubUserId !== challenge.userId) return consumed(null);
  // Consume-before-provider: any error, invalid authorization code or
  // concurrent replay burns this nonce. No second GitHub call can use it.
  if (
    !(await persistHistoricalOAuthNonce({
      exportId,
      verifiedGitHubUserId: challenge.userId,
      state: challenge.state,
      operation: "consume",
    }))
  )
    return consumed(null);
  const authority = await freshLiveGitHubOriginalUserAuthority({
    exportId,
    sessionCookie: serverCookie(request, sessionCookieName) ?? "",
    oauthStateCookie: callback.stateCookie ?? "",
    callbackState: callback.callbackState,
    authorizationCode: callback.authorizationCode,
    environment,
    now,
    fetch: dependencies === undefined ? fetch : dependencies.fetch,
  });
  if (!authority) return consumed(null);
  if (!(await currentOwnerExport(exportId, authority.verifiedGitHubUserId, now))) return consumed(null);
  return consumed(exportId);
}

/** The normal sign-in callback keeps its normal route if a valid NORMAL
 * state matches. A historical state is handled only when it matches the
 * dedicated cookie, or when there is no valid normal OAuth state.
 * This prevents historical step-up from silently replacing a user session.
 */
export function shouldConsumeHistoricalStepUp(request: Request, ordinaryStateCookie: string | undefined): boolean {
  const special = serverCookie(request, historicalStepUpStateCookieName);
  if (!special) return false;
  const presented = new URL(request.url).searchParams.get("state");
  const specialState = parseOAuthStateCookie(special);
  if (specialState && stateMatches(specialState.state, presented)) return true;
  const normalState = parseOAuthStateCookie(ordinaryStateCookie);
  return !normalState || !stateMatches(normalState.state, presented);
}
