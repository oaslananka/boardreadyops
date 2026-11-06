import { revokeHistoricalUserPrivateDeliveryPreflight } from "../../../packages/db/src/data-export-historical-private-preflight.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import {
  inspectVerifiedHistoricalUserPrivateArchivePreflight,
  stageVerifiedHistoricalUserPrivateArchivePreflight,
} from "./data-export-historical-private-preflight.js";
import { configuredSessionSecret, decodeUserSession } from "./user-session.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const freshSessionMs = 5 * 60 * 1000;
const maximumSessionMs = 8 * 60 * 60 * 1000;
const maximumClockSkewMs = 30 * 1000;

type SignedOriginalUserInput = {
  exportId: string;
  /** Must be the server-read HttpOnly OAuth session cookie, never a form field. */
  sessionCookie: string;
  environment: Readonly<Record<string, string | undefined>>;
  now?: Date;
};

/**
 * Internal, fail-closed proof that a recently authenticated GitHub OAuth
 * session signed by THIS server names a numeric USER, not a recycled login
 * or an installation ID. The session is NOT a fresh call to GitHub and
 * establishes neither legal disclosure rights nor a download capability.
 */
export function recentSignedHistoricalUserAuthority(
  input: SignedOriginalUserInput,
): { exportId: string; verifiedGitHubUserId: number } | null {
  if (!input || !uuid.test(input.exportId) || typeof input.sessionCookie !== "string") return null;
  const secret = configuredSessionSecret(input.environment ?? {});
  const now = input.now ?? new Date();
  if (!secret || !Number.isFinite(now.getTime())) return null;
  const session = decodeUserSession(input.sessionCookie, secret, now);
  if (!session) return null;
  const issuedAt = Date.parse(session.issuedAt);
  const expiresAt = Date.parse(session.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    now.getTime() - issuedAt > freshSessionMs ||
    issuedAt - now.getTime() > maximumClockSkewMs ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maximumSessionMs
  )
    return null;
  // Installation membership, session login, request query/body and tenant
  // spelling are NEVER a source of original historical USER authority.
  return { exportId: input.exportId, verifiedGitHubUserId: session.userId };
}

/** Private-only stage; the database still verifies current original-user
 * source/manifest/hold/erasure/retention. Never returns customer bytes. */
export async function stageSessionBoundHistoricalUserPrivatePreflight(
  session: SignedOriginalUserInput,
  input: {
    db: PgQueryExecutor;
    archiveBytes: Buffer;
    ttlSeconds: number;
  },
): Promise<{ id: string } | null> {
  // The signed credential is intentionally distinct from the bytes whose
  // SHA-256 proves archive integrity; never hash or persist a session cookie.
  const authority = recentSignedHistoricalUserAuthority(session);
  return authority
    ? stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: input.db,
        authority,
        archiveBytes: input.archiveBytes,
        ttlSeconds: input.ttlSeconds,
      })
    : null;
}

/** "current" means only a PRIVATE diagnostic receipt, never a release. */
export async function inspectSessionBoundHistoricalUserPrivatePreflight(
  session: SignedOriginalUserInput,
  input: {
    db: PgQueryExecutor;
    id: string;
    archiveBytes: Buffer;
  },
): Promise<"current" | "stale"> {
  const authority = recentSignedHistoricalUserAuthority(session);
  return authority
    ? inspectVerifiedHistoricalUserPrivateArchivePreflight({
        db: input.db,
        authority,
        id: input.id,
        archiveBytes: input.archiveBytes,
      })
    : "stale";
}

/** One-way private revocation also requires this recently signed user ID.
 * The DB update is independently scoped to the persisted original USER. */
export async function revokeSessionBoundHistoricalUserPrivatePreflight(
  input: SignedOriginalUserInput & { db: PgQueryExecutor; id: string },
): Promise<"revoked" | "stale"> {
  const authority = recentSignedHistoricalUserAuthority(input);
  return authority
    ? revokeHistoricalUserPrivateDeliveryPreflight({
        db: input.db,
        authority,
        id: input.id,
      })
    : "stale";
}
