import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed browser session for dashboard viewers.
 *
 * The session records who the viewer is and which GitHub App installations they were found to
 * have access to at sign-in. It is a signed cookie rather than a database row, and it holds no
 * GitHub credential: the user access token is used once during the OAuth callback to resolve
 * the installation list and is then discarded, which keeps the control plane from storing user
 * credentials at all.
 *
 * The trade-off is that access changes take until the session expires to apply, so the lifetime
 * is deliberately short and re-verified on renewal rather than being long-lived.
 */
export type UserSession = {
  userId: number;
  login: string;
  /** GitHub App installation ids this user could access when the session was issued. */
  installationIds: number[];
  issuedAt: string;
  expiresAt: string;
};

/** Long enough that an HMAC key is not the weak link; matches the operator token floor. */
const minimumSecretLength = 32;
const maximumTokenLength = 8192;
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;

export function configuredSessionSecret(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const secret = environment.SESSION_SECRET?.trim();
  return secret && secret.length >= minimumSecretLength ? secret : undefined;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeUserSession(session: UserSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function signatureMatches(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(payload, secret), "utf8");
  const presented = Buffer.from(signature, "utf8");
  // Length is compared first because timingSafeEqual throws on a mismatch, and a thrown
  // exception would itself leak that the lengths differed.
  return expected.byteLength === presented.byteLength && timingSafeEqual(expected, presented);
}

function parseSession(value: unknown): UserSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const installationIds = candidate.installationIds;
  if (
    typeof candidate.userId !== "number" ||
    !Number.isSafeInteger(candidate.userId) ||
    candidate.userId <= 0 ||
    typeof candidate.login !== "string" ||
    !loginPattern.test(candidate.login) ||
    typeof candidate.issuedAt !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    !Array.isArray(installationIds) ||
    installationIds.length > 500 ||
    installationIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
  ) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(candidate.expiresAt)) || Number.isNaN(Date.parse(candidate.issuedAt))) {
    return undefined;
  }
  return {
    userId: candidate.userId,
    login: candidate.login,
    installationIds: installationIds as number[],
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
  };
}

/**
 * Verifies and decodes a session cookie.
 *
 * Returns `undefined` for anything that is not a currently valid session — a bad signature, a
 * malformed payload, or an expired one — so a caller cannot accidentally treat a rejected
 * session as an anonymous-but-present one.
 */
export function decodeUserSession(token: string, secret: string, now: Date): UserSession | undefined {
  if (typeof token !== "string" || token.length === 0 || token.length > maximumTokenLength) return undefined;

  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return undefined;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (signature.includes(".")) return undefined;
  if (!signatureMatches(payload, signature, secret)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }

  const session = parseSession(parsed);
  if (!session) return undefined;
  return Date.parse(session.expiresAt) > now.getTime() ? session : undefined;
}

/** Whether a verified session grants access to a given installation. */
export function sessionAllowsInstallation(session: UserSession, githubInstallationId: number): boolean {
  return session.installationIds.includes(githubInstallationId);
}
