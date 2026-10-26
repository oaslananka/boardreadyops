import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";
import {
  prepareConfiguredRemoteMcpProductionHandler,
  prepareRemoteMcpProductionHandler,
} from "../../../apps/web/lib/remote-mcp-production.js";
import { createRemoteMcpTokenIssuer } from "../../../apps/web/lib/remote-mcp-token-issuer.js";

const issuer = "https://boardreadyops.com";
const clientId = "https://registered.example/oauth-client.json";
const userId = 123;
const reviewId = randomUUID();
type PreparedHandler = (request: Request) => Promise<Response>;
function requiredHandler(value: PreparedHandler | null): PreparedHandler {
  if (!value) throw new Error("Expected locally configured MCP handler");
  return value;
}

function issuerFixture() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const signing = createRemoteMcpTokenIssuer({ issuer, privateKeyPem, keyId: "active-2026-key" });
  return { signing, privateKeyPem };
}
function mcpRequest(method: string, token: string, args: Record<string, unknown> = {}) {
  return new Request(remoteMcpResource, {
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
          "io.modelcontextprotocol/clientInfo": { name: "production-composition-test", version: "1" },
        },
      },
    }),
  });
}

describe("production MCP request adapter is not publicly mounted", () => {
  it("requires explicit independent release flag, OAuth settings and App identity", async () => {
    const { privateKeyPem } = issuerFixture();
    const base = {
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
      BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: issuer,
      BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: privateKeyPem,
      BOARDREADYOPS_REMOTE_MCP_KEY_ID: "active-2026-key",
      DATABASE_URL: "postgresql://example.invalid/test",
      SESSION_SECRET: "S".repeat(48),
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PRIVATE_KEY: "local-fixture-not-a-live-key",
    };
    expect(await prepareConfiguredRemoteMcpProductionHandler(base)).toBeNull();
    expect(
      await prepareConfiguredRemoteMcpProductionHandler({
        ...base,
        BOARDREADYOPS_REMOTE_MCP_HANDLER_READY: "true",
        GITHUB_APP_PRIVATE_KEY: "",
      }),
    ).toBeNull();
    expect(
      await prepareConfiguredRemoteMcpProductionHandler({
        ...base,
        BOARDREADYOPS_REMOTE_MCP_HANDLER_READY: "true",
        BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "false",
      }),
    ).toBeNull();
    expect(
      typeof (await prepareConfiguredRemoteMcpProductionHandler({
        ...base,
        BOARDREADYOPS_REMOTE_MCP_HANDLER_READY: "true",
      })),
    ).toBe("function");
  });

  it("verifies RS256 via trusted local JWKS, checks grant every call, and never caches GitHub access", async () => {
    const { signing } = issuerFixture();
    const keys = await signing.publicJwks();
    const now = Math.floor(Date.now() / 1000);
    const jti = randomUUID();
    const token = await signing.sign({
      githubUserId: userId,
      clientId,
      scope: "review:read",
      jti,
      issuedAt: now,
      expiresAt: now + 600,
    });
    let active = true;
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("from remote_mcp_oauth_grants")) return { rows: active ? [{ present: 1 }] : [] };
      if (sql.includes("from reviews"))
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "private-repo-id",
              head_run_id: "run-1",
              current_revision_id: "revision-1",
              status: "active",
              decision: "pending",
              owner: "secret-owner",
              name: "secret-repo",
              github_repo_id: "456",
              github_installation_id: "789",
            },
          ],
        };
      if (sql.includes("from review_revisions"))
        return {
          rows: [
            {
              head_commit_sha: "a".repeat(40),
              evidence_digest: "b".repeat(64),
            },
          ],
        };
      throw new Error("unexpected SQL query");
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const openDb = vi.fn().mockResolvedValue({ query, close });
    const checkCurrentPermission = vi.fn().mockResolvedValue(true);
    const handler = requiredHandler(
      prepareRemoteMcpProductionHandler({ issuer, publicJwks: keys, openDb, checkCurrentPermission }),
    );
    const list = await handler(mcpRequest("tools/list", token));
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("boardreadyops_review_get");
    expect(query.mock.calls.filter(([sql]) => sql.includes("remote_mcp_oauth_grants"))).toHaveLength(1);
    expect(checkCurrentPermission).not.toHaveBeenCalled();

    const tool = await handler(
      mcpRequest("tools/call", token, {
        name: "boardreadyops_review_get",
        arguments: { reviewId },
      }),
    );
    const body = await tool.text();
    expect(tool.status, body).toBe(200);
    expect(body).toContain("not-evaluated");
    expect(body).not.toContain("secret-owner");
    expect(body).not.toContain("private-repo-id");
    expect(checkCurrentPermission).toHaveBeenCalledOnce();
    expect(openDb).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);

    checkCurrentPermission.mockResolvedValue(false);
    const denied = await handler(
      mcpRequest("tools/call", token, {
        name: "boardreadyops_review_get",
        arguments: { reviewId },
      }),
    );
    expect(await denied.text()).toContain("Review unavailable");
    expect(checkCurrentPermission).toHaveBeenCalledTimes(2);
    active = false;
    const revoked = await handler(mcpRequest("tools/list", token));
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    expect(openDb).toHaveBeenCalledTimes(6);
    expect(close).toHaveBeenCalledTimes(6);
  });

  it("rejects malicious public key sets and untrusted request origins before any database lookup", async () => {
    const { signing } = issuerFixture();
    const keys = await signing.publicJwks();
    const openDb = vi.fn();
    const checkCurrentPermission = vi.fn();
    const base = { issuer, publicJwks: keys, openDb, checkCurrentPermission };
    expect(prepareRemoteMcpProductionHandler({ ...base, issuer: "https://evil.example" })).toBeNull();
    expect(
      prepareRemoteMcpProductionHandler({ ...base, publicJwks: { keys: [{ ...keys.keys[0], d: "private-secret" }] } }),
    ).toBeNull();
    expect(
      prepareRemoteMcpProductionHandler({ ...base, publicJwks: { keys: [{ ...keys.keys[0], alg: "HS256" }] } }),
    ).toBeNull();
    const handler = requiredHandler(prepareRemoteMcpProductionHandler(base));
    const origin = await handler(
      new Request(remoteMcpResource, {
        method: "POST",
        headers: { origin: "https://evil.example", authorization: "Bearer unknown" },
      }),
    );
    expect(origin.status).toBe(403);
    const untrustedUrl = await handler(
      new Request(`${remoteMcpResource}?token=secret`, {
        method: "POST",
        headers: { authorization: "Bearer unknown" },
      }),
    );
    expect(untrustedUrl.status).toBe(403);
    expect(openDb).not.toHaveBeenCalled();
  });
});
