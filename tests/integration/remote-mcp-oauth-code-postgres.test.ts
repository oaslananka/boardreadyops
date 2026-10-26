import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLocalJWKSet } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticateRemoteMcpRequest } from "../../apps/web/lib/remote-mcp-access.js";
import {
  beginRemoteMcpConsent,
  decideRemoteMcpConsent,
  exchangeRemoteMcpAuthorizationCode,
  remoteMcpAuthorizationRedirect,
  remoteMcpOauthLifetime,
} from "../../apps/web/lib/remote-mcp-authorization-code.js";
import { remoteMcpResource } from "../../apps/web/lib/remote-mcp-foundation.js";
import { isRemoteMcpGrantActive, revokeRemoteMcpGrant } from "../../apps/web/lib/remote-mcp-grant-store.js";
import { createRemoteMcpJwtVerifier } from "../../apps/web/lib/remote-mcp-jwt-verifier.js";
import { handleRemoteMcpTokenRequest } from "../../apps/web/lib/remote-mcp-token-http.js";
import {
  createRemoteMcpTokenIssuer,
  remoteMcpAuthorizationServerMetadata,
} from "../../apps/web/lib/remote-mcp-token-issuer.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const url = getPostgresTestConnectionString();
const describePg = url ? describe : describe.skip;
const db = url ? createPgQueryExecutor({ connectionString: url, max: 3 }) : undefined;
const issuer = "https://id.boardreadyops.com";
const clientId = "https://trusted.example/oauth-client.json";
const redirectUri = "https://trusted.example/callback";
const githubUserId = 20261026;
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const tokenIssuer = createRemoteMcpTokenIssuer({
  issuer,
  privateKeyPem: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString(),
  keyId: "oauth-test-key-01",
});
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected an authorized OAuth test value");
  return value;
}
function executor() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}
function params(overrides: Record<string, string> = {}) {
  return {
    responseType: "code",
    clientId,
    redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state: randomUUID(),
    scope: "review:read",
    resource: remoteMcpResource,
    ...overrides,
  };
}

async function consent(overrides: Record<string, string> = {}) {
  const started = await beginRemoteMcpConsent(executor(), githubUserId, params(overrides));
  expect(started).not.toBeNull();
  return required(started);
}

