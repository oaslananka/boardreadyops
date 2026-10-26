import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  beginRemoteMcpConsent,
  decideRemoteMcpConsent,
  type OAuthAuthorizationParameters,
  remoteMcpAuthorizationRedirect,
} from "./remote-mcp-authorization-code.js";
import { recordRemoteMcpOAuthEvent, takeRemoteMcpOAuthRateLimit } from "./remote-mcp-oauth-abuse.js";
import { decodeUserSession } from "./user-session.js";
import { sessionCookieName } from "./viewer-authorization.js";

const consentPath = "/oauth/authorize";
const maxConsentQueryBytes = 8192;
const maxConsentPostBytes = 2048;

const securityHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
} as const;

export interface RemoteMcpConsentDependencies {
  issuer: string;
  sessionSecret: string;
  openDb(): Promise<Pick<PgQueryExecutor, "query" | "close">>;
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...securityHeaders, "content-type": "text/plain; charset=utf-8" },
  });
}

function escaped(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

function tokenFromCookies(header: string, name: string): string | null {
  if (header.length > 12000) return null;
  const values = header.split(";").map((item) => item.trim());
  const found = values.filter((value) => value.startsWith(`${name}=`));
  return found.length === 1 ? (found[0]?.slice(name.length + 1) ?? null) : null;
}

function sessionUser(request: Request, secret: string): number | null {
  const sessionToken = tokenFromCookies(request.headers.get("cookie") ?? "", sessionCookieName);
  const session = sessionToken ? decodeUserSession(sessionToken, secret, new Date()) : null;
  return session?.userId ?? null;
}

function routeIsTrusted(request: Request, issuer: string): boolean {
  try {
    const url = new URL(request.url);
    return issuer === url.origin && url.pathname === consentPath && url.hash === "";
  } catch {
    return false;
  }
}

function paramsFromQuery(searchParams: URLSearchParams): OAuthAuthorizationParameters | null {
  const keyMap = {
    response_type: "responseType",
    client_id: "clientId",
    redirect_uri: "redirectUri",
    code_challenge: "codeChallenge",
    code_challenge_method: "codeChallengeMethod",
    state: "state",
    scope: "scope",
    resource: "resource",
  } as const;
  for (const key of searchParams.keys()) {
    if (!(key in keyMap) || searchParams.getAll(key).length !== 1) return null;
  }
  for (const key of Object.keys(keyMap)) if (!searchParams.has(key)) return null;
  return {
    responseType: searchParams.get("response_type") ?? "",
    clientId: searchParams.get("client_id") ?? "",
    redirectUri: searchParams.get("redirect_uri") ?? "",
    codeChallenge: searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: searchParams.get("code_challenge_method") ?? "",
    state: searchParams.get("state") ?? "",
    scope: searchParams.get("scope") ?? "",
    resource: searchParams.get("resource") ?? "",
  };
}

function htmlPage(values: {
  clientName: string;
  redirectOrigin: string;
  scopes: string[];
  authorizationId: string;
  csrfNonce: string;
}): string {
  const scopes = values.scopes.map((scope) => `<li><code>${escaped(scope)}</code> (read-only)</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to BoardReadyOps</title></head><body>
<main><h1>Authorize access to BoardReadyOps</h1>
<p><strong>${escaped(values.clientName)}</strong> is asking for access to your BoardReadyOps review data.</p>
<p>Return destination: <code>${escaped(values.redirectOrigin)}</code></p>
<p>Permissions requested:</p><ul>${scopes}</ul>
<p>This grants read-only access to eligible repositories that your GitHub account can currently access. No production approval is implied. Access expires and may be revoked.</p>
<form action="/oauth/authorize" method="post">
<input type="hidden" name="authorization_id" value="${escaped(values.authorizationId)}">
<input type="hidden" name="csrf" value="${escaped(values.csrfNonce)}">
<button type="submit" name="decision" value="approve">Allow read-only access</button>
<button type="submit" name="decision" value="deny">Deny access</button>
</form></main></body></html>`;
}

function signInPage(returnTo: string): Response {
  const path = `${consentPath}${returnTo}`;
  const signInUrl =
    path.length <= 512 ? `/api/auth/github/login?return_to=${encodeURIComponent(path)}` : "/api/auth/github/login";
  const message = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in</title></head><body>
<main><h1>Sign in before authorizing</h1><p>Your GitHub session must be active before you can grant access.</p>
<a href="${escaped(signInUrl)}">Sign in with GitHub</a>
<p>If you were not returned to this screen after login, restart connection from your AI client.</p></main></body></html>`;
  return new Response(message, { status: 401, headers: securityHeaders });
}

/** The HTTP GET creates a pending consent record, never an approval. */
export async function handleRemoteMcpConsentGet(
  request: Request,
  deps: RemoteMcpConsentDependencies,
): Promise<Response> {
  if (request.method !== "GET" || !routeIsTrusted(request, deps.issuer) || request.url.length > maxConsentQueryBytes) {
    return errorResponse(400, "Invalid OAuth authorization request");
  }
  const url = new URL(request.url);
  const userId = sessionUser(request, deps.sessionSecret);
  if (!userId) return signInPage(url.search);
  const params = paramsFromQuery(url.searchParams);
  if (!params) return errorResponse(400, "Invalid OAuth authorization request");

  let db: Awaited<ReturnType<typeof deps.openDb>> | undefined;
  try {
    db = await deps.openDb();
    const throttle = await takeRemoteMcpOAuthRateLimit(db, "consent-user", String(userId), 12);
    if (!throttle.allowed) {
      await recordRemoteMcpOAuthEvent(db, "rate_limited", userId);
      return new Response("Too many consent requests", {
        status: 429,
        headers: {
          ...securityHeaders,
          "retry-after": String(throttle.retryAfterSeconds),
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
    const pending = await beginRemoteMcpConsent(db, userId, params);
    if (!pending) return errorResponse(400, "OAuth client or authorization request unavailable");
    await recordRemoteMcpOAuthEvent(db, "consent_started", userId, params.clientId);
    return new Response(
      htmlPage({
        clientName: pending.displayName,
        redirectOrigin: pending.redirectOrigin,
        scopes: pending.scopes,
        authorizationId: pending.authorizationId,
        csrfNonce: pending.csrfNonce,
      }),
      { status: 200, headers: securityHeaders },
    );
  } catch {
    return errorResponse(503, "Authorization service temporarily unavailable");
  } finally {
    await db?.close().catch(() => undefined);
  }
}

/** Approval requires a signed user session, same-origin POST and unique CSRF. */
export async function handleRemoteMcpConsentPost(
  request: Request,
  deps: RemoteMcpConsentDependencies,
): Promise<Response> {
  if (
    request.method !== "POST" ||
    !routeIsTrusted(request, deps.issuer) ||
    request.headers.get("origin") !== deps.issuer ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "") ||
    Number(request.headers.get("content-length") ?? 0) > maxConsentPostBytes
  ) {
    return errorResponse(403, "Consent request forbidden");
  }
  const userId = sessionUser(request, deps.sessionSecret);
  if (!userId) return errorResponse(401, "Sign in required");

  let data: URLSearchParams;
  try {
    const body = await request.text();
    if (body.length === 0 || body.length > maxConsentPostBytes) return errorResponse(400, "Invalid consent request");
    data = new URLSearchParams(body);
  } catch {
    return errorResponse(400, "Invalid consent request");
  }
  for (const key of data.keys()) {
    if (!["authorization_id", "csrf", "decision"].includes(key) || data.getAll(key).length !== 1) {
      return errorResponse(400, "Invalid consent request");
    }
  }
  const decision = data.get("decision");
  if (decision !== "approve" && decision !== "deny") return errorResponse(400, "Invalid consent decision");
  const id = data.get("authorization_id") ?? "";
  const csrf = data.get("csrf") ?? "";

  let db: Awaited<ReturnType<typeof deps.openDb>> | undefined;
  try {
    db = await deps.openDb();
    const throttle = await takeRemoteMcpOAuthRateLimit(db, "consent-decision-user", String(userId), 20);
    if (!throttle.allowed) {
      await recordRemoteMcpOAuthEvent(db, "rate_limited", userId);
      return new Response("Too many consent decisions", {
        status: 429,
        headers: {
          ...securityHeaders,
          "retry-after": String(throttle.retryAfterSeconds),
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
    const decided = await decideRemoteMcpConsent(db, userId, id, csrf, decision === "approve");
    if (!decided) return errorResponse(400, "Consent expired or already decided");
    const location = remoteMcpAuthorizationRedirect(decided, deps.issuer);
    return new Response(null, {
      status: 303,
      headers: { ...securityHeaders, location, "content-type": "text/plain; charset=utf-8" },
    });
  } catch {
    return errorResponse(503, "Authorization service temporarily unavailable");
  } finally {
    await db?.close().catch(() => undefined);
  }
}
