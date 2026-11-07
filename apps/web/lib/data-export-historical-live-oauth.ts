import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { stageVerifiedHistoricalUserPrivateArchivePreflight } from "./data-export-historical-private-preflight.js";
import { recentSignedHistoricalUserAuthority } from "./data-export-historical-signed-session.js";
import { configuredGitHubOAuth, resolveGitHubUserIdentity } from "./github-user-access.js";
import { parseOAuthStateCookie, stateMatches } from "./oauth-state.js";

const authorizationCodePattern = /^[A-Za-z0-9_-]{1,512}$/u;
const statePattern = /^[A-Za-z0-9_-]{24,256}$/u;
const expectedReturnPath = (exportId: string) => `/dashboard?historical_user_export=${exportId}`;

type LiveProofInput = {
  exportId: string;
  /** These two cookies must come from the authenticated server-side request, never JSON. */
  sessionCookie: string;
  oauthStateCookie: string;
  callbackState: string;
  authorizationCode: string;
  environment: Readonly<Record<string, string | undefined>>;
  now?: Date;
  fetch: typeof fetch;
};

/** Validate CSRF state and the bound export redirect before network access. */
function verifiedCallbackState(input: LiveProofInput, exportId: string): boolean {
  if (
    typeof input.oauthStateCookie !== "string" ||
    typeof input.callbackState !== "string" ||
    !statePattern.test(input.callbackState) ||
    typeof input.authorizationCode !== "string" ||
    !authorizationCodePattern.test(input.authorizationCode) ||
    typeof input.fetch !== "function"
  )
    return false;

  const state = parseOAuthStateCookie(input.oauthStateCookie);
  return (
    state != null &&
    statePattern.test(state.state) &&
    stateMatches(state.state, input.callbackState) &&
    state.returnTo === expectedReturnPath(exportId)
  );
}

/** Only the exact HTTPS application origin may be an OAuth callback base. */
function verifiedGitHubCallbackUrl(environment: LiveProofInput["environment"]): string | null {
  const publicUrl = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (typeof publicUrl !== "string") return null;
  try {
    const origin = new URL(publicUrl);
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

/**
 * INTERNAL only: a one-time OAuth CODE proves a GitHub /user identity NOW.
 * The signed existing session and the callback CSRF state must match, and
 * the state's safe return path is bound to THIS original-user export ID.
 * GitHub tokens and OAuth codes are never returned or persisted.
 *
 * A separate feature-flagged browser round-trip now calls this helper
 * through the existing GitHub callback and clears both temporary cookies.
 * It never stages a ZIP in the callback and is not a download endpoint.
 * This is authentication, NOT release, IP rights, or customer entitlement.
 */
export async function freshLiveGitHubOriginalUserAuthority(
  input: LiveProofInput,
): Promise<{ exportId: string; verifiedGitHubUserId: number } | null> {
  // The signed session must still be fresh AFTER the awaited provider call.
  // Pin the request-bound identity and clock before any network IO; a caller
  // mutating the input object cannot replace the cookie midway through OAuth.
  const startedAtMs = Date.now();
  const initialNowMs = input.now?.getTime() ?? startedAtMs;
  if (!Number.isSafeInteger(startedAtMs) || !Number.isSafeInteger(initialNowMs)) return null;
  const session = {
    exportId: input.exportId,
    sessionCookie: input.sessionCookie,
    environment: input.environment,
  };
  const signed = recentSignedHistoricalUserAuthority({ ...session, now: new Date(initialNowMs) });
  if (!signed || !verifiedCallbackState(input, signed.exportId)) return null;

  const configuration = configuredGitHubOAuth(input.environment);
  const callbackUrl = verifiedGitHubCallbackUrl(input.environment);
  if (!configuration || !callbackUrl) return null;

  try {
    const identity = await resolveGitHubUserIdentity(configuration, input.authorizationCode, callbackUrl, {
      fetch: input.fetch,
    });
    const finishedAtMs = Date.now();
    if (!Number.isSafeInteger(finishedAtMs) || finishedAtMs < startedAtMs) return null;
    const elapsedMs = finishedAtMs - startedAtMs;
    const current = recentSignedHistoricalUserAuthority({
      ...session,
      now: new Date(initialNowMs + elapsedMs),
    });
    return identity?.userId === signed.verifiedGitHubUserId &&
      current?.verifiedGitHubUserId === signed.verifiedGitHubUserId &&
      current.exportId === signed.exportId
      ? signed
      : null;
  } catch {
    // GitHub availability, code exchange, identity or transport failure
    // may NEVER turn stale browser-session claims into trusted authority.
    return null;
  }
}

/**
 * No partial archive is staged unless the one-time GitHub identity proof
 * succeeded AND the existing locked original-user DB/ZIP/retention gates
 * succeed. This remains private and permanently customer-delivery denied.
 */
export async function stageLiveGitHubVerifiedHistoricalPrivatePreflight(
  proof: LiveProofInput,
  input: {
    db: PgQueryExecutor;
    archiveBytes: Buffer;
    ttlSeconds: number;
  },
): Promise<{ id: string } | null> {
  // OAuth credentials remain in a distinct trust class from archive bytes.
  const authority = await freshLiveGitHubOriginalUserAuthority(proof);
  if (!authority) return null;
  return stageVerifiedHistoricalUserPrivateArchivePreflight({
    db: input.db,
    authority,
    archiveBytes: input.archiveBytes,
    ttlSeconds: input.ttlSeconds,
  });
}
