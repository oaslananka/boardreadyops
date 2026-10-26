import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor } from "@boardreadyops/db";
import type { PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { verifyPkceS256 } from "./remote-mcp-access.js";
import { remoteMcpResource } from "./remote-mcp-foundation.js";
import { recordRemoteMcpOAuthEvent } from "./remote-mcp-oauth-abuse.js";

const sha256 = (secret: string): string => createHash("sha256").update(secret, "utf8").digest("hex");
const challengePattern = /^[A-Za-z0-9_-]{43}$/u;
const consentLifetimeSeconds = 600;
const codeLifetimeSeconds = 90;
const tokenLifetimeSeconds = 900;

export type OAuthAuthorizationParameters = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  resource: string;
};

type RegisteredClient = { client_id: string; redirect_uri: string; display_name: string };

type AuthorizationRow = {
  id: string;
  github_user_id: number | string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
};

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.href === value &&
      value.length <= 2048
    );
  } catch {
    return false;
  }
}

function validIssuerOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validScopes(value: string): boolean {
  return (
    value === "review:read" ||
    value === "evidence:read" ||
    value === "review:read evidence:read" ||
    value === "evidence:read review:read"
  );
}

/** OAuth request parameter validation is shared across pre-login continuation
 * and post-login consent. Untrusted request JSON never supplies the user ID.
 */
export function validRemoteMcpOAuthAuthorizationParameters(params: OAuthAuthorizationParameters): boolean {
  return (
    params.responseType === "code" &&
    params.codeChallengeMethod === "S256" &&
    challengePattern.test(params.codeChallenge) &&
    params.resource === remoteMcpResource &&
    validScopes(params.scope) &&
    validHttpsUrl(params.clientId) &&
    validHttpsUrl(params.redirectUri) &&
    typeof params.state === "string" &&
    params.state.length >= 8 &&
    params.state.length <= 512
  );
}

/** No dynamic client registration or remote metadata fetching: only deliberately
 * pre-registered, enabled client IDs and their EXACT redirect URIs may proceed.
 * The caller must resolve authenticated Github user ID from a verified session.
 */
export async function beginRemoteMcpConsent(
  db: Pick<SqlQueryExecutor, "query">,
  githubUserId: number,
  params: OAuthAuthorizationParameters,
): Promise<{
  authorizationId: string;
  csrfNonce: string;
  displayName: string;
  redirectOrigin: string;
  scopes: string[];
} | null> {
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0 || !validRemoteMcpOAuthAuthorizationParameters(params))
    return null;

  const clients = await db.query(
    `select client_id, redirect_uri, display_name from remote_mcp_oauth_clients
     where client_id = $1 and redirect_uri = $2 and enabled = true limit 1`,
    [params.clientId, params.redirectUri],
  );
  const client = ((clients as { rows?: RegisteredClient[] }).rows ?? [])[0];
  if (!client || client.client_id !== params.clientId || client.redirect_uri !== params.redirectUri) return null;
  const authorizationId = randomUUID();
  const csrfNonce = randomBytes(32).toString("base64url");
  const saved = await db.query(
    `insert into remote_mcp_oauth_authorizations
       (id, github_user_id, client_id, redirect_uri, scope, state, code_challenge, csrf_sha256, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '10 minutes') returning id`,
    [
      authorizationId,
      githubUserId,
      client.client_id,
      client.redirect_uri,
      params.scope,
      params.state,
      params.codeChallenge,
      sha256(csrfNonce),
    ],
  );
  if (((saved as { rows?: unknown[] }).rows ?? []).length !== 1) return null;
  return {
    authorizationId,
    csrfNonce,
    displayName: client.display_name,
    redirectOrigin: new URL(client.redirect_uri).origin,
    scopes: params.scope.split(" "),
  };
}

/** A signed-in user must explicitly click Approve and submit the page's
 * unpredictable same-origin CSRF nonce. An OAuth GET NEVER grants consent.
 * No authorization code plaintext is ever written to the database.
 */
