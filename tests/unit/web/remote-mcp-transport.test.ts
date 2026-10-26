import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { authenticateRemoteMcpRequest } from "../../../apps/web/lib/remote-mcp-access.js";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";
import { isRemoteMcpGrantActive, revokeRemoteMcpGrant } from "../../../apps/web/lib/remote-mcp-grant-store.js";
import {
  handleAuthorizedRemoteMcpHttp,
  handleRemoteMcpWithVerifiedGrant,
} from "../../../apps/web/lib/remote-mcp-http.js";
import {
  createProductionRemoteMcpJwtVerifier,
  createRemoteMcpJwtVerifier,
} from "../../../apps/web/lib/remote-mcp-jwt-verifier.js";

const issuer = "https://id.boardreadyops.com";
const clientId = "https://client.example/client.json";
const jti = "grant-12345678901234567890";
const reviewId = "123e4567-e89b-42d3-a456-426614174000";
const ghUser = 123;
const now = () => Math.floor(Date.now() / 1000);

function mcpRequest(method: string, params: object = {}, accessToken = "signed.jwt") {
  return new Request(remoteMcpResource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      "Mcp-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(method === "tools/call" ? { "Mcp-Name": "boardreadyops_review_get" } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
        },
      },
    }),
  });
}

describe("remote MCP durable grant checks", () => {
  it("matches authenticated user, client, resource and active revocation record every time", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ present: 1 }] }) };
    expect(await isRemoteMcpGrantActive(db as never, jti, ghUser, clientId, issuer, "review:read")).toBe(true);
    expect(db.query.mock.calls[0]?.[1]).toEqual([jti, ghUser, remoteMcpResource, clientId, issuer, "review:read"]);
    expect(db.query.mock.calls[0]?.[0]).toContain("g.scope = $6");
    expect(db.query.mock.calls[0]?.[0]).toContain("revoked_at is null");
    expect(db.query.mock.calls[0]?.[0]).toContain("c.enabled = true");
    expect(db.query.mock.calls[0]?.[0]).toContain("expires_at > now()");
    db.query.mockResolvedValue({ rows: [] });
    expect(await isRemoteMcpGrantActive(db as never, jti, ghUser, clientId, issuer, "review:read")).toBe(false);
    expect(await isRemoteMcpGrantActive(db as never, jti, ghUser, "", issuer, "review:read")).toBe(false);
    db.query.mockRejectedValue(new Error("db-down"));
    expect(await isRemoteMcpGrantActive(db as never, jti, ghUser, clientId, issuer, "review:read")).toBe(false);
  });

  it("revoke is scoped to current authenticated user and idempotent", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ jti }] }) };
    expect(await revokeRemoteMcpGrant(db as never, jti, ghUser)).toBe(true);
    expect(db.query.mock.calls[0]?.[1]).toEqual([jti, ghUser]);
    db.query.mockResolvedValue({ rows: [] });
    expect(await revokeRemoteMcpGrant(db as never, jti, ghUser)).toBe(false);
  });
});

describe("remote MCP signed-token verifier", () => {
  it("verifies an actual RS256 signature, issuer/audience/client binding, and rejects a tampered JWT", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const verifier = createRemoteMcpJwtVerifier({
      issuer,
      verifyKey: createLocalJWKSet({ keys: [{ ...jwk, kid: "test-1", alg: "RS256", use: "sig" }] }),
      activeGrant: vi.fn().mockResolvedValue(true),
    });
    const token = await new SignJWT({ scope: "review:read", githubUserId: ghUser, clientId })
      .setProtectedHeader({ alg: "RS256", kid: "test-1" })
      .setSubject(`github:${ghUser}`)
      .setIssuer(issuer)
      .setAudience(remoteMcpResource)
      .setJti(jti)
      .setIssuedAt(now())
      .setExpirationTime(now() + 600)
      .sign(privateKey);
    const request = mcpRequest("tools/list", {}, token);
    const principal = await authenticateRemoteMcpRequest(request, issuer, verifier);
    expect(principal).toEqual({ githubUserId: ghUser, grantId: jti, scopes: ["review:read"] });
    const [header, payload, signature] = token.split(".");
    expect(
      await authenticateRemoteMcpRequest(
        mcpRequest("tools/list", {}, `${header}.${payload}.${signature}a`),
        issuer,
        verifier,
      ),
    ).toBeNull();
    const badAud = await new SignJWT({ scope: "review:read", githubUserId: ghUser, clientId })
      .setProtectedHeader({ alg: "RS256", kid: "test-1" })
      .setSubject(`github:${ghUser}`)
      .setIssuer(issuer)
      .setAudience("https://wrong.example/mcp")
      .setJti(jti)
      .setIssuedAt(now())
      .setExpirationTime(now() + 600)
      .sign(privateKey);
    expect(await authenticateRemoteMcpRequest(mcpRequest("tools/list", {}, badAud), issuer, verifier)).toBeNull();
  });

  it("rejects untrusted JWKS origins or HTTP issuers", () => {
    const activeGrant = vi.fn().mockResolvedValue(true);
    expect(
      createProductionRemoteMcpJwtVerifier({
        issuer: "http://id.example",
        jwksUrl: "http://id.example/jwks.json",
        activeGrant,
      }),
    ).toBeNull();
    expect(
      createProductionRemoteMcpJwtVerifier({ issuer, jwksUrl: "https://evil.example/jwks.json", activeGrant }),
    ).toBeNull();
    expect(
      createProductionRemoteMcpJwtVerifier({
        issuer,
        jwksUrl: `${issuer}/api/attacker/jwks.json`,
        activeGrant,
      }),
    ).toBeNull();
    expect(
      createProductionRemoteMcpJwtVerifier({
        issuer: `${issuer}/not-an-origin`,
        jwksUrl: `${issuer}/.well-known/jwks.json`,
        activeGrant,
      }),
    ).toBeNull();
    expect(
      createProductionRemoteMcpJwtVerifier({
        issuer,
        jwksUrl: `${issuer}/.well-known/jwks.json?from=untrusted`,
        activeGrant,
      }),
    ).toBeNull();
    expect(
      createProductionRemoteMcpJwtVerifier({
        issuer,
        jwksUrl: `${issuer}/.well-known/jwks.json`,
        activeGrant,
      }),
    ).not.toBeNull();
  });
});

