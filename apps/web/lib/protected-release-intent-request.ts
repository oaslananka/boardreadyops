import { createHmac, timingSafeEqual } from "node:crypto";
import { readBoundedRequestBody } from "./bounded-request-body.js";
import type { UserSession } from "./user-session.js";
import { configuredSessionSecret } from "./user-session.js";

const tokenPurpose = "protected-release.intent.v1";
const tokenLifetimeMs = 10 * 60 * 1000;
const maxBodyBytes = 1024;
const sha = /^[0-9a-f]{40}$/u;
const requestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const repositoryId = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export type ProtectedIntentRequest = {
  sha: string;
  requestId: string;
};

function tokenSignature(session: UserSession, repoId: string, expires: number, secret: string): string {
  const material = [tokenPurpose, String(session.userId), session.issuedAt, repoId, String(expires)].join(":");
  return createHmac("sha256", secret).update(material).digest("base64url");
}

/** Token is purpose-, session- and repository-bound; it is not a release credential. */
export function issueProtectedIntentCsrfToken(session: UserSession, repoId: string, secret: string, now: Date): string {
  if (!repositoryId.test(repoId)) throw new Error("Invalid repository identity.");
  const expires = now.getTime() + tokenLifetimeMs;
  return `${String(expires)}.${tokenSignature(session, repoId, expires, secret)}`;
}

export function validProtectedIntentCsrfToken(
  token: string | null,
  session: UserSession,
  repoId: string,
  secret: string,
  now: Date,
): boolean {
  if (!token || token.length > 256 || !repositoryId.test(repoId)) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^\d{13}$/u.test(parts[0] ?? "")) return false;
  const expires = Number(parts[0]);
  if (!Number.isSafeInteger(expires) || expires <= now.getTime() || expires > now.getTime() + tokenLifetimeMs)
    return false;
  const expected = Buffer.from(tokenSignature(session, repoId, expires, secret), "utf8");
  const presented = Buffer.from(parts[1] ?? "", "utf8");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

function trustedOrigin(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.BOARDREADYOPS_PUBLIC_URL ?? environment.NEXT_PUBLIC_APP_URL;
  if (!configured || !URL.canParse(configured)) return undefined;
  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    return undefined;
  return url.origin;
}

/** Reject missing or attacker-controlled Origin: do not trust Host/X-Forwarded-* headers. */
export function validProtectedIntentOrigin(
  request: Request,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const expected = trustedOrigin(environment);
  const presented = request.headers.get("origin");
  if (!expected || !presented || !URL.canParse(presented)) return false;
  const origin = new URL(presented);
  return origin.origin === expected && presented === expected && request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function parseProtectedIntentJson(request: Request): Promise<ProtectedIntentRequest | undefined> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return undefined;
  }
  let body: unknown;
  try {
    body = JSON.parse((await readBoundedRequestBody(request, maxBodyBytes)).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => key !== "sha" && key !== "requestId") ||
    typeof value.sha !== "string" ||
    !sha.test(value.sha) ||
    typeof value.requestId !== "string" ||
    !requestId.test(value.requestId)
  )
    return undefined;
  return { sha: value.sha, requestId: value.requestId };
}

export function protectedIntentSecret(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  return configuredSessionSecret(environment);
}
