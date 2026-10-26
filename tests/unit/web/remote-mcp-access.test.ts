import { describe, expect, it, vi } from "vitest";
import {
  authenticateRemoteMcpRequest,
  loadAuthorizedRemoteReview,
  type RemoteMcpTokenVerifier,
  type SignedRemoteMcpClaims,
  verifyPkceS256,
} from "../../../apps/web/lib/remote-mcp-access.js";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";

const now = 1_800_000_000;
const issuer = "https://id.boardreadyops.com";
const reviewId = "123e4567-e89b-42d3-a456-426614174000";
const sha40 = "a".repeat(40);
const sha64 = "b".repeat(64);

const valid: SignedRemoteMcpClaims = {
  iss: issuer,
  aud: remoteMcpResource,
  sub: "github:123",
  jti: "opaque-grant-reference",
  iat: now - 100,
  exp: now + 500,
  nbf: now - 100,
  scope: "review:read evidence:read",
  githubUserId: 123,
  clientId: "https://client.example/client.json",
};

function request(headers: HeadersInit = { authorization: "Bearer signed.jwt.value" }, url = remoteMcpResource) {
  return new Request(url, { method: "POST", headers });
}
function verifier(claims: SignedRemoteMcpClaims | null = valid): RemoteMcpTokenVerifier {
  return { verifySignedAccessToken: vi.fn().mockResolvedValue(claims), grantIsActive: vi.fn().mockResolvedValue(true) };
}

const ownerReview = {
  id: reviewId,
  repository_id: "another-internal-id",
  head_run_id: "head-run-1",
  current_revision_id: "revision-1",
  status: "active",
  decision: "pending",
  owner: "hardware-team",
  name: "design",
  github_repo_id: "456",
  github_installation_id: "789",
};

const authorized = { githubUserId: 123, grantId: valid.jti, scopes: ["review:read"] };

function db(
  reviewRows: unknown[] = [ownerReview],
  revisionRows: unknown[] = [{ head_commit_sha: sha40, evidence_digest: sha64 }],
) {
  return {
    query: vi.fn().mockResolvedValueOnce({ rows: reviewRows }).mockResolvedValueOnce({ rows: revisionRows }),
  };
}

describe("remote MCP OAuth PKCE S256", () => {
  it("accepts RFC 7636 Appendix B test vector only with S256", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(verifyPkceS256(verifier, challenge, "S256")).toBe(true);
    expect(verifyPkceS256(verifier, challenge, "plain")).toBe(false);
    expect(verifyPkceS256(verifier, `${challenge.slice(0, -1)}A`, "S256")).toBe(false);
    expect(verifyPkceS256("short", challenge, "S256")).toBe(false);
    expect(verifyPkceS256(verifier, `${challenge}\n`, "S256")).toBe(false);
    expect(verifyPkceS256(verifier.repeat(3), challenge, "S256")).toBe(false);
  });
});

