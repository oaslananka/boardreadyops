import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as pathAwareMetadata } from "../../../apps/web/app/.well-known/oauth-protected-resource/mcp/route.js";
import { GET as resourceMetadata } from "../../../apps/web/app/.well-known/oauth-protected-resource/route.js";
import {
  authenticateMcpOAuthToken,
  MCP_RESOURCE_URI,
  principalFromVerifiedMcpClaims,
  resolveMcpOauthConfiguration,
} from "../../../apps/web/lib/mcp-token-authorization.js";
import { protectedResourceMetadata } from "../../../apps/web/lib/remote-mcp-foundation.js";

const repo = "00000000-0000-4000-8000-000000000111";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED;
  delete process.env.BOARDREADYOPS_MCP_OAUTH_ISSUER;
  delete process.env.BOARDREADYOPS_MCP_OAUTH_JWKS_URI;
});

describe("MCP OAuth protected-resource boundary", () => {
  it("refuses missing/insecure/cross-origin JWKS configuration instead of advertising a fake auth flow", () => {
    expect(resolveMcpOauthConfiguration({})).toBeUndefined();
    expect(
      resolveMcpOauthConfiguration({
        BOARDREADYOPS_MCP_OAUTH_ISSUER: "http://idp.example",
        BOARDREADYOPS_MCP_OAUTH_JWKS_URI: "http://idp.example/jwks",
      }),
    ).toBeUndefined();
    expect(
      resolveMcpOauthConfiguration({
        BOARDREADYOPS_MCP_OAUTH_ISSUER: "https://idp.example",
        BOARDREADYOPS_MCP_OAUTH_JWKS_URI: "https://attacker.test/jwks",
      }),
    ).toBeUndefined();
    expect(
      resolveMcpOauthConfiguration({
        BOARDREADYOPS_MCP_OAUTH_ISSUER: "https://idp.example",
        BOARDREADYOPS_MCP_OAUTH_JWKS_URI: "https://idp.example/jwks",
      }),
    ).toEqual({
      issuer: "https://idp.example",
      jwksUri: "https://idp.example/jwks",
    });
    expect(
      resolveMcpOauthConfiguration({
        BOARDREADYOPS_MCP_OAUTH_ISSUER: "https://idp.example/oauth/",
        BOARDREADYOPS_MCP_OAUTH_JWKS_URI: "https://idp.example/jwks",
      }),
    ).toEqual({
      issuer: "https://idp.example/oauth/",
      jwksUri: "https://idp.example/jwks",
    });
  });

  it("keeps both discovery aliases unavailable when the legacy external-IDP switch is set", async () => {
    process.env.BOARDREADYOPS_MCP_OAUTH_ISSUER = "https://idp.example";
    process.env.BOARDREADYOPS_MCP_OAUTH_JWKS_URI = "https://idp.example/jwks";
    process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED = "true";
    const root = resourceMetadata();
    const nested = pathAwareMetadata();
    expect(root.status).toBe(503);
    expect(nested.status).toBe(503);
    expect(await root.json()).toEqual(await nested.json());
  });

  it("constructs a single canonical issuer for root and path-aware discovery only after approved OAuth config", () => {
    expect(protectedResourceMetadata("https://boardreadyops.com")).toEqual({
      resource: MCP_RESOURCE_URI,
      authorization_servers: ["https://boardreadyops.com"],
      scopes_supported: ["review:read", "evidence:read"],
      bearer_methods_supported: ["header"],
    });
  });

  it("rejects repository/wrong-use claims without a repository-scoped access principal", () => {
    for (const bad of [
      {},
      { sub: "user", scope: "reviews:read" },
      { sub: "user", repository_id: "other", scope: "reviews:read" },
      { sub: "user", repository_id: repo, scope: "reviews:write" },
      { sub: "user", repository_id: repo, scope: "reviews:read", token_use: "refresh" },
    ])
      expect(principalFromVerifiedMcpClaims(bad)).toBeUndefined();
    expect(
      principalFromVerifiedMcpClaims({
        sub: "github:123",
        repository_id: repo,
        scope: "reviews:read",
        token_use: "access",
      }),
    ).toEqual({
      ok: true,
      authType: "bearer_token",
      repositoryId: repo,
      actorId: "oauth:github:123",
      scopes: ["reviews:read"],
    });
  });

  it("rejects malformed bearer tokens without contacting any JWKS endpoint", async () => {
    const result = await authenticateMcpOAuthToken("not-a-jwt", {
      issuer: "https://idp.example",
      jwksUri: "https://idp.example/jwks",
    });
    expect(result).toBeUndefined();
  });

  it("cryptographically verifies only the intended signed JWT issuer, audience, algorithm, and lifetime", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "mcp-jwt-test", alg: "RS256", use: "sig" };
    const fetchJwks = vi.fn(
      async () =>
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchJwks);
    const configuration = { issuer: "https://idp.example/oauth/", jwksUri: "https://idp.example/test-jwks-rs256" };
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: "github:123", repository_id: repo, scope: "reviews:read", token_use: "access" };
    const sign = async (
      payload: Record<string, unknown>,
      issuer = configuration.issuer,
      audience = MCP_RESOURCE_URI,
      issuedAt = now,
      expiresAt = now + 300,
    ) =>
      new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: "mcp-jwt-test" })
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .setIssuer(issuer)
        .setAudience(audience)
        .sign(privateKey);

    const verified = await authenticateMcpOAuthToken(await sign(claims), configuration);
    expect(verified).toEqual({
      ok: true,
      authType: "bearer_token",
      repositoryId: repo,
      actorId: "oauth:github:123",
      scopes: ["reviews:read"],
    });
    expect(fetchJwks).toHaveBeenCalledTimes(1);

    for (const invalidToken of [
      await sign(claims, "https://idp.example/oauth"),
      await sign(claims, configuration.issuer, "https://other.example/mcp"),
      await sign(claims, configuration.issuer, MCP_RESOURCE_URI, now - 3600, now - 600),
      await sign(claims, configuration.issuer, MCP_RESOURCE_URI, now - 1200, now + 300),
      await sign({ repository_id: repo, scope: "reviews:read", token_use: "access" }),
      await sign({ ...claims, scope: "reviews:write" }),
    ]) {
      expect(await authenticateMcpOAuthToken(invalidToken, configuration)).toBeUndefined();
    }

    const hs256 = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setIssuer(configuration.issuer)
      .setAudience(MCP_RESOURCE_URI)
      .sign(new TextEncoder().encode("untrusted-hmac-test-key"));
    expect(await authenticateMcpOAuthToken(hs256, configuration)).toBeUndefined();

    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = [
      b64({ alg: "none", typ: "JWT" }),
      b64({ ...claims, iss: configuration.issuer, aud: MCP_RESOURCE_URI, iat: now, exp: now + 300 }),
      "",
    ].join(".");
    expect(await authenticateMcpOAuthToken(unsigned, configuration)).toBeUndefined();
  });
});
