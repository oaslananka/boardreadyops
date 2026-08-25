import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserSession } from "./user-session.js";

/**
 * Single-purpose CSRF token for settings forms.
 *
 * These forms write a third-party credential. Without a token, a page under an attacker's
 * control could make a signed-in browser POST a credential the attacker owns: the victim's
 * component lookups would then run under the attacker's provider account, and the victim's
 * BOM contents would be visible in that account's query history.
 *
 * The token binds the session, the installation and the purpose together, so a token minted
 * for one installation's form cannot be replayed against another's, and a token from a
 * different form cannot be reused here.
 */

const tokenPurpose = "settings.component-intelligence";
/** Long enough to fill in a form, short enough that a leaked page does not stay usable. */
const tokenLifetimeMs = 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function payloadFor(session: UserSession, installationId: string, expiresAt: number): string {
  // The session's issuedAt is included so signing out and back in invalidates outstanding
  // tokens along with the session they were minted for.
  return [tokenPurpose, String(session.userId), session.issuedAt, installationId, String(expiresAt)].join(":");
}

export function issueSettingsFormToken(
  session: UserSession,
  installationId: string,
  secret: string,
  now: Date,
): string {
  const expiresAt = now.getTime() + tokenLifetimeMs;
  return `${expiresAt}.${sign(payloadFor(session, installationId, expiresAt), secret)}`;
}

/**
 * Verifies a token for exactly this session, installation and purpose.
 *
 * Returns false for anything malformed, expired, or signed for different inputs. There is no
 * distinguishing error: a caller cannot use the failure mode to learn which part was wrong.
 */
export function settingsFormTokenValid(
  token: string | null | undefined,
  session: UserSession,
  installationId: string,
  secret: string,
  now: Date,
): boolean {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) return false;

  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return false;
  const expiresAt = Number.parseInt(token.slice(0, separator), 10);
  const presented = token.slice(separator + 1);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now.getTime()) return false;

  const expected = Buffer.from(sign(payloadFor(session, installationId, expiresAt), secret), "utf8");
  const supplied = Buffer.from(presented, "utf8");
  // Length is compared first because timingSafeEqual throws on a mismatch, and the throw would
  // itself leak that the lengths differed.
  return expected.byteLength === supplied.byteLength && timingSafeEqual(expected, supplied);
}
