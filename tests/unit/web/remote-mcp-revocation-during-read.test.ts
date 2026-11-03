import { describe, expect, it, vi } from "vitest";
import { remoteMcpResource } from "../../../apps/web/lib/remote-mcp-foundation.js";
import { handleRemoteMcpWithVerifiedGrant } from "../../../apps/web/lib/remote-mcp-http.js";

const issuer = "https://id.boardreadyops.com";
const reviewId = "123e4567-e89b-42d3-a456-426614174000";
const userId = 123;
const grantId = "active-grant-1234567890";
const clientId = "https://client.example/oauth-client.json";
const sourceDigest = "9".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const signedClaims = () => ({
  iss: issuer,
  aud: remoteMcpResource,
  sub: `github:${userId}`,
  jti: grantId,
  githubUserId: userId,
  clientId,
  scope: "review:read",
  iat: now() - 60,
  exp: now() + 600,
});

function request() {
  return new Request(remoteMcpResource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer signed.jwt",
      "Mcp-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "boardreadyops_review_get",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "boardreadyops_review_get",
        arguments: { reviewId },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "revocation-check", version: "1.0" },
        },
      },
    }),
  });
}

function setup(mutateDuringRead: () => void = () => {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from reviews"))
      return {
        rows: [
          {
            id: reviewId,
            repository_id: "PRIVATE_REPO_ID",
            head_run_id: "head-run",
            current_revision_id: "revision-id",
            status: "active",
            decision: "pending",
            owner: "PRIVATE_OWNER",
            name: "PRIVATE_REPO",
            github_repo_id: "456",
            github_installation_id: "789",
          },
        ],
      };
    if (sql.includes("from review_revisions")) {
      mutateDuringRead();
      return { rows: [{ head_commit_sha: "a".repeat(40), evidence_digest: sourceDigest }] };
    }
    throw new Error("Unexpected query");
  });
  const close = vi.fn().mockResolvedValue(undefined);
  const grantIsActive = vi.fn().mockResolvedValue(true);
  const verifySignedAccessToken = vi.fn().mockImplementation(async () => signedClaims());
  const checkCurrentPermission = vi.fn().mockResolvedValue(true);
  const options = {
    issuer,
    verifier: { verifySignedAccessToken, grantIsActive },
    openDb: vi.fn().mockResolvedValue({ query, close }),
    checkCurrentPermission,
  };
  return { options, query, close, grantIsActive, verifySignedAccessToken, checkCurrentPermission };
}

describe("remote MCP OAuth grant revocation during a live Review read", () => {
  it("withholds already-read private Review facts if the grant was revoked while reading", async () => {
    let dependencies: ReturnType<typeof setup>;
    dependencies = setup(() => {
      dependencies.grantIsActive.mockResolvedValue(false);
    });
    const response = await handleRemoteMcpWithVerifiedGrant(request(), dependencies.options);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(body).toContain("Review unavailable");
    expect(body).not.toContain(sourceDigest);
    expect(body).not.toContain("PRIVATE_REPO");
    expect(dependencies.grantIsActive).toHaveBeenCalledTimes(2);
    expect(dependencies.close).toHaveBeenCalledOnce();
  });

  it("withholds data when the durable grant store goes offline during the final check", async () => {
    let dependencies: ReturnType<typeof setup>;
    dependencies = setup(() => {
      dependencies.grantIsActive.mockRejectedValue(new Error("private-db-connection"));
    });
    const result = await handleRemoteMcpWithVerifiedGrant(request(), dependencies.options);
    const body = await result.text();
    expect(body).toContain("Review unavailable");
    expect(body).not.toContain(sourceDigest);
    expect(body).not.toContain("private-db-connection");
    expect(dependencies.close).toHaveBeenCalledOnce();
  });

  it("rejects a changed signed OAuth identity or scope between the two grant checks", async () => {
    for (const override of [{ githubUserId: 999, sub: "github:999" }, { scope: "evidence:read" }]) {
      const dependencies = setup();
      let reads = 0;
      dependencies.verifySignedAccessToken.mockImplementation(async () => {
        reads++;
        return reads === 1 ? signedClaims() : { ...signedClaims(), ...override };
      });
      const response = await handleRemoteMcpWithVerifiedGrant(request(), dependencies.options);
      const body = await response.text();
      expect(body).toContain("Review unavailable");
      expect(body).not.toContain(sourceDigest);
      expect(dependencies.close).toHaveBeenCalledOnce();
    }
  });

  it("returns a current Review only after a second durable OAuth check", async () => {
    const dependencies = setup();
    const result = await handleRemoteMcpWithVerifiedGrant(request(), dependencies.options);
    const body = await result.text();
    expect(body).toContain(sourceDigest);
    expect(body).toContain("not-evaluated");
    expect(dependencies.grantIsActive).toHaveBeenCalledTimes(2);
    expect(dependencies.verifySignedAccessToken).toHaveBeenCalledTimes(2);
    expect(dependencies.checkCurrentPermission).toHaveBeenCalledTimes(2);
    expect(dependencies.close).toHaveBeenCalledOnce();
  });
});
