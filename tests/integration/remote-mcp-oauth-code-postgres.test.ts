import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLocalJWKSet } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authenticateRemoteMcpRequest } from "../../apps/web/lib/remote-mcp-access.js";
import {
  beginRemoteMcpConsent,
  decideRemoteMcpConsent,
  exchangeRemoteMcpAuthorizationCode,
  remoteMcpAuthorizationRedirect,
  remoteMcpOauthLifetime,
} from "../../apps/web/lib/remote-mcp-authorization-code.js";
import { handleRemoteMcpConsentGet, handleRemoteMcpConsentPost } from "../../apps/web/lib/remote-mcp-consent-http.js";
import { remoteMcpResource } from "../../apps/web/lib/remote-mcp-foundation.js";
import { isRemoteMcpGrantActive, revokeRemoteMcpGrant } from "../../apps/web/lib/remote-mcp-grant-store.js";
import { handleRemoteMcpWithVerifiedGrant } from "../../apps/web/lib/remote-mcp-http.js";
import { createRemoteMcpJwtVerifier } from "../../apps/web/lib/remote-mcp-jwt-verifier.js";
import {
  oauthClientDigest,
  purgeExpiredRemoteMcpOAuthSecurityData,
  recordRemoteMcpOAuthEvent,
  takeRemoteMcpOAuthRateLimit,
} from "../../apps/web/lib/remote-mcp-oauth-abuse.js";
import { prepareRemoteMcpProductionHandler } from "../../apps/web/lib/remote-mcp-production.js";
import { handleRemoteMcpTokenRequest } from "../../apps/web/lib/remote-mcp-token-http.js";
import {
  createRemoteMcpTokenIssuer,
  remoteMcpAuthorizationServerMetadata,
} from "../../apps/web/lib/remote-mcp-token-issuer.js";
import { encodeUserSession } from "../../apps/web/lib/user-session.js";
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
    for (const name of [
      "0095_remote_mcp_oauth_grants.sql",
      "0096_remote_mcp_oauth_authorization_codes.sql",
      "0097_remote_mcp_oauth_abuse_controls.sql",
      "0098_remote_mcp_oauth_login_resumptions.sql",
      "0099_remote_mcp_oauth_retention_indexes.sql",
    ]) {
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

  it("accepts only pre-registered opaque OAuth client IDs with an exact HTTPS callback", async () => {
    const opaqueId = `claude-local-client-${randomUUID()}`;
    const opaqueCallback = "https://claude.ai/api/mcp/auth_callback";
    try {
      await executor().query(
        `insert into remote_mcp_oauth_clients (client_id, redirect_uri, display_name, enabled)
         values ($1, $2, 'Opaque Test Client', true)`,
        [opaqueId, opaqueCallback],
      );
      const allowed = await beginRemoteMcpConsent(
        executor(),
        githubUserId,
        params({ clientId: opaqueId, redirectUri: opaqueCallback }),
      );
      expect(allowed?.displayName).toBe("Opaque Test Client");
      expect(allowed?.redirectOrigin).toBe("https://claude.ai");
      expect(
        await beginRemoteMcpConsent(
          executor(),
          githubUserId,
          params({ clientId: opaqueId, redirectUri: "https://evil.example/callback" }),
        ),
      ).toBeNull();
      expect(
        await beginRemoteMcpConsent(
          executor(),
          githubUserId,
          params({ clientId: `${opaqueId}-other`, redirectUri: opaqueCallback }),
        ),
      ).toBeNull();
      expect(
        await beginRemoteMcpConsent(
          executor(),
          githubUserId,
          params({ clientId: "http://insecure.example/client-id", redirectUri: opaqueCallback }),
        ),
      ).toBeNull();
      expect(
        await beginRemoteMcpConsent(
          executor(),
          githubUserId,
          params({ clientId: "opaque client with spaces", redirectUri: opaqueCallback }),
        ),
      ).toBeNull();

      const started = required(allowed);
      const approved = await decideRemoteMcpConsent(
        executor(),
        githubUserId,
        started.authorizationId,
        started.csrfNonce,
        true,
      );
      const incorrectClientExchange = await exchangeRemoteMcpAuthorizationCode(
        executor(),
        {
          code: required(required(approved).code),
          clientId: clientId,
          redirectUri: opaqueCallback,
          codeVerifier: verifier,
        },
        issuer,
        tokenIssuer.sign,
      );
      expect(incorrectClientExchange).toBeNull();
      const exchanged = await exchangeRemoteMcpAuthorizationCode(
        executor(),
        {
          code: required(required(approved).code),
          clientId: opaqueId,
          redirectUri: opaqueCallback,
          codeVerifier: verifier,
        },
        issuer,
        tokenIssuer.sign,
      );
      expect(required(exchanged).access_token).toBeTruthy();
      const verified = createRemoteMcpJwtVerifier({
        issuer,
        verifyKey: createLocalJWKSet((await tokenIssuer.publicJwks()) as never),
        activeGrant: (grantId, id, registeredClient, scope, signedIssuer) =>
          isRemoteMcpGrantActive(executor(), grantId, id, registeredClient, signedIssuer, scope),
      });
      const principal = await authenticateRemoteMcpRequest(
        new Request(remoteMcpResource, {
          headers: { authorization: `Bearer ${required(exchanged).access_token}` },
        }),
        issuer,
        verified,
      );
      expect(principal?.githubUserId).toBe(githubUserId);
      expect(principal?.scopes).toEqual(["review:read"]);
    } finally {
      await executor().query("delete from remote_mcp_oauth_grants where client_id = $1", [opaqueId]);
      await executor().query("delete from remote_mcp_oauth_authorizations where client_id = $1", [opaqueId]);
      await executor().query("delete from remote_mcp_oauth_clients where client_id = $1", [opaqueId]);
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

  it("resumes a long OAuth request after GitHub login using a cookie-bound, one-use short link", async () => {
    const secret = "resume-local-session-secret-".repeat(3);
    const signedSession = encodeUserSession(
      {
        userId: githubUserId,
        login: "oauth-test-user",
        installationIds: [],
        issuedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      secret,
    );
    const state = randomUUID().repeat(12);
    const url = new URL(`${issuer}/oauth/authorize`);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: "review:read",
      resource: remoteMcpResource,
    }))
      url.searchParams.set(key, value);
    expect(url.href.length).toBeGreaterThan(512);
    const deps = {
      issuer,
      sessionSecret: secret,
      openDb: async () => ({
        query: executor().query,
        close: async () => undefined,
      }),
    };
    const beforeLogin = await handleRemoteMcpConsentGet(new Request(url), deps);
    expect(beforeLogin.status).toBe(401);
    const loginHtml = await beforeLogin.text();
    expect(loginHtml).not.toContain(state);
    expect(loginHtml).not.toContain(challenge);
    expect(loginHtml).toContain("resume%3D");
    const id = loginHtml.match(/resume%3D([0-9a-f-]{36})/iu)?.[1];
    expect(id).toBeTruthy();
    const setCookie = beforeLogin.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    expect(cookie).toMatch(/^brops_mcp_login_resume=[A-Za-z0-9_-]{43}$/u);
    const resumedUrl = `${issuer}/oauth/authorize?resume=${id}`;
    const browserSessionCookie = `brops_session=${signedSession}; ${cookie}`;
    const forged = await handleRemoteMcpConsentGet(
      new Request(resumedUrl, {
        headers: { cookie: `brops_session=${signedSession}; brops_mcp_login_resume=${"A".repeat(43)}` },
      }),
      deps,
    );
    expect(forged.status).toBe(400);
    const actual = await handleRemoteMcpConsentGet(
      new Request(resumedUrl, {
        headers: { cookie: browserSessionCookie },
      }),
      deps,
    );
    expect(actual.status, await actual.clone().text()).toBe(200);
    expect(actual.headers.get("set-cookie")).toContain("Max-Age=0");
    const rendered = await actual.text();
    expect(rendered).toContain("Trusted Test Client");
    expect(rendered).toContain("review:read");
    const replay = await handleRemoteMcpConsentGet(
      new Request(resumedUrl, {
        headers: { cookie: browserSessionCookie },
      }),
      deps,
    );
    expect(replay.status).toBe(400);
    const authorizationId = rendered.match(/name="authorization_id" value="([a-f0-9-]+)"/u)?.[1];
    const csrf = rendered.match(/name="csrf" value="([A-Za-z0-9_-]+)"/u)?.[1];
    const decision = await handleRemoteMcpConsentPost(
      new Request(`${issuer}/oauth/authorize`, {
        method: "POST",
        headers: {
          cookie: `brops_session=${signedSession}`,
          origin: issuer,
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          authorization_id: required(authorizationId),
          csrf: required(csrf),
          decision: "approve",
        }),
      }),
      deps,
    );
    expect(decision.status).toBe(303);
    const location = new URL(required(decision.headers.get("location")));
    expect(location.searchParams.get("state")).toBe(state);
    expect(location.searchParams.get("iss")).toBe(issuer);
    expect(location.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
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
      activeGrant: (jti, id, client, scope, tokenIssuer) =>
        isRemoteMcpGrantActive(executor(), jti, id, client, tokenIssuer, scope),
    });
    const request = new Request(remoteMcpResource, { headers: { authorization: `Bearer ${token?.access_token}` } });
    const authenticated = await authenticateRemoteMcpRequest(request, issuer, jwtVerifier);
    expect(authenticated?.githubUserId).toBe(githubUserId);
    expect(authenticated?.scopes).toEqual(["review:read"]);
    expect(await revokeRemoteMcpGrant(executor(), required(authenticated).grantId, githubUserId + 1)).toBe(false);
    expect(await revokeRemoteMcpGrant(executor(), required(authenticated).grantId, githubUserId)).toBe(true);
    expect(await authenticateRemoteMcpRequest(request, issuer, jwtVerifier)).toBeNull();
  });

  it("binds a signed token scope to the exact persisted grant scope, denying scope escalation", async () => {
    const started = await consent({ scope: "evidence:read" });
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    const exchanged = await exchangeRemoteMcpAuthorizationCode(
      executor(),
      {
        code: required(required(approved).code),
        clientId,
        redirectUri,
        codeVerifier: verifier,
      },
      issuer,
      tokenIssuer.sign,
    );
    const verifierWithDb = createRemoteMcpJwtVerifier({
      issuer,
      verifyKey: createLocalJWKSet((await tokenIssuer.publicJwks()) as never),
      activeGrant: (jti, id, client, scope, signedIssuer) =>
        isRemoteMcpGrantActive(executor(), jti, id, client, signedIssuer, scope),
    });
    const genuine = new Request(remoteMcpResource, {
      headers: { authorization: `Bearer ${required(exchanged).access_token}` },
    });
    const validPrincipal = await authenticateRemoteMcpRequest(genuine, issuer, verifierWithDb);
    expect(validPrincipal?.scopes).toEqual(["evidence:read"]);
    const grantId = required(validPrincipal).grantId;
    expect(await isRemoteMcpGrantActive(executor(), grantId, githubUserId, clientId, issuer, "review:read")).toBe(
      false,
    );
    const now = Math.floor(Date.now() / 1000);
    const elevated = await tokenIssuer.sign({
      githubUserId,
      clientId,
      scope: "review:read",
      jti: grantId,
      issuedAt: now,
      expiresAt: now + 600,
    });
    const elevatedRequest = new Request(remoteMcpResource, {
      headers: { authorization: `Bearer ${elevated}` },
    });
    expect(await authenticateRemoteMcpRequest(elevatedRequest, issuer, verifierWithDb)).toBeNull();
    const deniedMcp = await handleRemoteMcpWithVerifiedGrant(elevatedRequest, {
      issuer,
      verifier: verifierWithDb,
      openDb: vi.fn(),
      checkCurrentPermission: vi.fn(),
    });
    expect(deniedMcp.status).toBe(401);
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
      const beforeRevocation = await executor().query(
        `select jti from remote_mcp_oauth_grants where client_id = $1 and revoked_at is null and expires_at > now() limit 1`,
        [clientId],
      );
      const activeId = (beforeRevocation as { rows: { jti: string }[] }).rows[0]?.jti;
      if (activeId)
        expect(await isRemoteMcpGrantActive(executor(), activeId, githubUserId, clientId, issuer, "review:read")).toBe(
          false,
        );
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

  it("renders live user-bound HTML consent and exchanges its one-use approval code", async () => {
    const sessionSecret = "local-test-secret".repeat(4);
    const signedSession = encodeUserSession(
      {
        userId: githubUserId,
        login: "test-user",
        installationIds: [],
        issuedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      sessionSecret,
    );
    const cookie = `brops_session=${signedSession}`;
    const consentParams = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: randomUUID(),
      scope: "review:read",
      resource: remoteMcpResource,
    });
    const deps = {
      issuer,
      sessionSecret,
      openDb: async () => ({
        query: executor().query,
        close: async () => undefined,
      }),
    };
    const page = await handleRemoteMcpConsentGet(
      new Request(`${issuer}/oauth/authorize?${consentParams}`, {
        headers: { cookie },
      }),
      deps,
    );
    const rendered = await page.text();
    expect(page.status, rendered).toBe(200);
    expect(rendered).toContain("Trusted Test Client");
    const authorizationId = rendered.match(/name="authorization_id" value="([a-f0-9-]+)"/u)?.[1];
    const csrf = rendered.match(/name="csrf" value="([A-Za-z0-9_-]+)"/u)?.[1];
    expect(authorizationId).toBeTruthy();
    expect(csrf).toBeTruthy();
    const body = new URLSearchParams({
      authorization_id: required(authorizationId),
      csrf: required(csrf),
      decision: "approve",
    });
    const response = await handleRemoteMcpConsentPost(
      new Request(`${issuer}/oauth/authorize`, {
        method: "POST",
        headers: {
          cookie,
          origin: issuer,
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      }),
      deps,
    );
    expect(response.status).toBe(303);
    const redirect = new URL(required(response.headers.get("location")));
    expect(redirect.origin).toBe("https://trusted.example");
    expect(redirect.searchParams.get("state")).toBe(consentParams.get("state"));
    const code = required(redirect.searchParams.get("code"));
    const result = await exchangeRemoteMcpAuthorizationCode(
      executor(),
      {
        code,
        clientId,
        redirectUri,
        codeVerifier: verifier,
      },
      issuer,
      tokenIssuer.sign,
    );
    expect(result?.token_type).toBe("Bearer");
    expect(
      await exchangeRemoteMcpAuthorizationCode(
        executor(),
        {
          code,
          clientId,
          redirectUri,
          codeVerifier: verifier,
        },
        issuer,
        tokenIssuer.sign,
      ),
    ).toBeNull();
  });

  it("enforces a shared PostgreSQL rate cap across concurrent authorization requests", async () => {
    const unique = randomUUID();
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => takeRemoteMcpOAuthRateLimit(executor(), "consent-user", unique, 5)),
    );
    expect(outcomes.filter((value) => value.allowed)).toHaveLength(5);
    expect(outcomes.filter((value) => !value.allowed)).toHaveLength(7);
    expect(outcomes.every((value) => value.retryAfterSeconds >= 1 && value.retryAfterSeconds <= 60)).toBe(true);
    const raw = await executor().query("select attempts from remote_mcp_oauth_rate_limits where bucket_sha256 = $1", [
      oauthClientDigest(`consent-user:${unique}`),
    ]);
    expect(Number((raw as { rows: { attempts: number }[] }).rows[0]?.attempts)).toBe(12);
  });

  it("persists redacted OAuth audit history and removes expired records safely", async () => {
    const marker = randomUUID();
    await recordRemoteMcpOAuthEvent(executor(), "token_rejected", githubUserId, marker);
    const audits = await executor().query(
      "select event_kind, github_user_id, client_sha256 from remote_mcp_oauth_security_events where client_sha256 = $1",
      [oauthClientDigest(marker)],
    );
    const row = (audits as { rows: Array<{ event_kind: string; github_user_id: string; client_sha256: string }> })
      .rows[0];
    expect(row?.event_kind).toBe("token_rejected");
    expect(Number(row?.github_user_id)).toBe(githubUserId);
    expect(row?.client_sha256).not.toContain(marker);
    await purgeExpiredRemoteMcpOAuthSecurityData(executor());
  });

  it("connects real PostgreSQL OAuth grant to MCP v2 tools, denies removed permission and revoked token", async () => {
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    const exchanged = await exchangeRemoteMcpAuthorizationCode(
      executor(),
      {
        code: required(required(approved).code),
        clientId,
        redirectUri,
        codeVerifier: verifier,
      },
      issuer,
      tokenIssuer.sign,
    );
    const token = required(exchanged).access_token;
    const jwtVerifier = createRemoteMcpJwtVerifier({
      issuer,
      verifyKey: createLocalJWKSet((await tokenIssuer.publicJwks()) as never),
      activeGrant: (jti, id, client, scope, signedIssuer) =>
        isRemoteMcpGrantActive(executor(), jti, id, client, signedIssuer, scope),
    });
    const reviewId = randomUUID();
    const report = {
      id: reviewId,
      repository_id: "private-database-id",
      head_run_id: "run-1",
      current_revision_id: "revision-1",
      status: "active",
      decision: "pending",
      owner: "private-owner",
      name: "private-repository",
      github_repo_id: "456",
      github_installation_id: "789",
    };
    const sql = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes("from reviews")) return { rows: [report] };
      if (query.includes("from review_revisions"))
        return {
          rows: [{ head_commit_sha: "a".repeat(40), evidence_digest: "b".repeat(64) }],
        };
      throw new Error("unexpected query");
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const openDb = vi.fn().mockResolvedValue({ query: sql, close });
    const checkCurrentPermission = vi.fn().mockResolvedValue(true);
    const config = { issuer, verifier: jwtVerifier, openDb, checkCurrentPermission };
    const request = (method: string, args: Record<string, unknown> = {}) =>
      new Request(remoteMcpResource, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "Mcp-Protocol-Version": "2026-07-28",
          "Mcp-Method": method,
          ...(method === "tools/call" ? { "Mcp-Name": "boardreadyops_review_get" } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...args,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": { name: "pg-test", version: "1" },
            },
          },
        }),
      });
    const listed = await handleRemoteMcpWithVerifiedGrant(request("tools/list"), config);
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain("boardreadyops_review_get");
    expect(openDb).not.toHaveBeenCalled();

    const call = request("tools/call", { name: "boardreadyops_review_get", arguments: { reviewId } });
    const allowed = await handleRemoteMcpWithVerifiedGrant(call, config);
    const allowedBody = await allowed.text();
    expect(allowed.status, allowedBody).toBe(200);
    expect(allowedBody).toContain("not-evaluated");
    expect(allowedBody).toContain("evidenceDigest");
    expect(allowedBody).not.toContain("private-owner");
    expect(allowedBody).not.toContain("private-database-id");
    expect(checkCurrentPermission).toHaveBeenCalledWith({
      githubUserId,
      githubRepositoryId: 456,
      githubInstallationId: 789,
      owner: "private-owner",
      name: "private-repository",
    });

    checkCurrentPermission.mockResolvedValue(false);
    const denied = await handleRemoteMcpWithVerifiedGrant(
      request("tools/call", { name: "boardreadyops_review_get", arguments: { reviewId } }),
      config,
    );
    const deniedBody = await denied.text();
    expect(denied.status, deniedBody).toBe(200);
    expect(deniedBody).toContain("Review unavailable");
    expect(deniedBody).not.toContain("private-owner");
    expect(deniedBody).not.toContain("evidenceDigest");
    expect(close).toHaveBeenCalledTimes(2);

    const grant = await authenticateRemoteMcpRequest(request("tools/list"), issuer, jwtVerifier);
    expect(grant).not.toBeNull();
    expect(await revokeRemoteMcpGrant(executor(), required(grant).grantId, githubUserId)).toBe(true);
    const revoked = await handleRemoteMcpWithVerifiedGrant(request("tools/list"), config);
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    expect(openDb).toHaveBeenCalledTimes(2);
  });

  it("uses the production-shaped offline-JWKS adapter against durable PostgreSQL grants and current repository access", async () => {
    const origin = "https://boardreadyops.com";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signing = createRemoteMcpTokenIssuer({
      issuer: origin,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      keyId: "production-pg-local-key",
    });
    const started = await consent();
    const approved = await decideRemoteMcpConsent(
      executor(),
      githubUserId,
      started.authorizationId,
      started.csrfNonce,
      true,
    );
    const exchanged = await exchangeRemoteMcpAuthorizationCode(
      executor(),
      {
        code: required(required(approved).code),
        clientId,
        redirectUri,
        codeVerifier: verifier,
      },
      origin,
      signing.sign,
    );
    const token = required(exchanged).access_token;
    const reviewId = randomUUID();
    const livePermission = vi.fn().mockResolvedValue(true);
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockImplementation((sql: string, values?: readonly unknown[]) => {
      if (sql.includes("from reviews"))
        return Promise.resolve({
          rows: [
            {
              id: reviewId,
              repository_id: "private-internal",
              head_run_id: "run-1",
              current_revision_id: "revision-1",
              status: "active",
              decision: "pending",
              owner: "sensitive-owner",
              name: "sensitive-repository",
              github_repo_id: "456",
              github_installation_id: "789",
            },
          ],
        });
      if (sql.includes("from review_revisions"))
        return Promise.resolve({
          rows: [
            {
              head_commit_sha: "a".repeat(40),
              evidence_digest: "b".repeat(64),
            },
          ],
        });
      return executor().query(sql, values);
    });
    const openDb = vi.fn().mockImplementation(async () => ({ query, close }));
    const handler = prepareRemoteMcpProductionHandler({
      issuer: origin,
      publicJwks: await signing.publicJwks(),
      openDb,
      checkCurrentPermission: livePermission,
    });
    expect(handler).not.toBeNull();
    if (!handler) throw new Error("Offline OAuth adapter was not created");
    const request = (method: string, args: Record<string, unknown> = {}) =>
      new Request(remoteMcpResource, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "Mcp-Protocol-Version": "2026-07-28",
          "Mcp-Method": method,
          ...(method === "tools/call" ? { "Mcp-Name": "boardreadyops_review_get" } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...args,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": { name: "pg-acceptance", version: "1" },
            },
          },
        }),
      });
    const listed = await handler(request("tools/list"));
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain("boardreadyops_review_get");
    expect(livePermission).not.toHaveBeenCalled();
    const allowed = await handler(
      request("tools/call", {
        name: "boardreadyops_review_get",
        arguments: { reviewId },
      }),
    );
    const result = await allowed.text();
    expect(allowed.status, result).toBe(200);
    expect(result).toContain("not-evaluated");
    expect(result).not.toContain("sensitive-owner");
    expect(livePermission).toHaveBeenCalledOnce();
    livePermission.mockResolvedValue(false);
    const denied = await handler(
      request("tools/call", {
        name: "boardreadyops_review_get",
        arguments: { reviewId },
      }),
    );
    expect(await denied.text()).toContain("Review unavailable");
    expect(livePermission).toHaveBeenCalledTimes(2);
    const grantRow = await executor().query(
      "select jti from remote_mcp_oauth_grants where issuer = $1 and client_id = $2 and github_user_id = $3 and revoked_at is null order by created_at desc limit 1",
      [origin, clientId, githubUserId],
    );
    const grantId = (grantRow as { rows: { jti: string }[] }).rows[0]?.jti;
    expect(grantId).toBeTruthy();
    expect(await revokeRemoteMcpGrant(executor(), required(grantId), githubUserId)).toBe(true);
    const revoked = await handler(request("tools/list"));
    expect(revoked.status).toBe(401);
    expect(query.mock.calls.filter(([sql]) => sql.includes("remote_mcp_oauth_grants"))).toHaveLength(4);
    expect(close).toHaveBeenCalledTimes(6);
  });

  it("announces only supported discovery features, not dynamic registration", () => {
    const metadata = remoteMcpAuthorizationServerMetadata(issuer);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(metadata).not.toHaveProperty("registration_endpoint");
    expect(remoteMcpOauthLifetime).toEqual({ consentSeconds: 600, codeSeconds: 90, accessTokenSeconds: 900 });
  });
});
