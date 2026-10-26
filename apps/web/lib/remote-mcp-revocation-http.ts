import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { readBoundedRemoteMcpForm } from "./remote-mcp-bounded-form.js";
import { revokeRemoteMcpGrant } from "./remote-mcp-grant-store.js";
import { decodeUserSession } from "./user-session.js";
import { sessionCookieName } from "./viewer-authorization.js";

const path = "/oauth/connections";
const maxRevocationPostBytes = 2048;
const maxListedGrants = 50;
const csrfLifetimeSeconds = 600;
const idPattern = /^[a-zA-Z0-9_-]{16,128}$/u;
const pageHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
};

type ConnectionsDb = Pick<PgQueryExecutor, "query" | "close">;
export interface RemoteMcpRevocationDependencies {
  issuer: string;
  sessionSecret: string;
  openDb(): Promise<ConnectionsDb>;
}

function simple(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...pageHeaders, "content-type": "text/plain; charset=utf-8" },
  });
}

function escapeHtml(input: string): string {
  return input.replace(
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

function browserSession(request: Request, secret: string): { userId: number; cookie: string } | null {
  const raw = request.headers.get("cookie") ?? "";
  if (raw.length > 12_000) return null;
  const matches = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${sessionCookieName}=`));
  if (matches.length !== 1) return null;
  const cookie = matches[0]?.slice(sessionCookieName.length + 1) ?? "";
  const decoded = decodeUserSession(cookie, secret, new Date());
  return decoded ? { userId: decoded.userId, cookie } : null;
}

function csrfSignature(userId: number, cookie: string, grantId: string, expiry: number, nonce: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`remote-mcp-revocation-v1\n${userId}\n${cookie}\n${grantId}\n${expiry}\n${nonce}`)
    .digest("base64url");
}

function freshCsrf(userId: number, cookie: string, grantId: string, secret: string): string {
  const expiry = Math.floor(Date.now() / 1000) + csrfLifetimeSeconds;
  const nonce = randomBytes(16).toString("base64url");
  return `${expiry}.${nonce}.${csrfSignature(userId, cookie, grantId, expiry, nonce, secret)}`;
}

function validCsrf(value: string, userId: number, cookie: string, grantId: string, secret: string): boolean {
  if (value.length > 120 || !idPattern.test(grantId)) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [seconds, nonce, signature] = parts;
  if (
    !seconds ||
    !/^[1-9][0-9]{9}$/u.test(seconds) ||
    !nonce ||
    !/^[a-zA-Z0-9_-]{22}$/u.test(nonce) ||
    !signature ||
    !/^[a-zA-Z0-9_-]{43}$/u.test(signature)
  )
    return false;
  const expiry = Number(seconds);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + csrfLifetimeSeconds) return false;
  const expected = Buffer.from(csrfSignature(userId, cookie, grantId, expiry, nonce, secret), "ascii");
  const received = Buffer.from(signature, "ascii");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function trustedRoute(request: Request, issuer: string): boolean {
  try {
    const url = new URL(request.url);
    return url.origin === issuer && url.pathname === path && !url.search && !url.hash;
  } catch {
    return false;
  }
}

interface ConnectionRow {
  jti: string;
  client_id: string;
  display_name: string | null;
  scope: string;
  expires_at: Date | string;
}

/** Only the signed-in GitHub user can see their bounded active OAuth grants. */
export async function handleRemoteMcpConnectionsGet(
  request: Request,
  deps: RemoteMcpRevocationDependencies,
): Promise<Response> {
  if (request.method !== "GET" || !trustedRoute(request, deps.issuer))
    return simple(400, "Invalid connections request");
  const session = browserSession(request, deps.sessionSecret);
  if (!session) return simple(401, "Sign in with GitHub to manage your connections");
  let db: ConnectionsDb | undefined;
  try {
    db = await deps.openDb();
    const found = await db.query(
      `select g.jti, g.client_id, c.display_name, g.scope, g.expires_at
         from remote_mcp_oauth_grants g
         join remote_mcp_oauth_clients c on c.client_id = g.client_id
           and c.registration_epoch = g.client_registration_epoch and c.enabled = true
        where g.github_user_id = $1 and g.issuer = $2
          and g.revoked_at is null and g.expires_at > now()
        order by g.created_at desc, g.jti desc limit $3`,
      [session.userId, deps.issuer, maxListedGrants],
    );
    const rows = (found as { rows?: ConnectionRow[] }).rows;
    if (!Array.isArray(rows) || rows.length > maxListedGrants) throw new Error("Invalid grant listing");
    const forms = rows
      .map((row) => {
        if (
          !idPattern.test(row.jti) ||
          typeof row.client_id !== "string" ||
          typeof row.scope !== "string" ||
          row.client_id.length > 2048 ||
          row.scope.length > 256
        ) {
          throw new Error("Invalid grant details");
        }
        const expiry = new Date(row.expires_at).toISOString();
        const csrf = freshCsrf(session.userId, session.cookie, row.jti, deps.sessionSecret);
        return `<li><strong>${escapeHtml(row.display_name || "Registered OAuth client")}</strong>
<code>${escapeHtml(row.client_id)}</code> — ${escapeHtml(row.scope)} (expires ${escapeHtml(expiry)})
<form method="post" action="${path}"><input type="hidden" name="grant_id" value="${escapeHtml(row.jti)}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Revoke access</button></form></li>`;
      })
      .join("\n");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manage connected OAuth clients</title></head><body>
<main><h1>BoardReadyOps connected OAuth clients</h1><p>Only active grants belonging to your signed-in GitHub account are shown.</p>
${forms ? `<ul>${forms}</ul>` : "<p>No active OAuth grants.</p>"}
<p>Showing up to ${maxListedGrants} most recent grants. Revoke entries and reload to see older ones.</p>
<p>Revocation takes effect on the next MCP request. It does not revoke your GitHub browser login.</p></main></body></html>`;
    return new Response(html, { status: 200, headers: { ...pageHeaders, "content-type": "text/html; charset=utf-8" } });
  } catch {
    return simple(503, "Connections temporarily unavailable");
  } finally {
    await db?.close().catch(() => undefined);
  }
}

/** A signed session, exact Origin and session/grant-bound HMAC CSRF are mandatory. */
export async function handleRemoteMcpConnectionsPost(
  request: Request,
  deps: RemoteMcpRevocationDependencies,
): Promise<Response> {
  if (
    request.method !== "POST" ||
    !trustedRoute(request, deps.issuer) ||
    request.headers.get("origin") !== deps.issuer ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")
  ) {
    return simple(403, "Connections request forbidden");
  }
  const session = browserSession(request, deps.sessionSecret);
  if (!session) return simple(401, "Sign in required");
  const body = await readBoundedRemoteMcpForm(request, maxRevocationPostBytes);
  if (body === null) return simple(400, "Invalid revocation form");
  const form = new URLSearchParams(body);
  if (
    [...form.keys()].some((key) => !["grant_id", "csrf"].includes(key) || form.getAll(key).length !== 1) ||
    form.size !== 2
  )
    return simple(400, "Invalid revocation form");
  const grantId = form.get("grant_id") ?? "";
  const csrf = form.get("csrf") ?? "";
  if (!validCsrf(csrf, session.userId, session.cookie, grantId, deps.sessionSecret)) {
    return simple(403, "Invalid revocation request");
  }
  let db: ConnectionsDb | undefined;
  try {
    db = await deps.openDb();
    // The SQL mutation itself checks the authenticated owner and logs only
    // successful revocations; no caller-controlled user ID is ever accepted.
    await revokeRemoteMcpGrant(db, grantId, session.userId);
    return new Response(null, { status: 303, headers: { ...pageHeaders, location: path } });
  } catch {
    return simple(503, "Connections temporarily unavailable");
  } finally {
    await db?.close().catch(() => undefined);
  }
}