describe("remote MCP OAuth grant boundary", () => {
  it("only accepts a signed, resource-bound, active, short-lived OAuth grant", async () => {
    const check = verifier();
    expect(await authenticateRemoteMcpRequest(request(), issuer, check, now)).toEqual({
      githubUserId: 123,
      grantId: valid.jti,
      scopes: ["review:read", "evidence:read"],
    });
    expect(check.grantIsActive).toHaveBeenCalledOnce();
    expect(check.grantIsActive).toHaveBeenCalledWith(valid.jti, valid.githubUserId, valid.clientId, valid.scope);
  });

  it("rejects sessions, missing tokens, URL tokens, and token-looking cookies without consulting a verifier", async () => {
    const check = verifier();
    for (const req of [
      request({ cookie: "brops_session=valid" }),
      request({ authorization: "Basic dXNlcjpwYXNz" }),
      request({}, `${remoteMcpResource}?access_token=secret`),
      request({ authorization: "Bearer a b" }),
      request({ authorization: `Bearer ${"a".repeat(4097)}` }),
    ]) {
      expect(await authenticateRemoteMcpRequest(req, issuer, check, now)).toBeNull();
    }
    expect(check.verifySignedAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    [{ aud: "https://other.example/mcp" }, "wrong audience"],
    [{ iss: "https://other.example" }, "wrong issuer"],
    [{ exp: now - 1 }, "expired"],
    [{ iat: now + 1000 }, "future issue"],
    [{ iat: now - 5000 }, "excess lifetime"],
    [{ nbf: now + 1000 }, "not before"],
    [{ scope: "admin" }, "elevated scope"],
    [{ scope: "" }, "empty scope"],
    [{ sub: "github:999" }, "mismatched identity"],
    [{ githubUserId: 0 }, "invalid stable identity"],
    [{ jti: "" }, "missing revocation reference"],
  ] as const)("rejects %s: %s", async (change) => {
    const check = verifier({ ...valid, ...change });
    expect(await authenticateRemoteMcpRequest(request(), issuer, check, now)).toBeNull();
    expect(check.grantIsActive).not.toHaveBeenCalled();
  });

  it("refuses an untrusted or insecure issuer configuration", async () => {
    const check = verifier();
    expect(await authenticateRemoteMcpRequest(request(), "http://id.boardreadyops.com", check, now)).toBeNull();
    expect(await authenticateRemoteMcpRequest(request(), "invalid-url", check, now)).toBeNull();
    expect(check.verifySignedAccessToken).not.toHaveBeenCalled();
  });

  it("rejects invalid signature, revoked grants and revocation-check outages", async () => {
    const check = verifier(null);
    expect(await authenticateRemoteMcpRequest(request(), issuer, check, now)).toBeNull();
    const revoked = verifier();
    vi.mocked(revoked.grantIsActive).mockResolvedValue(false);
    expect(await authenticateRemoteMcpRequest(request(), issuer, revoked, now)).toBeNull();
    vi.mocked(revoked.grantIsActive).mockRejectedValue(new Error("connection error"));
    expect(await authenticateRemoteMcpRequest(request(), issuer, revoked, now)).toBeNull();
    const broken = verifier();
    vi.mocked(broken.verifySignedAccessToken).mockRejectedValue(new Error("issuer unreachable"));
    expect(await authenticateRemoteMcpRequest(request(), issuer, broken, now)).toBeNull();
  });
});

describe("remote MCP live repository gate", () => {
  it("loads only current authorized review facts, strips names and never returns source or verdict", async () => {
    const store = db();
    const checkLive = vi.fn().mockResolvedValue(true);
    const result = await loadAuthorizedRemoteReview(store, authorized, reviewId, checkLive);
    expect(checkLive).toHaveBeenCalledWith({
      githubUserId: 123,
      githubRepositoryId: 456,
      githubInstallationId: 789,
      owner: "hardware-team",
      name: "design",
    });
    expect(result).toEqual({
      schemaVersion: 1,
      status: "active",
      decision: "pending",
      evidenceDigest: sha64,
      headCommitSha: sha40,
      productionApproval: "not-evaluated",
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("hardware-team");
    expect(text).not.toContain("design");
    const sql = vi.mocked(store.query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("repositories.disabled_at is null");
    expect(sql).toContain("installations.suspended_at is null");
    expect(sql).toContain("github_marketplace_subscriptions.status = 'canceled'");
  });

  it("rejects cross-tenant IDs and never infers access from a GitHub App installation", async () => {
    const store = db([]);
    const checkLive = vi.fn().mockResolvedValue(true);
    expect(await loadAuthorizedRemoteReview(store, authorized, reviewId, checkLive)).toBeNull();
    expect(checkLive).not.toHaveBeenCalled();
    expect(store.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed on revoked GitHub membership or an unavailable live permission provider", async () => {
    for (const checkLive of [vi.fn().mockResolvedValue(false), vi.fn().mockRejectedValue(new Error("offline"))]) {
      const store = db();
      expect(await loadAuthorizedRemoteReview(store, authorized, reviewId, checkLive)).toBeNull();
      expect(store.query).toHaveBeenCalledTimes(1);
    }
  });

  it("checks live user access on every read, including after membership is revoked", async () => {
    const store = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [ownerReview] })
        .mockResolvedValueOnce({ rows: [{ head_commit_sha: sha40, evidence_digest: sha64 }] })
        .mockResolvedValueOnce({ rows: [ownerReview] }),
    };
    const checkLive = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await loadAuthorizedRemoteReview(store, authorized, reviewId, checkLive)).not.toBeNull();
    expect(await loadAuthorizedRemoteReview(store, authorized, reviewId, checkLive)).toBeNull();
    expect(checkLive).toHaveBeenCalledTimes(2);
    expect(store.query).toHaveBeenCalledTimes(3);
  });

  it("rejects missing OAuth scopes and malformed review IDs without database lookups", async () => {
    const store = db();
    const checkLive = vi.fn().mockResolvedValue(true);
    expect(
      await loadAuthorizedRemoteReview(store, { ...authorized, scopes: ["evidence:read"] }, reviewId, checkLive),
    ).toBeNull();
    expect(await loadAuthorizedRemoteReview(store, authorized, "../../secret", checkLive)).toBeNull();
    expect(store.query).not.toHaveBeenCalled();
    expect(checkLive).not.toHaveBeenCalled();
  });

  it("rejects missing current revisions and refuses to fall back to a previous run", async () => {
    const store = db([{ ...ownerReview, current_revision_id: null }]);
    expect(await loadAuthorizedRemoteReview(store, authorized, reviewId, vi.fn())).toBeNull();
    expect(store.query).toHaveBeenCalledTimes(1);
    const oldRevision = db([ownerReview], []);
    expect(
      await loadAuthorizedRemoteReview(oldRevision, authorized, reviewId, vi.fn().mockResolvedValue(true)),
    ).toBeNull();
    expect(oldRevision.query).toHaveBeenCalledTimes(2);
  });
});