describe("MCP pre-authentication request-size and media guards", () => {
  function deniedWithoutGrantLookup(request: Request, expectedStatus: number) {
    const verifier = {
      verifySignedAccessToken: vi.fn(),
      grantIsActive: vi.fn(),
    };
    const openDb = vi.fn();
    const checkCurrentPermission = vi.fn();
    return handleRemoteMcpWithVerifiedGrant(request, {
      issuer,
      verifier,
      openDb,
      checkCurrentPermission,
    }).then((response) => {
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(verifier.verifySignedAccessToken).not.toHaveBeenCalled();
      expect(verifier.grantIsActive).not.toHaveBeenCalled();
      expect(openDb).not.toHaveBeenCalled();
      expect(checkCurrentPermission).not.toHaveBeenCalled();
    });
  }

  it.each([
    ["65537", 413],
    ["900719925474099999999", 413],
    ["-1", 400],
    ["-0", 400],
    ["NaN", 400],
    ["0001", 400],
    ["12.5", 400],
    ["123abc", 400],
  ] as const)(
    "denies advertised invalid or excessive POST Content-Length %s before JWT",
    async (length, expectedStatus) => {
      const req = mcpRequest("tools/list");
      req.headers.set("content-length", length);
      await deniedWithoutGrantLookup(req, expectedStatus);
    },
  );

  it.each([
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/json-patch+json",
    "application/json; charset=iso-8859-1",
  ])("denies unsupported POST Content-Type %s before JWT", async (media) => {
    const req = mcpRequest("tools/list");
    req.headers.set("content-type", media);
    await deniedWithoutGrantLookup(req, 415);
  });

  it.each(["application/json", "application/json; charset=utf-8", "APPLICATION/JSON; CHARSET=UTF-8"])(
    "preserves OAuth challenge for correctly typed but unauthenticated MCP POST %s",
    async (type) => {
      const request = mcpRequest("tools/list");
      request.headers.set("content-type", type);
      const verifier = { verifySignedAccessToken: vi.fn().mockResolvedValue(null), grantIsActive: vi.fn() };
      const openDb = vi.fn();
      const result = await handleRemoteMcpWithVerifiedGrant(request, {
        issuer,
        verifier,
        openDb,
        checkCurrentPermission: vi.fn(),
      });
      expect(result.status).toBe(401);
      expect(result.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
      expect(verifier.verifySignedAccessToken).toHaveBeenCalledOnce();
      expect(openDb).not.toHaveBeenCalled();
    },
  );

  it("denies POST requests missing Content-Type without verifying or querying a grant", async () => {
    const req = mcpRequest("tools/list");
    req.headers.delete("content-type");
    await deniedWithoutGrantLookup(req, 415);
  });

  it("keeps SDK stream enforcement at the same 64 KiB actual-body limit when length is absent", async () => {
    const request = new Request(remoteMcpResource, {
      method: "POST",
      headers: {
        authorization: "Bearer signed.jwt",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "Mcp-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1, params: { padding: "x".repeat(70_000) } }),
    });
    const verifier = {
      verifySignedAccessToken: vi.fn().mockResolvedValue({
        iss: issuer,
        aud: remoteMcpResource,
        sub: `github:${ghUser}`,
        jti,
        githubUserId: ghUser,
        clientId,
        scope: "review:read",
        iat: now(),
        exp: now() + 600,
      }),
      grantIsActive: vi.fn().mockResolvedValue(true),
    };
    const openDb = vi.fn();
    const result = await handleRemoteMcpWithVerifiedGrant(request, {
      issuer,
      verifier,
      openDb,
      checkCurrentPermission: vi.fn(),
    });
    expect(result.status).toBe(413);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(verifier.grantIsActive).toHaveBeenCalledOnce();
    expect(openDb).not.toHaveBeenCalled();
  });
});

describe("MCP v2 stateless web request boundary", () => {
  it("returns HTTP 401 and RFC9728 discovery on missing OAuth grant, before opening DB", async () => {
    const openDb = vi.fn();
    const request = mcpRequest("tools/list", {}, "old-api-token");
    const result = await handleRemoteMcpWithVerifiedGrant(request, {
      issuer,
      verifier: { verifySignedAccessToken: vi.fn().mockResolvedValue(null), grantIsActive: vi.fn() },
      openDb,
      checkCurrentPermission: vi.fn(),
    });
    expect(result.status).toBe(401);
    expect(result.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    expect(openDb).not.toHaveBeenCalled();
  });

  it("lists read-only Review tool over modern HTTP when pre-authorized", async () => {
    const openDb = vi.fn();
    const request = mcpRequest("tools/list");
    const result = await handleAuthorizedRemoteMcpHttp(
      request,
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb, checkCurrentPermission: vi.fn() },
    );
    const body = await result.text();
    expect(result.status, body).toBe(200);
    expect(body).toContain("boardreadyops_review_get");
    expect(body).not.toContain("run_shell");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(openDb).not.toHaveBeenCalled();
  });

  it("does not advertise or invoke Review tools for evidence-only OAuth grants", async () => {
    const openDb = vi.fn();
    const principal = { githubUserId: ghUser, grantId: jti, scopes: ["evidence:read"] };
    const config = { openDb, checkCurrentPermission: vi.fn() };
    const listed = await handleAuthorizedRemoteMcpHttp(mcpRequest("tools/list"), principal, config);
    const listing = await listed.text();
    expect([200, 404], listing).toContain(listed.status);
    expect(listing).not.toContain("boardreadyops_review_get");
    const called = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_get", arguments: { reviewId } }),
      principal,
      config,
    );
    const result = await called.text();
    expect(result).not.toContain('"schemaVersion":1');
    expect(openDb).not.toHaveBeenCalled();
  });

  it("returns only authorized review facts and closes the database for tools/call", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: reviewId,
            repository_id: "private-repo",
            head_run_id: "run-1",
            current_revision_id: "revision-1",
            status: "active",
            decision: "pending",
            owner: "secret-owner",
            name: "secret-board",
            github_repo_id: "456",
            github_installation_id: "789",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ head_commit_sha: "a".repeat(40), evidence_digest: "b".repeat(64) }] });
    const openDb = vi.fn().mockResolvedValue({ query, close });
    const checkCurrentPermission = vi.fn().mockResolvedValue(true);
    const response = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_get", arguments: { reviewId } }),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb, checkCurrentPermission },
    );
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("not-evaluated");
    expect(body).toContain("active");
    expect(body).not.toContain("secret-owner");
    expect(body).not.toContain("secret-board");
    expect(checkCurrentPermission).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not distinguish unauthorized and missing Review identifiers", async () => {
    const review = {
      id: reviewId,
      repository_id: "private-repo",
      head_run_id: "run-1",
      current_revision_id: "revision-1",
      status: "active",
      decision: "pending",
      owner: "secret-owner",
      name: "secret-board",
      github_repo_id: "456",
      github_installation_id: "789",
    };
    for (const rows of [[], [review]]) {
      const close = vi.fn().mockResolvedValue(undefined);
      const openDb = vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows }), close });
      const denied = await handleAuthorizedRemoteMcpHttp(
        mcpRequest("tools/call", { name: "boardreadyops_review_get", arguments: { reviewId } }),
        { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
        { openDb, checkCurrentPermission: vi.fn().mockResolvedValue(false) },
      );
      expect(denied.status).toBe(200);
      expect(await denied.text()).toContain("Review unavailable");
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("rejects untrusted browser origin even after token authentication", async () => {
    const request = new Request(remoteMcpResource, { headers: { origin: "https://evil.example" } });
    const response = await handleAuthorizedRemoteMcpHttp(
      request,
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb: vi.fn(), checkCurrentPermission: vi.fn() },
    );
    expect(response.status).toBe(403);
  });
});