export async function decideRemoteMcpConsent(
  db: Pick<SqlQueryExecutor, "query">,
  githubUserId: number,
  authorizationId: string,
  csrfNonce: string,
  approved: boolean,
): Promise<{ redirectUri: string; state: string; code: string | null } | null> {
  if (
    !Number.isSafeInteger(githubUserId) ||
    githubUserId <= 0 ||
    !/^[0-9a-f-]{36}$/iu.test(authorizationId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(csrfNonce)
  )
    return null;
  const code = approved ? randomBytes(32).toString("base64url") : null;
  const decision = await db.query(
    `with decision as (
     update remote_mcp_oauth_authorizations as auth
        set approved_at = case when $4::boolean then now() else null end,
            denied_at = case when $4::boolean then null else now() end,
            code_sha256 = case when $4::boolean then $5 else null end,
            code_expires_at = case when $4::boolean then least(now() + interval '90 seconds', auth.expires_at) else null end
      where auth.id = $1 and auth.github_user_id = $2 and auth.csrf_sha256 = $3
        and auth.expires_at > now() and auth.approved_at is null and auth.denied_at is null
        and exists (select 1 from remote_mcp_oauth_clients c
                    where c.client_id = auth.client_id and c.redirect_uri = auth.redirect_uri and c.enabled)
      returning auth.redirect_uri, auth.state, auth.github_user_id
    ), logged as (
      insert into remote_mcp_oauth_security_events(event_kind, github_user_id)
      select case when $4::boolean then 'consent_approved' else 'consent_denied' end,
             github_user_id from decision returning id
    )
    select decision.redirect_uri, decision.state from decision join logged on true`,
    [authorizationId, githubUserId, sha256(csrfNonce), approved, code ? sha256(code) : null],
  );
  const row = ((decision as { rows?: { redirect_uri: string; state: string }[] }).rows ?? [])[0];
  if (!row) return null;
  return { redirectUri: row.redirect_uri, state: row.state, code };
}

export function remoteMcpAuthorizationRedirect(
  approved: { redirectUri: string; state: string; code: string | null },
  issuer: string,
): string {
  if (!validHttpsUrl(approved.redirectUri) || !validIssuerOrigin(issuer)) throw new Error("Unsafe OAuth redirect");
  const url = new URL(approved.redirectUri);
  if (approved.code) url.searchParams.set("code", approved.code);
  else url.searchParams.set("error", "access_denied");
  url.searchParams.set("state", approved.state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

export type SignedRemoteMcpTokenFacts = {
  githubUserId: number;
  clientId: string;
  scope: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
};

/** Atomic consume+grant: racing exchanges can never both claim the same code.
 * A signer may prepare a token before commit, but it cannot be returned until
 * the single database transaction has successfully committed.
 */
export async function exchangeRemoteMcpAuthorizationCode(
  db: Pick<PgQueryExecutor, "query" | "withTransaction">,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
  issuer: string,
  signAccessToken: (facts: SignedRemoteMcpTokenFacts) => Promise<string>,
): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: string } | null> {
  if (
    !/^[A-Za-z0-9_-]{43}$/u.test(input.code) ||
    !validHttpsUrl(input.clientId) ||
    !validHttpsUrl(input.redirectUri) ||
    !validIssuerOrigin(issuer)
  )
    return null;
  const codeHash = sha256(input.code);
  const candidate = await db.query(
    `select a.id, a.github_user_id, a.client_id, a.redirect_uri, a.scope, a.state, a.code_challenge
       from remote_mcp_oauth_authorizations a
       join remote_mcp_oauth_clients c on c.client_id = a.client_id
      where a.code_sha256 = $1 and a.client_id = $2 and a.redirect_uri = $3
        and c.redirect_uri = a.redirect_uri and c.enabled = true
        and a.approved_at is not null and a.denied_at is null and a.redeemed_at is null
        and a.code_expires_at > now() and a.expires_at > now()
      limit 1`,
    [codeHash, input.clientId, input.redirectUri],
  );
  const row = ((candidate as { rows?: AuthorizationRow[] }).rows ?? [])[0];
  const githubUserId = Number(row?.github_user_id);
  if (
    !row ||
    !Number.isSafeInteger(githubUserId) ||
    githubUserId <= 0 ||
    !validScopes(row.scope) ||
    !verifyPkceS256(input.codeVerifier, row.code_challenge, "S256")
  )
    return null;

  const now = Math.floor(Date.now() / 1000);
  const facts = {
    githubUserId,
    clientId: row.client_id,
    scope: row.scope,
    jti: randomUUID(),
    issuedAt: now,
    expiresAt: now + tokenLifetimeSeconds,
  };
  const token = await signAccessToken(facts);
  if (!token || token.length > 4096) return null;
  const consumed = await db.withTransaction(async (tx) => {
    const taken = await tx.query(
      `update remote_mcp_oauth_authorizations a set redeemed_at = now()
        where a.id = $1 and a.code_sha256 = $2 and a.client_id = $3 and a.redirect_uri = $4
          and a.redeemed_at is null and a.approved_at is not null and a.denied_at is null
          and a.code_expires_at > now() and a.expires_at > now()
          and exists (select 1 from remote_mcp_oauth_clients c
                      where c.client_id = a.client_id and c.redirect_uri = a.redirect_uri and c.enabled)
        returning a.github_user_id, a.scope`,
      [row.id, codeHash, row.client_id, row.redirect_uri],
    );
    const authorized = ((taken as { rows?: { github_user_id: string | number; scope: string }[] }).rows ?? [])[0];
    if (!authorized || Number(authorized.github_user_id) !== facts.githubUserId || authorized.scope !== facts.scope)
      return false;
    const result = await tx.query(
      `insert into remote_mcp_oauth_grants
         (jti, github_user_id, client_id, issuer, audience, scope, expires_at)
       values ($1, $2, $3, $4, $5, $6, to_timestamp($7)) returning jti`,
      [facts.jti, facts.githubUserId, facts.clientId, issuer, remoteMcpResource, facts.scope, facts.expiresAt],
    );
    if (((result as { rows?: unknown[] }).rows ?? []).length !== 1) return false;
    await recordRemoteMcpOAuthEvent(tx, "token_issued", facts.githubUserId, facts.clientId, facts.jti);
    return true;
  });
  return consumed
    ? { access_token: token, token_type: "Bearer", expires_in: tokenLifetimeSeconds, scope: facts.scope }
    : null;
}

export const remoteMcpOauthLifetime = {
  consentSeconds: consentLifetimeSeconds,
  codeSeconds: codeLifetimeSeconds,
  accessTokenSeconds: tokenLifetimeSeconds,
} as const;
