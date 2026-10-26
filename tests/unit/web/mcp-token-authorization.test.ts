import { afterEach, describe, expect, it } from "vitest";
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
});