describePg("remote MCP OAuth single-use flow on isolated PostgreSQL", () => {
  beforeAll(async () => {
    for (const name of ["0095_remote_mcp_oauth_grants.sql", "0096_remote_mcp_oauth_authorization_codes.sql"]) {
      const sql = await readFile(new URL(`../../packages/db/migrations/${name}`, import.meta.url), "utf8");
      await executor().query(sql);
    }
    await executor().query(
      `insert into remote_mcp_oauth_clients (client_id, redirect_uri, display_name, enabled)
       values ($1, $2, 'Trusted Test Client', true) on conflict (client_id) do update set enabled = true`,
      [clientId, redirectUri],
    );
  });
  afterAll(async () => {
    try {
      await executor().query("delete from remote_mcp_oauth_grants where client_id = $1", [clientId]);
      await executor().query("delete from remote_mcp_oauth_authorizations where client_id = $1", [clientId]);
      await executor().query("delete from remote_mcp_oauth_clients where client_id = $1", [clientId]);
    } finally {
      await db?.close();
    }
  });

  it("starts consent only for a pre-registered exact HTTPS client and S256", async () => {
    const started = await consent();
    expect(started.displayName).toBe("Trusted Test Client");
    expect(started.redirectOrigin).toBe("https://trusted.example");
    expect(started.scopes).toEqual(["review:read"]);
    expect(
      await beginRemoteMcpConsent(executor(), githubUserId, params({ redirectUri: "https://evil.example/cb" })),
    ).toBeNull();
    expect(
      await beginRemoteMcpConsent(
        executor(),
        githubUserId,
        params({ clientId: "https://evil.example/oauth-client.json" }),
      ),
    ).toBeNull();
    expect(await beginRemoteMcpConsent(executor(), githubUserId, params({ codeChallengeMethod: "plain" }))).toBeNull();
    expect(
      await beginRemoteMcpConsent(executor(), githubUserId, params({ resource: "https://wrong.example/mcp" })),
    ).toBeNull();
  });

  it("refuses cross-user consent, invalid CSRF, double approval and redirect manipulation", async () => {
    const started = await consent();
    const { authorizationId, csrfNonce } = started;
    expect(await decideRemoteMcpConsent(executor(), githubUserId + 1, authorizationId, csrfNonce, true)).toBeNull();
    expect(await decideRemoteMcpConsent(executor(), githubUserId, authorizationId, "A".repeat(43), true)).toBeNull();
    const approved = await decideRemoteMcpConsent(executor(), githubUserId, authorizationId, csrfNonce, true);
    expect(approved?.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const redirect = new URL(remoteMcpAuthorizationRedirect(required(approved), issuer));
    expect(redirect.origin).toBe("https://trusted.example");
    expect(redirect.searchParams.get("iss")).toBe(issuer);
    expect(redirect.searchParams.get("state")).toBe(approved?.state);
    expect(await decideRemoteMcpConsent(executor(), githubUserId, authorizationId, csrfNonce, true)).toBeNull();
    expect(await decideRemoteMcpConsent(executor(), githubUserId, authorizationId, csrfNonce, false)).toBeNull();
    const codeStored = await executor().query("select code_sha256 from remote_mcp_oauth_authorizations where id = $1", [
      authorizationId,
    ]);
    expect((codeStored as { rows: { code_sha256: string }[] }).rows[0]?.code_sha256).not.toBe(approved?.code);
  });

  it("denial is one-use and never creates an authorization code", async () => {
    const started = await consent();
    const denied = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      false,
    );
    expect(denied?.code).toBeNull();
    const redirect = new URL(remoteMcpAuthorizationRedirect(required(denied), issuer));
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.has("code")).toBe(false);
    expect(
      await decideRemoteMcpConsent(executor(), githubUserId, started.authorizationId, started.csrfNonce, true),
    ).toBeNull();
  });

  it("verifies exact client+redirect+PKCE, issues bound JWT and revokes grant immediately", async () => {
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    const code = required(required(approved).code);
    const signing = tokenIssuer.sign;
    const input = { code, clientId, redirectUri, codeVerifier: verifier };
    expect(
      await exchangeRemoteMcpAuthorizationCode(executor(), { ...input, codeVerifier: "A".repeat(43) }, issuer, signing),
    ).toBeNull();
    expect(
      await exchangeRemoteMcpAuthorizationCode(
        executor(),
        { ...input, redirectUri: "https://trusted.example/other" },
        issuer,
        signing,
      ),
    ).toBeNull();
    expect(
      await exchangeRemoteMcpAuthorizationCode(
        executor(),
        { ...input, clientId: "https://other.example/client" },
        issuer,
        signing,
      ),
    ).toBeNull();
    const token = await exchangeRemoteMcpAuthorizationCode(executor(), input, issuer, signing);
    expect(token?.token_type).toBe("Bearer");
    expect(token?.expires_in).toBe(900);
    expect(token?.scope).toBe("review:read");
    expect(await exchangeRemoteMcpAuthorizationCode(executor(), input, issuer, signing)).toBeNull();

    const jwks = await tokenIssuer.publicJwks();
    const publicKey = (jwks.keys as Record<string, unknown>[])[0];
    expect(publicKey?.alg).toBe("RS256");
    expect(publicKey).not.toHaveProperty("d");
    expect(publicKey).not.toHaveProperty("p");
    expect(publicKey).not.toHaveProperty("q");
    const jwtVerifier = createRemoteMcpJwtVerifier({
      issuer,
      verifyKey: createLocalJWKSet(jwks as never),
      activeGrant: (jti, id, client, tokenIssuer) => isRemoteMcpGrantActive(executor(), jti, id, client, tokenIssuer),
    });
    const request = new Request(remoteMcpResource, { headers: { authorization: `Bearer ${token?.access_token}` } });
    const authenticated = await authenticateRemoteMcpRequest(request, issuer, jwtVerifier);
    expect(authenticated?.githubUserId).toBe(githubUserId);
    expect(authenticated?.scopes).toEqual(["review:read"]);
    expect(await revokeRemoteMcpGrant(executor(), required(authenticated).grantId, githubUserId + 1)).toBe(false);
    expect(await revokeRemoteMcpGrant(executor(), required(authenticated).grantId, githubUserId)).toBe(true);
    expect(await authenticateRemoteMcpRequest(request, issuer, jwtVerifier)).toBeNull();
  });

  it("allows exactly one winner when two token exchanges race for one code", async () => {
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    const input = { code: required(required(approved).code), clientId, redirectUri, codeVerifier: verifier };
    const before = await executor().query(
      `select count(*)::int as n from remote_mcp_oauth_grants where client_id = $1 and github_user_id = $2`,
      [clientId, githubUserId],
    );
    const beforeCount = Number((before as { rows: { n: number }[] }).rows[0]?.n);
    const [a, b] = await Promise.all([
      exchangeRemoteMcpAuthorizationCode(executor(), input, issuer, tokenIssuer.sign),
      exchangeRemoteMcpAuthorizationCode(executor(), input, issuer, tokenIssuer.sign),
    ]);
    expect([a, b].filter((result) => result !== null)).toHaveLength(1);
    const count = await executor().query(
      `select count(*)::int as n from remote_mcp_oauth_grants where client_id = $1 and github_user_id = $2`,
      [clientId, githubUserId],
    );
    expect(Number((count as { rows: { n: number }[] }).rows[0]?.n)).toBe(beforeCount + 1);
  });

  it("disabling a preregistered client blocks new consent and code exchange", async () => {
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    await executor().query("update remote_mcp_oauth_clients set enabled = false where client_id = $1", [clientId]);
    try {
      expect(await beginRemoteMcpConsent(executor(), githubUserId, params())).toBeNull();
      expect(
        await exchangeRemoteMcpAuthorizationCode(
          executor(),
          { code: required(required(approved).code), clientId, redirectUri, codeVerifier: verifier },
          issuer,
          tokenIssuer.sign,
        ),
      ).toBeNull();
    } finally {
      await executor().query("update remote_mcp_oauth_clients set enabled = true where client_id = $1", [clientId]);
    }
  });

  it("redeems an authorized code through form-encoded OAuth HTTP without exposing credentials", async () => {
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    const code = required(required(approved).code);
    const payload = {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      code,
      resource: remoteMcpResource,
    };
    const deps = {
      issuer,
      openDb: async () => ({
        query: executor().query,
        withTransaction: executor().withTransaction,
        close: async () => undefined,
      }),
      signAccessToken: tokenIssuer.sign,
    };
    const request = (form: Record<string, string>) =>
      new Request(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
    const missingResource = await handleRemoteMcpTokenRequest(
      request({ ...payload, resource: "https://other.example/mcp" }),
      deps,
    );
    expect(missingResource.status).toBe(400);
    const success = await handleRemoteMcpTokenRequest(request(payload), deps);
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("no-store");
    const body = (await success.json()) as { access_token: string; token_type: string };
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token.split(".")).toHaveLength(3);
    const replay = await handleRemoteMcpTokenRequest(request(payload), deps);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_grant" });
  });

  it("rejects expired or already-consumed code in SQL", async () => {
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    await executor().query(
      "update remote_mcp_oauth_authorizations set code_expires_at = now() - interval '1 second' where id = $1",
      [started.authorizationId],
    );
    expect(
      await exchangeRemoteMcpAuthorizationCode(
        executor(),
        { code: required(required(approved).code), clientId, redirectUri, codeVerifier: verifier },
        issuer,
        tokenIssuer.sign,
      ),
    ).toBeNull();
  });

  it("announces only supported discovery features, not dynamic registration", () => {
    const metadata = remoteMcpAuthorizationServerMetadata(issuer);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(metadata).not.toHaveProperty("registration_endpoint");
    expect(remoteMcpOauthLifetime).toEqual({ consentSeconds: 600, codeSeconds: 90, accessTokenSeconds: 900 });
  });
});
