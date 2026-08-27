import { describe, expect, it, vi } from "vitest";
import {
  GET as getApprovals,
  POST as postApproval,
} from "../../../apps/web/app/api/v1/reviews/[id]/approvals/route.js";
import {
  DELETE as deleteAssignment,
  GET as getAssignments,
  POST as postAssignment,
} from "../../../apps/web/app/api/v1/reviews/[id]/assignments/route.js";
import {
  GET as getChecklist,
  PATCH as patchChecklist,
  POST as postChecklist,
} from "../../../apps/web/app/api/v1/reviews/[id]/checklist/route.js";
import {
  GET as getComments,
  PATCH as patchComment,
  POST as postComment,
} from "../../../apps/web/app/api/v1/reviews/[id]/comments/route.js";
import {
  GET as getDecisions,
  POST as postDecision,
} from "../../../apps/web/app/api/v1/reviews/[id]/decisions/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";

describe("Review Collaboration API routes", () => {
  it("rejects unauthorized calls with 401 across all collaboration endpoints", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: false,
      error: "Authentication required",
      status: 401,
    });

    const params = Promise.resolve({ id: "rev-123" });
    const req = new Request("http://localhost/api/v1/reviews/rev-123/decisions");

    expect((await getDecisions(req, { params })).status).toBe(401);
    expect((await postDecision(req, { params })).status).toBe(401);
    expect((await getAssignments(req, { params })).status).toBe(401);
    expect((await postAssignment(req, { params })).status).toBe(401);
    expect((await deleteAssignment(req, { params })).status).toBe(401);
    expect((await getComments(req, { params })).status).toBe(401);
    expect((await postComment(req, { params })).status).toBe(401);
    expect((await patchComment(req, { params })).status).toBe(401);
    expect((await getApprovals(req, { params })).status).toBe(401);
    expect((await postApproval(req, { params })).status).toBe(401);
    expect((await getChecklist(req, { params })).status).toBe(401);
    expect((await postChecklist(req, { params })).status).toBe(401);
    expect((await patchChecklist(req, { params })).status).toBe(401);
  });

  it("validates short justification reason on accepted_risk POST /decisions", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValueOnce({
      ok: true,
      repositoryId: "repo-123",
      actorId: "actor-1",
      scopes: ["reviews:write"],
      authType: "bearer_token",
    });

    const req = new Request("http://localhost/api/v1/reviews/rev-123/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        findingFingerprint: "fp-123",
        disposition: "accepted_risk",
        reason: "short", // < 20 characters
        owner: "engineer@company.com",
        evidenceDigest: "a".repeat(64),
      }),
    });

    const res = await postDecision(req, { params: Promise.resolve({ id: "rev-123" }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("at least 20 characters");
  });
});
