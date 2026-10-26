import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as jwksGet } from "../../../apps/web/app/.well-known/jwks.json/route.js";
import { GET as authorizationMetadataGet } from "../../../apps/web/app/.well-known/oauth-authorization-server/route.js";
import { GET as resourceMetadataGet } from "../../../apps/web/app/.well-known/oauth-protected-resource/mcp/route.js";
import { GET as consentRouteGet } from "../../../apps/web/app/oauth/authorize/route.js";
import { POST as tokenRoutePost } from "../../../apps/web/app/oauth/token/route.js";
import {
  handleRemoteMcpConsentGet,
  handleRemoteMcpConsentPost,
} from "../../../apps/web/lib/remote-mcp-consent-http.js";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";
import { configuredRemoteMcpOAuth } from "../../../apps/web/lib/remote-mcp-oauth-config.js";
import { encodeUserSession } from "../../../apps/web/lib/user-session.js";

const issuer = "https://boardreadyops.com";
const sessionSecret = "s".repeat(48);
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector/oauth/callback";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const signedCookie = encodeUserSession(
  {
    userId: 123,
    login: "legitimate-user",
    installationIds: [],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  sessionSecret,
);

function consentUrl(): string {
  const url = new URL("/oauth/authorize", issuer);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-value-12345",
    scope: "review:read",
    resource: remoteMcpResource,
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

function cookieHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `brops_session=${signedCookie}`, ...extra };
}

function database(queries: unknown[] = []) {
  const results = [...queries];
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("remote_mcp_oauth_rate_limits")) return { rows: [{ attempts: 1, retry_after: 60 }] };
    if (sql.includes("remote_mcp_oauth_security_events") && !sql.includes("remote_mcp_oauth_authorizations")) {
      return { rows: [] };
    }
    return { rows: results.shift() ?? [] };
  });
  const close = vi.fn().mockResolvedValue(undefined);
  return { query, close };
}
function deps(db: ReturnType<typeof database>) {
  return { issuer, sessionSecret, openDb: vi.fn().mockResolvedValue(db) };
}

