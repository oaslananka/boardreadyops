import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  type OAuthAuthorizationParameters,
  validRemoteMcpOAuthAuthorizationParameters,
} from "./remote-mcp-authorization-code.js";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const noncePattern = /^[A-Za-z0-9_-]{43}$/u;

/** Preserve validated authorization parameters, never an OAuth credential,
 * for the duration of an interactive GitHub login. No GitHub user identity is
 * stored yet. A random HttpOnly cookie must accompany the resume ID.
 */
export async function beginRemoteMcpLoginResumption(
  db: Pick<PgQueryExecutor, "query">,
  params: OAuthAuthorizationParameters,
): Promise<{ id: string; nonce: string } | null> {
  if (!validRemoteMcpOAuthAuthorizationParameters(params)) return null;
  const id = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  const result = await db.query(
    `insert into remote_mcp_oauth_login_resumptions
        (id, nonce_sha256, client_id, request_parameters, expires_at)
     select $1::uuid, $2, c.client_id, $4::jsonb, now() + interval '10 minutes'
       from remote_mcp_oauth_clients c
      where c.client_id = $3 and c.redirect_uri = $5 and c.enabled = true
     returning id`,
    [id, digest(nonce), params.clientId, JSON.stringify(params), params.redirectUri],
  );
  return ((result as { rows?: unknown[] }).rows ?? []).length === 1 ? { id, nonce } : null;
}

/** Atomic DELETE makes the browser-bound resume one-use, even under races.
 * Caller must verify the GitHub browser session BEFORE consuming.
 */
export async function consumeRemoteMcpLoginResumption(
  db: Pick<PgQueryExecutor, "query">,
  id: string,
  nonce: string,
): Promise<OAuthAuthorizationParameters | null> {
  if (!uuid.test(id) || !noncePattern.test(nonce)) return null;
  const result = await db.query(
    `delete from remote_mcp_oauth_login_resumptions r
      where r.id = $1::uuid and r.nonce_sha256 = $2 and r.expires_at > now()
        and exists (
          select 1 from remote_mcp_oauth_clients c
           where c.client_id = r.client_id
             and c.redirect_uri = r.request_parameters ->> 'redirectUri'
             and c.enabled = true
        )
      returning r.request_parameters`,
    [id, digest(nonce)],
  );
  const params: unknown = ((result as { rows?: { request_parameters: unknown }[] }).rows ?? [])[0]?.request_parameters;
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const value = params as OAuthAuthorizationParameters;
  return validRemoteMcpOAuthAuthorizationParameters(value) ? value : null;
}

export const remoteMcpLoginResumptionCookie = "brops_mcp_login_resume";
export function remoteMcpLoginResumptionCookieHeader(nonce: string): string {
  if (!noncePattern.test(nonce)) throw new Error("Invalid OAuth resume nonce");
  return `${remoteMcpLoginResumptionCookie}=${nonce}; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}
export const clearedRemoteMcpLoginResumptionCookie = `${remoteMcpLoginResumptionCookie}=; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
