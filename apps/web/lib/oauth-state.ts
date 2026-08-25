import { timingSafeEqual } from "node:crypto";

/**
 * CSRF state for the GitHub sign-in round trip.
 *
 * The cookie carries the minted state and the path to return to, so a forged callback cannot
 * complete a sign-in and cannot choose where the browser lands afterwards.
 */

export const oauthStateCookieName = "brops_oauth_state";

const maximumStateLength = 256;
const maximumReturnPathLength = 512;

/**
 * Constrains where sign-in may send the browser afterwards.
 *
 * Only a same-site absolute path is allowed. A full URL, a protocol-relative `//host` path, or
 * anything with a backslash is discarded in favour of the dashboard, so the sign-in link cannot
 * be used as an open redirect.
 *
 * The fallback is the dashboard rather than the landing page: somebody who has just signed in
 * wants to see their repositories, and returning them to the marketing page made sign-in look
 * like it had done nothing.
 */
/** Where a signed-in viewer belongs when nothing more specific was requested. */
export const signedInLandingPath = "/dashboard";

export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumReturnPathLength) {
    return signedInLandingPath;
  }
  if (!value.startsWith("/")) return signedInLandingPath;
  if (value.startsWith("//")) return signedInLandingPath;
  if (value.includes("\\")) return signedInLandingPath;
  if (value.includes("://")) return signedInLandingPath;
  return value;
}

export type OAuthStateCookie = { state: string; returnTo: string };

export function parseOAuthStateCookie(value: string | undefined): OAuthStateCookie | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(".");
  if (separator <= 0) return undefined;

  const state = value.slice(0, separator);
  if (state.length === 0 || state.length > maximumStateLength) return undefined;

  let returnTo: string;
  try {
    returnTo = decodeURIComponent(value.slice(separator + 1));
  } catch {
    return undefined;
  }
  return { state, returnTo: safeReturnPath(returnTo) };
}

/** Constant-time comparison so a mismatched state cannot be discovered by timing. */
export function stateMatches(expected: string, presented: string | null | undefined): boolean {
  if (typeof presented !== "string" || presented.length === 0 || presented.length > maximumStateLength) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
