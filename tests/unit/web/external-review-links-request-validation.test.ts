import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  resolveRepositoryApiContext: vi.fn(),
}));

vi.mock("../../../apps/web/lib/api-auth.js", () => auth);

const { POST } = await import("../../../apps/web/app/api/v1/external-review-links/route.js");

const endpoint = "https://boardreadyops.test/api/v1/external-review-links?repositoryId=repo-a";

function post(body: string, contentLength?: string): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
    body,
  });
}

describe("POST /api/v1/external-review-links input lifecycle", () => {
  beforeEach(() => {
    auth.authenticateApiRequest.mockReset().mockResolvedValue({
      ok: true,
      actorId: "owner-a",
      scopes: ["reviews:write"],
      repositoryId: "repo-a",
      authType: "bearer_token",
    });
    // A sentinel response proves that valid bodies still enter the canonical
    // repository authorization path, without creating a real DB connection.
    auth.resolveRepositoryApiContext
      .mockReset()
      .mockResolvedValue(Response.json({ ok: false, error: "scope sentinel" }, { status: 418 }));
  });

  it.each([
    ["malformed JSON", "{", "Invalid JSON body"],
    ["invalid schema", '{"reviewId":"review-a"}', "Invalid external review link payload"],
  ])("rejects %s before acquiring a repository database executor", async (_name, body, error) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(error);
    expect(auth.resolveRepositoryApiContext).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before acquiring an executor", async () => {
    const response = await POST(post(" ".repeat(70 * 1024)));
    expect(response.status).toBe(413);
    expect(auth.resolveRepositoryApiContext).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared content length before acquiring an executor", async () => {
    const response = await POST(post("{}", String(70 * 1024)));
    expect(response.status).toBe(413);
    expect(auth.resolveRepositoryApiContext).not.toHaveBeenCalled();
  });

  it("continues to canonical repository authorization for a valid request", async () => {
    const response = await POST(
      post(
        JSON.stringify({
          reviewId: "review-a",
          recipientEmail: "reviewer@example.test",
          recipientName: "Reviewer",
          scope: "read_only",
        }),
      ),
    );
    expect(response.status).toBe(418);
    expect(auth.resolveRepositoryApiContext).toHaveBeenCalledOnce();
    expect(auth.resolveRepositoryApiContext).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "owner-a" }),
      expect.any(Request),
    );
  });
});
