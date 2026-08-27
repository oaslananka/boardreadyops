import { describe, expect, it, vi } from "vitest";
import { GET as getReviewFindings } from "../../../apps/web/app/api/v1/reviews/[id]/findings/route.js";
import { GET as getReviewById } from "../../../apps/web/app/api/v1/reviews/[id]/route.js";
import { GET as getReviews, POST as postReview } from "../../../apps/web/app/api/v1/reviews/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";

describe("Reviews Web API routes", () => {
  it("rejects unauthorized requests with 401", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValueOnce({
      ok: false,
      error: "Authentication required",
      status: 401,
    });

    const req = new Request("http://localhost/api/v1/reviews");
    const res = await getReviews(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Authentication required");
  });

  it("rejects invalid review payload on POST /api/v1/reviews with 400", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValueOnce({
      ok: true,
      repositoryId: "repo-123",
      actorId: "actor-1",
      scopes: ["reviews:write"],
      authType: "bearer_token",
    });

    const req = new Request("http://localhost/api/v1/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-123",
        // missing title, headRunId, headCommitSha, evidenceDigest
      }),
    });

    const res = await postReview(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid review request payload");
  });

  it("rejects unauthorized review by id requests", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValueOnce({
      ok: false,
      error: "Authentication required",
      status: 401,
    });

    const req = new Request("http://localhost/api/v1/reviews/rev-123");
    const res = await getReviewById(req, { params: Promise.resolve({ id: "rev-123" }) });
    expect(res.status).toBe(401);
  });

  it("rejects unauthorized review findings requests", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValueOnce({
      ok: false,
      error: "Authentication required",
      status: 401,
    });

    const req = new Request("http://localhost/api/v1/reviews/rev-123/findings");
    const res = await getReviewFindings(req, { params: Promise.resolve({ id: "rev-123" }) });
    expect(res.status).toBe(401);
  });
});
