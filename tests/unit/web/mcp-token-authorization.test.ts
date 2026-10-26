import { afterEach, describe, expect, it } from "vitest";
import { GET as pathAwareMetadata } from "../../../apps/web/app/.well-known/oauth-protected-resource/mcp/route.js";
import { GET as resourceMetadata } from "../../../apps/web/app/.well-known/oauth-protected-resource/route.js";
import {
  authenticateMcpOAuthToken,
  MCP_RESOURCE_URI,
  principalFromVerifiedMcpClaims,
  resolveMcpOauthConfiguration,
} from "../../../apps/web/lib/mcp-token-authorization.js";

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

  it("refuses to publish resource metadata without BOTH trusted issuer and explicit opt-in", () => {
    process.env.BOARDREADYOPS_MCP_OAUTH_ISSUER = "https://idp.example";
    process.env.BOARDREADYOPS_MCP_OAUTH_JWKS_URI = "https://idp.example/jwks";
    expect(resourceMetadata().status).toBe(404);
    process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED = "true";
    expect(resourceMetadata().status).toBe(200);
  });

  it("serves the same metadata from the RFC 9728 path-aware URL for /mcp", async () => {
    process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED = "true";
    process.env.BOARDREADYOPS_MCP_OAUTH_ISSUER = "https://idp.example";
    process.env.BOARDREADYOPS_MCP_OAUTH_JWKS_URI = "https://idp.example/jwks";
    expect(await pathAwareMetadata().json()).toEqual(await resourceMetadata().json());
  });

  it("includes only the canonical MCP resource and read scope in discovery", async () => {
    process.env.BOARDREADYOPS_MCP_REMOTE_ENABLED = "true";
    process.env.BOARDREADYOPS_MCP_OAUTH_ISSUER = "https://idp.example";
    process.env.BOARDREADYOPS_MCP_OAUTH_JWKS_URI = "https://idp.example/jwks";
    const response = resourceMetadata();
    expect(await response.json()).toEqual({
      resource: MCP_RESOURCE_URI,
      authorization_servers: ["https://idp.example"],
      scopes_supported: ["reviews:read"],
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
