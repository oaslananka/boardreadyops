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
      ...(method === "tools/call"
        ? { "Mcp-Name": (params as { name?: string }).name ?? "boardreadyops_review_get" }
        : {}),
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
    expect(db.query.mock.calls[0]?.[0]).toContain("g.client_registration_epoch = c.registration_epoch");
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
      .setProtectedHeader({ alg: "RS256", kid: "test-1", typ: "at+jwt" })
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
      .setProtectedHeader({ alg: "RS256", kid: "test-1", typ: "at+jwt" })
      .setSubject(`github:${ghUser}`)
      .setIssuer(issuer)
      .setAudience("https://wrong.example/mcp")
      .setJti(jti)
      .setIssuedAt(now())
      .setExpirationTime(now() + 600)
      .sign(privateKey);
    expect(await authenticateRemoteMcpRequest(mcpRequest("tools/list", {}, badAud), issuer, verifier)).toBeNull();
    const multiAudience = await new SignJWT({ scope: "review:read", githubUserId: ghUser, clientId })
      .setProtectedHeader({ alg: "RS256", kid: "test-1", typ: "at+jwt" })
      .setSubject(`github:${ghUser}`)
      .setIssuer(issuer)
      .setAudience([remoteMcpResource, "https://second.example/resource"])
      .setJti(jti)
      .setIssuedAt(now())
      .setExpirationTime(now() + 600)
      .sign(privateKey);
    expect(
      await authenticateRemoteMcpRequest(mcpRequest("tools/list", {}, multiAudience), issuer, verifier),
    ).toBeNull();
  });

  it("rejects same-key non-access JWT types before consulting the durable grant", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const activeGrant = vi.fn().mockResolvedValue(true);
    const verifier = createRemoteMcpJwtVerifier({
      issuer,
      verifyKey: createLocalJWKSet({ keys: [{ ...publicJwk, kid: "rsa-test-kid", alg: "RS256", use: "sig" }] }),
      activeGrant,
    });
    async function signed(typ?: string) {
      const header = typ
        ? { alg: "RS256" as const, kid: "rsa-test-kid", typ }
        : { alg: "RS256" as const, kid: "rsa-test-kid" };
      return new SignJWT({ scope: "review:read", githubUserId: ghUser, clientId })
        .setProtectedHeader(header)
        .setSubject(`github:${ghUser}`)
        .setIssuer(issuer)
        .setAudience(remoteMcpResource)
        .setJti(jti)
        .setIssuedAt(now())
        .setExpirationTime(now() + 600)
        .sign(privateKey);
    }
    for (const typ of [undefined, "JWT", "id+jwt", "dpop+jwt", "application/id+jwt"]) {
      const token = await signed(typ);
      expect(
        await authenticateRemoteMcpRequest(mcpRequest("tools/list", {}, token), issuer, verifier),
        `Must deny wrong JWT type ${typ ?? "missing"}`,
      ).toBeNull();
    }
    expect(activeGrant).not.toHaveBeenCalled();
    const accessToken = await signed("at+jwt");
    expect(await authenticateRemoteMcpRequest(mcpRequest("tools/list", {}, accessToken), issuer, verifier)).toEqual({
      githubUserId: ghUser,
      grantId: jti,
      scopes: ["review:read"],
    });
    expect(activeGrant).toHaveBeenCalledOnce();
  });

  it("rejects ES256 JWTs even if a trusted key verifies their signature and claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const activeGrant = vi.fn().mockResolvedValue(true);
    const verifier = createRemoteMcpJwtVerifier({
      issuer,
      verifyKey: createLocalJWKSet({ keys: [{ ...publicJwk, kid: "elliptic-test-kid", alg: "ES256", use: "sig" }] }),
      activeGrant,
    });
    const jwt = await new SignJWT({ scope: "review:read", githubUserId: ghUser, clientId })
      .setProtectedHeader({ alg: "ES256", kid: "elliptic-test-kid", typ: "at+jwt" })
      .setSubject(`github:${ghUser}`)
      .setIssuer(issuer)
      .setAudience(remoteMcpResource)
      .setJti(jti)
      .setIssuedAt(now())
      .setExpirationTime(now() + 600)
      .sign(privateKey);
    expect(await authenticateRemoteMcpRequest(mcpRequest("tools/list", {}, jwt), issuer, verifier)).toBeNull();
    expect(activeGrant).not.toHaveBeenCalled();
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
    expect(body).toContain("boardreadyops_review_findings");
    expect(body).not.toContain("run_shell");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(openDb).not.toHaveBeenCalled();
  });

  it("advertises the source-minimized footprint tool only with Review scope", async () => {
    const dependencies = { openDb: vi.fn(), checkCurrentPermission: vi.fn() };
    const authorized = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/list"),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      dependencies,
    );
    expect(await authorized.text()).toContain("boardreadyops_review_footprint_summary");
    const evidenceOnly = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/list"),
      { githubUserId: ghUser, grantId: jti, scopes: ["evidence:read"] },
      dependencies,
    );
    expect(await evidenceOnly.text()).not.toContain("boardreadyops_review_footprint_summary");
    expect(dependencies.openDb).not.toHaveBeenCalled();
  });

  it("serves the current consented PCB summary through the actual remote MCP tool and closes its database", async () => {
    const summary = {
      schemaVersion: 1,
      scope: "pcb-footprints-only",
      provenance: "local-git-commits",
      disclosure: "counts-and-digests-only",
      baseCommitSha: "a".repeat(40),
      headCommitSha: "b".repeat(40),
      baseBlobSha: "c".repeat(40),
      headBlobSha: "d".repeat(40),
      baseSourceSha256: "e".repeat(64),
      headSourceSha256: "f".repeat(64),
      changes: {
        added: 2,
        removed: 1,
        modified: 0,
        byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 0, rotationDeg: 0 },
      },
      riskAssessment: "not-evaluated",
    } as const;
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from reviews"))
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "private-repo",
              head_run_id: "head-run",
              current_revision_id: "current-revision",
              status: "active",
              decision: "pending",
              owner: "PRIVATE-OWNER",
              name: "PRIVATE-REPO",
              github_repo_id: "456",
              github_installation_id: "789",
            },
          ],
        };
      if (sql.includes("from review_revisions"))
        return {
          rows: [
            {
              head_commit_sha: summary.headCommitSha,
              base_commit_sha: summary.baseCommitSha,
              evidence_digest: "9".repeat(64),
            },
          ],
        };
      if (sql.includes("from run_pcb_footprint_summaries")) return { rows: [{ summary, summary_sha256: sha }] };
      throw new Error("Unexpected query");
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const grant = vi.fn().mockResolvedValue(true);
    const openDb = vi.fn().mockResolvedValue({ query, close });
    const actual = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_footprint_summary", arguments: { reviewId } }),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb, checkCurrentPermission: grant },
    );
    const body = await actual.text();
    expect(actual.status, body).toBe(200);
    expect(body).toContain("client-reported");
    expect(body).toContain("pcb-footprints-only");
    expect(body).not.toContain("PRIVATE-OWNER");
    expect(body).not.toContain("PRIVATE-REPO");
    expect(body).not.toContain("private-repo");
    expect(grant).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not present missing stored PCB summaries as a successful no-change analysis", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from reviews"))
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "private-repo",
              head_run_id: "head-run",
              current_revision_id: "rev-1",
              status: "active",
              decision: "pending",
              owner: "owner",
              name: "repo",
              github_repo_id: "456",
              github_installation_id: "789",
            },
          ],
        };
      if (sql.includes("from review_revisions"))
        return {
          rows: [
            {
              head_commit_sha: "b".repeat(40),
              base_commit_sha: "a".repeat(40),
              evidence_digest: "9".repeat(64),
            },
          ],
        };
      if (sql.includes("from run_pcb_footprint_summaries")) return { rows: [] };
      throw new Error("Unexpected query");
    });
    const response = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_footprint_summary", arguments: { reviewId } }),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb: vi.fn().mockResolvedValue({ query, close }), checkCurrentPermission: vi.fn().mockResolvedValue(true) },
    );
    const body = await response.text();
    expect(body).toContain("unavailable");
    expect(body).toContain("not-evaluated");
    expect(body).not.toContain("client-reported");
    expect(close).toHaveBeenCalledOnce();
  });

  it("exposes the portable MCP Apps Review resource only after the user-bound OAuth grant", async () => {
    const openDb = vi.fn();
    const config = { openDb, checkCurrentPermission: vi.fn() };
    const principal = { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] };
    const listed = await handleAuthorizedRemoteMcpHttp(mcpRequest("resources/list"), principal, config);
    expect(listed.status).toBe(200);
    const catalog = await listed.json();
    expect(catalog.result.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: "ui://boardreadyops/review.html" })]),
    );
    const readRequest = mcpRequest("resources/read", { uri: "ui://boardreadyops/review.html" });
    // MCP v2 requires the resource identity in the per-request Mcp-Name header.
    readRequest.headers.set("Mcp-Name", "ui://boardreadyops/review.html");
    const loaded = await handleAuthorizedRemoteMcpHttp(readRequest, principal, config);
    expect(loaded.status).toBe(200);
    const payload = await loaded.text();
    expect(payload).toContain("BoardReadyOps");
    expect(payload).toContain("text/html;profile=mcp-app");
    expect(payload).not.toContain("bro_live_");
    expect(openDb).not.toHaveBeenCalled();
    const denied = await handleRemoteMcpWithVerifiedGrant(
      mcpRequest("resources/read", {
        uri: "ui://boardreadyops/review.html",
      }),
      {
        issuer,
        verifier: { verifySignedAccessToken: vi.fn().mockResolvedValue(null), grantIsActive: vi.fn() },
        ...config,
      },
    );
    expect(denied.status).toBe(401);
    expect(openDb).not.toHaveBeenCalled();
  });

  it("advertises evidence_get only for evidence:read grants, without opening storage", async () => {
    const openDb = vi.fn();
    const config = { openDb, checkCurrentPermission: vi.fn() };
    const evidenceOnly = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/list"),
      { githubUserId: ghUser, grantId: jti, scopes: ["evidence:read"] },
      config,
    );
    const evidenceCatalog = await evidenceOnly.text();
    expect(evidenceCatalog).toContain("boardreadyops_evidence_get");
    expect(evidenceCatalog).not.toContain("boardreadyops_review_get");
    expect(evidenceCatalog).not.toContain("boardreadyops_review_findings");
    const reviewOnly = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/list"),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      config,
    );
    expect(await reviewOnly.text()).not.toContain("boardreadyops_evidence_get");
    expect(openDb).not.toHaveBeenCalled();
  });

  it("returns only the persisted current revision digest and trusted Review link via actual MCP tools/call", async () => {
    const evidenceId = "c68e521d-fc45-4dfa-942d-776e9fe76838";
    const digest = "9".repeat(64);
    const query = vi.fn(async (sql: string, args?: unknown[]) => {
      if (sql.includes("from review_revisions as requested_revision")) {
        expect(args).toEqual([evidenceId]);
        return { rows: [{ review_id: reviewId }] };
      }
      if (sql.includes("from reviews"))
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "PRIVATE_INTERNAL_REPO",
              head_run_id: "current-head-run",
              current_revision_id: evidenceId,
              status: "active",
              decision: "pending",
              owner: "PRIVATE_OWNER",
              name: "PRIVATE_REPO",
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
              base_commit_sha: null,
              evidence_digest: digest,
            },
          ],
        };
      throw new Error("Unexpected query");
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const checkCurrentPermission = vi.fn().mockResolvedValue(true);
    const response = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_evidence_get", arguments: { evidenceId } }),
      { githubUserId: ghUser, grantId: jti, scopes: ["evidence:read"] },
      { openDb: vi.fn().mockResolvedValue({ query, close }), checkCurrentPermission },
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain(evidenceId);
    expect(text).toContain(digest);
    expect(text).toContain(`https://boardreadyops.com/reviews/${reviewId}`);
    expect(text).toContain("recorded-metadata-only");
    expect(text).not.toContain("PRIVATE_OWNER");
    expect(text).not.toContain("PRIVATE_REPO");
    expect(text).not.toContain("PRIVATE_INTERNAL_REPO");
    expect(text).not.toContain("current-head-run");
    expect(checkCurrentPermission).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed evidence selectors and grants with insufficient scope before any DB open", async () => {
    const openDb = vi.fn();
    const config = { openDb, checkCurrentPermission: vi.fn() };
    const principal = { githubUserId: ghUser, grantId: jti, scopes: ["evidence:read"] };
    const badSelector = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_evidence_get", arguments: { evidenceId: "../../secret" } }),
      principal,
      config,
    );
    expect(await badSelector.text()).not.toContain("recorded-metadata-only");
    const wrongScope = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", {
        name: "boardreadyops_evidence_get",
        arguments: { evidenceId: "c68e521d-fc45-4dfa-942d-776e9fe76838" },
      }),
      { ...principal, scopes: ["review:read"] },
      config,
    );
    expect(await wrongScope.text()).not.toContain("recorded-metadata-only");
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
    expect(listing).not.toContain("boardreadyops_review_findings");
    const called = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_get", arguments: { reviewId } }),
      principal,
      config,
    );
    const result = await called.text();
    expect(result).not.toContain('"schemaVersion":1');
    expect(openDb).not.toHaveBeenCalled();
  });

  it("returns a source-minimized findings page through the authenticated MCP transport", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("from reviews")) {
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "private-repo",
              head_run_id: "head-run",
              current_revision_id: "current-revision",
              status: "active",
              decision: "pending",
              owner: "secret-owner",
              name: "secret-repo",
              github_repo_id: "456",
              github_installation_id: "789",
            },
          ],
        };
      }
      if (sql.includes("from review_revisions")) {
        return { rows: [{ head_commit_sha: "a".repeat(40), evidence_digest: "b".repeat(64) }] };
      }
      if (sql.includes("from findings")) {
        return {
          rows: [
            { id: "000001", rule_id: "drc.clearance", severity: "error", kind: "electrical", fingerprint: "fp_1" },
          ],
        };
      }
      throw new Error("Unexpected query");
    });
    const openDb = vi.fn().mockResolvedValue({ query, close });
    const access = vi.fn().mockResolvedValue(true);
    const response = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_findings", arguments: { reviewId } }),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb, checkCurrentPermission: access },
    );
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("drc.clearance");
    expect(body).toContain("fp_1");
    expect(body).not.toContain("secret-owner");
    expect(body).not.toContain("secret-repo");
    expect(access).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("normalizes datastore exceptions without sending internal data to MCP clients", async () => {
    const openDb = vi.fn().mockRejectedValue(new Error("PRIVATE_CONN_STRING"));
    const called = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", { name: "boardreadyops_review_findings", arguments: { reviewId } }),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb, checkCurrentPermission: vi.fn() },
    );
    const response = await called.text();
    expect(called.status).toBe(200);
    expect(response).toContain("Review unavailable");
    expect(response).not.toContain("PRIVATE_CONN_STRING");
  });

  it("rejects the old bare-ID cursor at the public MCP schema without opening the datastore", async () => {
    const openDb = vi.fn();
    const response = await handleAuthorizedRemoteMcpHttp(
      mcpRequest("tools/call", {
        name: "boardreadyops_review_findings",
        arguments: { reviewId, cursor: "000030" },
      }),
      { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] },
      { openDb, checkCurrentPermission: vi.fn() },
    );
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).not.toContain("drc.clearance");
    expect(openDb).not.toHaveBeenCalled();
  });

  it("returns identical generic unavailable errors for unauthorized or missing finding Reviews", async () => {
    const principal = { githubUserId: ghUser, grantId: jti, scopes: ["review:read"] };
    for (const rows of [
      [],
      [
        {
          id: reviewId,
          repository_id: "private-repo",
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
    ]) {
      const close = vi.fn().mockResolvedValue(undefined);
      const openDb = vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows }), close });
      const denied = await handleAuthorizedRemoteMcpHttp(
        mcpRequest("tools/call", { name: "boardreadyops_review_findings", arguments: { reviewId } }),
        principal,
        { openDb, checkCurrentPermission: vi.fn().mockResolvedValue(false) },
      );
      expect(denied.status).toBe(200);
      expect(await denied.text()).toContain("Review unavailable");
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("returns only authorized review facts and closes the database for tools/call", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("from reviews")) {
        return {
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
        };
      }
      if (sql.includes("from review_revisions")) {
        return { rows: [{ head_commit_sha: "a".repeat(40), evidence_digest: "b".repeat(64) }] };
      }
      throw new Error("Unexpected query");
    });
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
    expect(checkCurrentPermission).toHaveBeenCalledTimes(2);
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