function streamingConsentRequest(chunks: Uint8Array[], length?: string, onCancel?: () => void): Request {
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next === chunks.length) controller.close();
      else controller.enqueue(chunks[next++] as Uint8Array);
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Request(`${issuer}/oauth/authorize`, {
    method: "POST",
    headers: cookieHeaders({
      origin: issuer,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      ...(length === undefined ? {} : { "content-length": length }),
    }),
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("Remote MCP browser consent security boundary", () => {
  it("preserves an unsigned user's OAuth request behind a short cookie-bound GitHub login resume", async () => {
    const store = database([[{ id: "created" }]]);
    const config = deps(store);
    const result = await handleRemoteMcpConsentGet(
      new Request(consentUrl(), { headers: { "x-boardreadyops-verified-client-ip": "192.0.2.10" } }),
      config,
    );
    expect(result.status).toBe(401);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await result.text();
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("resume%3D");
    expect(html).not.toContain("client_id%3D");
    const cookie = result.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("brops_mcp_login_resume=");
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(cookie).not.toContain("state-value-12345");
    expect(cookie).not.toContain(clientId);
    expect(store.query.mock.calls.some(([sql]) => sql.includes("remote_mcp_oauth_login_resumptions"))).toBe(true);
    expect(store.query.mock.calls.some(([sql]) => sql.includes("remote_mcp_oauth_authorizations"))).toBe(false);
    expect(store.close).toHaveBeenCalledOnce();
  });

  it("fails closed without Caddy's verified source and never trusts a supplied forwarded-for value", async () => {
    const store = database();
    const result = await handleRemoteMcpConsentGet(
      new Request(consentUrl(), { headers: { "x-forwarded-for": "192.0.2.10" } }),
      deps(store),
    );
    expect(result.status).toBe(503);
    expect(store.query).not.toHaveBeenCalled();
  });

  it("limits one anonymous source before allowing it to consume the shared sign-in budget", async () => {
    const store = database();
    store.query.mockImplementation(async (sql: string) => {
      if (sql.includes("remote_mcp_oauth_rate_limits")) return { rows: [{ attempts: 13, retry_after: 37 }] };
      return { rows: [] };
    });
    const response = await handleRemoteMcpConsentGet(
      new Request(consentUrl(), { headers: { "x-boardreadyops-verified-client-ip": "2001:db8::1" } }),
      deps(store),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(store.query.mock.calls.filter(([sql]) => sql.includes("remote_mcp_oauth_rate_limits"))).toHaveLength(1);
  });

  it("shows only escaped registered client details and requested read-only scopes", async () => {
    const store = database([
      [
        {
          client_id: clientId,
          redirect_uri: redirectUri,
          registration_epoch: "123e4567-e89b-42d3-a456-426614174000",
          display_name: '<img src=x onerror="bad()">',
        },
      ],
      [{ id: "saved" }],
    ]);
    const response = await handleRemoteMcpConsentGet(
      new Request(consentUrl(), { headers: cookieHeaders() }),
      deps(store),
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self' https://chatgpt.com");
    expect(response.headers.get("content-security-policy")).not.toContain("evil.example");
    expect(html).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("https://chatgpt.com");
    expect(html).toContain("review:read");
    expect(html).not.toContain(signedCookie);
    expect(html).toContain('method="post"');
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="deny"');
    expect(html).toContain('href="/oauth/connections"');
    expect(store.query.mock.calls.find(([sql]) => sql.includes("remote_mcp_oauth_clients"))?.[1]).toEqual([
      clientId,
      redirectUri,
    ]);
    expect(store.query.mock.calls.some(([sql]) => sql.includes("remote_mcp_oauth_authorizations"))).toBe(true);
    expect(store.query.mock.calls.some(([sql]) => sql.includes("remote_mcp_oauth_security_events"))).toBe(true);
    expect(store.close).toHaveBeenCalledOnce();
  });

  it("rejects duplicate OAuth URL fields and unapproved clients without inserting", async () => {
    const store = database([[]]);
    const config = deps(store);
    const duplicate = new Request(`${consentUrl()}&client_id=${encodeURIComponent("https://evil.test/client")}`, {
      headers: cookieHeaders(),
    });
    const denied = await handleRemoteMcpConsentGet(duplicate, config);
    expect(denied.status).toBe(400);
    expect(config.openDb).not.toHaveBeenCalled();
    const unknown = await handleRemoteMcpConsentGet(new Request(consentUrl(), { headers: cookieHeaders() }), config);
    expect(unknown.status).toBe(400);
    expect(store.query.mock.calls.filter(([sql]) => sql.includes("remote_mcp_oauth_clients"))).toHaveLength(1);
  });

  it("refuses browser CSRF from a foreign origin, invalid session and duplicate decision fields", async () => {
    const store = database();
    const config = deps(store);
    const post = (origin: string, body: string, cookie = signedCookie) =>
      new Request(`${issuer}/oauth/authorize`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/x-www-form-urlencoded",
          cookie: `brops_session=${cookie}`,
          "sec-fetch-site": "same-origin",
        },
        body,
      });
    const fields = `authorization_id=123e4567-e89b-42d3-a456-426614174000&csrf=${"a".repeat(43)}&decision=approve`;
    expect((await handleRemoteMcpConsentPost(post("https://evil.example", fields), config)).status).toBe(403);
    expect((await handleRemoteMcpConsentPost(post(issuer, fields, "not-signed"), config)).status).toBe(401);
    expect((await handleRemoteMcpConsentPost(post(issuer, `${fields}&decision=deny`), config)).status).toBe(400);
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("rejects oversized chunked consent POST before any database or approval mutation", async () => {
    let canceled = false;
    const form = new TextEncoder().encode(
      `authorization_id=123e4567-e89b-42d3-a456-426614174000&csrf=${"a".repeat(43)}&decision=approve`,
    );
    const config = deps(database());
    const response = await handleRemoteMcpConsentPost(
      streamingConsentRequest([form, new Uint8Array(2049), new TextEncoder().encode("never-read")], "4", () => {
        canceled = true;
      }),
      config,
    );
    expect(response.status).toBe(400);
    expect(canceled).toBe(true);
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 and declared-size mismatches before querying consent tables", async () => {
    const config = deps(database());
    expect(
      (await handleRemoteMcpConsentPost(streamingConsentRequest([new Uint8Array([255, 254])]), config)).status,
    ).toBe(400);
    expect(
      (
        await handleRemoteMcpConsentPost(
          streamingConsentRequest([new TextEncoder().encode("decision=approve")], "1"),
          config,
        )
      ).status,
    ).toBe(400);
    expect(config.openDb).not.toHaveBeenCalled();
  });

  it("allows only an atomic approved decision from the authenticated user, returning 303", async () => {
    const store = database([[{ redirect_uri: redirectUri, state: "state-value-12345" }]]);
    const params = new URLSearchParams({
      authorization_id: "123e4567-e89b-42d3-a456-426614174000",
      csrf: "a".repeat(43),
      decision: "approve",
    });
    const request = new Request(`${issuer}/oauth/authorize`, {
      method: "POST",
      headers: cookieHeaders({
        origin: issuer,
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      }),
      body: params,
    });
    const response = await handleRemoteMcpConsentPost(request, deps(store));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://chatgpt.com");
    expect(location.searchParams.get("iss")).toBe(issuer);
    expect(location.searchParams.get("state")).toBe("state-value-12345");
    expect(location.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(store.query.mock.calls.find(([sql]) => sql.includes("remote_mcp_oauth_authorizations"))?.[1]?.[1]).toBe(123);
    expect(store.close).toHaveBeenCalledOnce();
  });
});

describe("Remote MCP metadata release hold", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps discovery, JWKS, consent and token routes closed without explicit feature gate", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED", "false");
    expect((await authorizationMetadataGet()).status).toBe(503);
    expect((await jwksGet()).status).toBe(503);
    expect((await resourceMetadataGet()).status).toBe(503);
    expect((await consentRouteGet(new Request(consentUrl()))).status).toBe(503);
    const token = new Request(`${issuer}/oauth/token`, { method: "POST" });
    expect((await tokenRoutePost(token)).status).toBe(503);
  });

  it("publishes matching OAuth resource, authorization server and PUBLIC JWKS only when fully configured", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const settings = {
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: issuer,
      BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      BOARDREADYOPS_REMOTE_MCP_KEY_ID: "release-key-one",
      DATABASE_URL: "postgresql://test.example/test",
      SESSION_SECRET: sessionSecret,
    };
    for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
    const resourceResponse = await resourceMetadataGet();
    const authResponse = await authorizationMetadataGet();
    const jwksResponse = await jwksGet();
    expect([resourceResponse.status, authResponse.status, jwksResponse.status]).toEqual([200, 200, 200]);
    const resource = (await resourceResponse.json()) as { resource: string; authorization_servers: string[] };
    const auth = (await authResponse.json()) as {
      issuer: string;
      jwks_uri: string;
      code_challenge_methods_supported: string[];
      authorization_response_iss_parameter_supported: boolean;
    };
    const keys = (await jwksResponse.json()) as { keys: Array<Record<string, unknown>> };
    expect(resource.resource).toBe(remoteMcpResource);
    expect(resource.authorization_servers).toEqual([issuer]);
    expect(auth.issuer).toBe(issuer);
    expect(auth.authorization_response_iss_parameter_supported).toBe(true);
    expect(auth.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
    expect(auth.code_challenge_methods_supported).toEqual(["S256"]);
    expect(keys.keys).toHaveLength(1);
    expect(keys.keys[0]?.alg).toBe("RS256");
    expect(keys.keys[0]?.kid).toBe("release-key-one");
    expect(keys.keys[0]).not.toHaveProperty("d");
    expect(keys.keys[0]).not.toHaveProperty("p");
    expect(keys.keys[0]).not.toHaveProperty("q");
  });

  it("requires valid production key, issuer, session secret and database for opt-in", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const environment = {
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: issuer,
      BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      BOARDREADYOPS_REMOTE_MCP_KEY_ID: "release-key-one",
      DATABASE_URL: "postgresql://test.example/test",
      SESSION_SECRET: sessionSecret,
    };
    expect(configuredRemoteMcpOAuth(environment)?.issuer).toBe(issuer);
    expect(
      configuredRemoteMcpOAuth({ ...environment, BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: "https://evil.example" }),
    ).toBeNull();
    expect(
      configuredRemoteMcpOAuth({ ...environment, BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: "not-a-key" }),
    ).toBeNull();
    expect(configuredRemoteMcpOAuth({ ...environment, SESSION_SECRET: "too-short" })).toBeNull();
    expect(configuredRemoteMcpOAuth({ ...environment, DATABASE_URL: "" })).toBeNull();
  });
});
