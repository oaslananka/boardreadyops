import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postReview } from "../../../apps/web/app/api/v1/reviews/route.js";
import { POST as postRun } from "../../../apps/web/app/api/v1/runs/route.js";
import { POST as postToken } from "../../../apps/web/app/api/v1/tokens/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";

const auth: apiAuth.AuthenticatedApiContext = {
  ok: true,
  repositoryId: "repo-token",
  actorId: "token-1",
  scopes: ["admin"],
  authType: "bearer_token",
};

function forbiddenScopeResponse() {
  return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
}

function mockRepositoryScope() {
  vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue(auth);
  return vi.spyOn(apiAuth, "resolveRepositoryApiContext").mockResolvedValue(forbiddenScopeResponse());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repository-scoped write routes", () => {
  it("routes review creation through the central repository authorization boundary", async () => {
    const scope = mockRepositoryScope();
    const request = new Request("https://boardreadyops.test/api/v1/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-other",
        title: "Repository scope regression",
        headRunId: "run-123",
        headCommitSha: "abcdef0",
        evidenceDigest: "a".repeat(64),
      }),
    });

    const response = await postReview(request);

    expect(response.status).toBe(403);
    expect(scope).toHaveBeenCalledWith(auth, request, "repo-other");
  });

  it("routes token creation through the central repository authorization boundary", async () => {
    const scope = mockRepositoryScope();
    const request = new Request("https://boardreadyops.test/api/v1/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-other",
        name: "repository-scope-regression",
        scopes: ["runs:write"],
      }),
    });

    const response = await postToken(request);

    expect(response.status).toBe(403);
    expect(scope).toHaveBeenCalledWith(auth, request, "repo-other");
  });

  it("routes run ingestion through the central repository authorization boundary", async () => {
    const scope = mockRepositoryScope();
    const request = new Request("https://boardreadyops.test/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo-other",
        commitSha: "abcdef0",
        ref: "refs/heads/main",
        findings: [],
        artifacts: [],
      }),
    });

    const response = await postRun(request);

    expect(response.status).toBe(403);
    expect(scope).toHaveBeenCalledWith(auth, request, "repo-other");
  });
});
