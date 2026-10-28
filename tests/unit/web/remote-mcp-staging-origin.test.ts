import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const productionOrigin = "https://boardreadyops.com";
const stagingOrigin = "https://staging.boardreadyops.com";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("remote MCP staging resource boundary", () => {
  it("preserves the production resource and metadata by default", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED", "false");
    vi.resetModules();
    const foundation = await import("../../../apps/web/lib/remote-mcp-foundation.js");
    expect(foundation.remoteMcpOrigin).toBe(productionOrigin);
    expect(foundation.remoteMcpResource).toBe(productionOrigin + "/mcp");
    expect(foundation.remoteMcpMetadataUrl).toBe(productionOrigin + "/.well-known/oauth-protected-resource/mcp");
  });

  it("binds staging metadata, tokens and HTTP to only the staging origin", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED", "true");
    vi.resetModules();
    const foundation = await import("../../../apps/web/lib/remote-mcp-foundation.js");
    const { createRemoteMcpTokenIssuer } = await import("../../../apps/web/lib/remote-mcp-token-issuer.js");
    const { createRemoteMcpJwtVerifier } = await import("../../../apps/web/lib/remote-mcp-jwt-verifier.js");
    const { authenticateRemoteMcpRequest } = await import("../../../apps/web/lib/remote-mcp-access.js");
    const { prepareRemoteMcpProductionHandler } = await import("../../../apps/web/lib/remote-mcp-production.js");
    const { createLocalJWKSet } = await import("jose");

    expect(foundation.remoteMcpOrigin).toBe(stagingOrigin);
    expect(foundation.remoteMcpResource).toBe(stagingOrigin + "/mcp");
    expect(foundation.protectedResourceMetadata(stagingOrigin)).toMatchObject({
      resource: stagingOrigin + "/mcp",
      authorization_servers: [stagingOrigin],
    });
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signing = createRemoteMcpTokenIssuer({
      issuer: stagingOrigin,
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      keyId: "staging-test-key",
    });
    const keys = await signing.publicJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signing.sign({
      githubUserId: 123,
      clientId: "registered-staging-client",
      scope: "review:read",
      jti: randomUUID(),
      issuedAt: now,
      expiresAt: now + 600,
    });
    const activeGrant = vi.fn().mockResolvedValue(true);
    const verifier = createRemoteMcpJwtVerifier({
      issuer: stagingOrigin,
      verifyKey: createLocalJWKSet(keys),
      activeGrant,
    });
    expect((await verifier.verifySignedAccessToken(token))?.aud).toBe(stagingOrigin + "/mcp");
    expect(
      (
        await authenticateRemoteMcpRequest(
          new Request(stagingOrigin + "/mcp", { headers: { authorization: "Bearer " + token } }),
          stagingOrigin,
          verifier,
        )
      )?.githubUserId,
    ).toBe(123);
    expect(activeGrant).toHaveBeenCalledTimes(1);
    expect(
      await authenticateRemoteMcpRequest(
        new Request(stagingOrigin + "/mcp", { headers: { authorization: "Bearer " + token } }),
        productionOrigin,
        verifier,
      ),
    ).toBeNull();

    const openDb = vi.fn();
    const opts = { issuer: stagingOrigin, publicJwks: keys, openDb, checkCurrentPermission: vi.fn() };
    expect(prepareRemoteMcpProductionHandler({ ...opts, issuer: productionOrigin })).toBeNull();
    const handler = prepareRemoteMcpProductionHandler(opts);
    expect(handler).not.toBeNull();
    if (!handler) throw new Error("Expected locally prepared staging handler");
    expect((await handler(new Request(productionOrigin + "/mcp"))).status).toBe(403);
    expect(
      (
        await handler(
          new Request(stagingOrigin + "/mcp", {
            headers: { origin: productionOrigin },
          }),
        )
      ).status,
    ).toBe(403);
    const unauthorized = await handler(new Request(stagingOrigin + "/mcp"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain(
      stagingOrigin + "/.well-known/oauth-protected-resource/mcp",
    );
    expect(openDb).not.toHaveBeenCalled();
  });

  it("requires a matching staging opt-in and exact issuer", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED", "true");
    vi.resetModules();
    const { configuredRemoteMcpOAuth } = await import("../../../apps/web/lib/remote-mcp-oauth-config.js");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const base = {
      BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED: "true",
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: stagingOrigin,
      BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      BOARDREADYOPS_REMOTE_MCP_KEY_ID: "staging-test-key",
      DATABASE_URL: "postgresql://invalid.example/testing",
      SESSION_SECRET: "S".repeat(48),
    };
    expect(configuredRemoteMcpOAuth(base)?.issuer).toBe(stagingOrigin);
    expect(configuredRemoteMcpOAuth({ ...base, BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED: "false" })).toBeNull();
    expect(configuredRemoteMcpOAuth({ ...base, BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED: "unexpected" })).toBeNull();
    expect(configuredRemoteMcpOAuth({ ...base, BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: productionOrigin })).toBeNull();
    expect(
      configuredRemoteMcpOAuth({ ...base, BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: "https://evil.example" }),
    ).toBeNull();
  });

  it("rejects a staging-only config injected into a production-mode process", async () => {
    vi.stubEnv("BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED", "false");
    vi.resetModules();
    const { configuredRemoteMcpOAuth } = await import("../../../apps/web/lib/remote-mcp-oauth-config.js");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(
      configuredRemoteMcpOAuth({
        BOARDREADYOPS_REMOTE_MCP_STAGING_ENABLED: "true",
        BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
        BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: stagingOrigin,
        BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        BOARDREADYOPS_REMOTE_MCP_KEY_ID: "staging-test-key",
        DATABASE_URL: "postgresql://invalid.example/testing",
        SESSION_SECRET: "S".repeat(48),
      }),
    ).toBeNull();
  });
});
