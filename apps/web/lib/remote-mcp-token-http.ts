import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { exchangeRemoteMcpAuthorizationCode, type SignedRemoteMcpTokenFacts } from "./remote-mcp-authorization-code.js";
import { remoteMcpResource } from "./remote-mcp-foundation.js";
import { recordRemoteMcpOAuthEvent, takeRemoteMcpOAuthRateLimit } from "./remote-mcp-oauth-abuse.js";

const genericHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

function errorResponse(
  code: "invalid_request" | "invalid_grant" | "unsupported_grant_type" | "temporarily_unavailable",
  status: number,
): Response {
  return Response.json({ error: code }, { status, headers: genericHeaders });
}

/** Standalone OAuth token endpoint adapter; never wired to public routes until
 * consent handling, client metadata/registration and deployment checks pass.
 * The token exchange is public-client authorization_code + S256 only.
 */
export async function handleRemoteMcpTokenRequest(
  request: Request,
  deps: {
    issuer: string;
    openDb(): Promise<Pick<PgQueryExecutor, "query" | "withTransaction" | "close">>;
    signAccessToken(claims: SignedRemoteMcpTokenFacts): Promise<string>;
  },
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (
    url.href !== `${deps.issuer}/oauth/token` ||
    request.method !== "POST" ||
    url.search.length > 0 ||
    request.headers.has("cookie") ||
    !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "") ||
    Number(request.headers.get("content-length") ?? 0) > 4096
  )
    return errorResponse("invalid_request", 400);

  let parameters: URLSearchParams;
  try {
    const raw = await request.text();
    if (raw.length === 0 || raw.length > 4096) return errorResponse("invalid_request", 400);
    parameters = new URLSearchParams(raw);
  } catch {
    return errorResponse("invalid_request", 400);
  }
  const allowed = ["grant_type", "code", "client_id", "redirect_uri", "code_verifier", "resource"];
  for (const key of parameters.keys()) {
    if (!allowed.includes(key) || parameters.getAll(key).length !== 1) return errorResponse("invalid_request", 400);
  }
  if (parameters.get("grant_type") !== "authorization_code") {
    return errorResponse("unsupported_grant_type", 400);
  }
  if (parameters.get("resource") !== remoteMcpResource || allowed.some((key) => !parameters.get(key)))
    return errorResponse("invalid_request", 400);

  let db: Awaited<ReturnType<typeof deps.openDb>> | undefined;
  try {
    db = await deps.openDb();
    const globalLimit = await takeRemoteMcpOAuthRateLimit(db, "token-global", "oauth-token", 600);
    if (!globalLimit.allowed) {
      await recordRemoteMcpOAuthEvent(db, "rate_limited");
      return new Response(JSON.stringify({ error: "slow_down" }), {
        status: 429,
        headers: { ...genericHeaders, "retry-after": String(globalLimit.retryAfterSeconds) },
      });
    }
    const clientId = parameters.get("client_id") ?? "";
    const registered = await db.query(
      "select 1 from remote_mcp_oauth_clients where client_id = $1 and enabled = true limit 1",
      [clientId],
    );
    if (((registered as { rows?: unknown[] }).rows ?? []).length !== 1) return errorResponse("invalid_grant", 400);
    const clientLimit = await takeRemoteMcpOAuthRateLimit(db, "token-client", clientId, 40);
    if (!clientLimit.allowed) {
      await recordRemoteMcpOAuthEvent(db, "rate_limited", undefined, clientId);
      return new Response(JSON.stringify({ error: "slow_down" }), {
        status: 429,
        headers: { ...genericHeaders, "retry-after": String(clientLimit.retryAfterSeconds) },
      });
    }
    const exchanged = await exchangeRemoteMcpAuthorizationCode(
      db,
      {
        code: parameters.get("code") ?? "",
        clientId: parameters.get("client_id") ?? "",
        redirectUri: parameters.get("redirect_uri") ?? "",
        codeVerifier: parameters.get("code_verifier") ?? "",
      },
      deps.issuer,
      deps.signAccessToken,
    );
    if (!exchanged) {
      await recordRemoteMcpOAuthEvent(db, "token_rejected", undefined, clientId);
      return errorResponse("invalid_grant", 400);
    }
    return Response.json(exchanged, { status: 200, headers: genericHeaders });
  } catch {
    // External services and SQL diagnostics are never shown to OAuth clients.
    return errorResponse("temporarily_unavailable", 503);
  } finally {
    await db?.close().catch(() => undefined);
  }
}
