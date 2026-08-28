import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";

const reviewId = "rev-coverage-1";
const repositoryId = "repo-coverage-1";
const headRunId = "run-coverage-1";
const fingerprint = "finding-fingerprint-1";
const now = "2026-08-29T00:00:00.000Z";
const evidenceDigest = "a".repeat(64);

function authenticatedContext() {
  return {
    ok: true as const,
    repositoryId,
    actorId: "reviewer@company.com",
    scopes: ["reviews:read", "reviews:write"],
    authType: "session" as const,
    installationIds: [1001],
  };
}

function createExecutor() {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const norm = sql.toLowerCase().replace(/\s+/gu, " ");

    if (norm.includes("select 1 from findings")) {
      return { rows: [{ exists: 1 }] };
    }
    if (norm.includes("insert into finding_assignments")) {
      return {
        rows: [
          {
            id: String(params[0]),
            repositoryId: params[1],
            reviewId: params[2],
            findingFingerprint: params[3],
            assignee: params[4],
            assignedBy: params[5],
            createdAt: now,
          },
        ],
      };
    }
    if (norm.includes("from finding_assignments")) {
      return {
        rows: [
          {
            id: "fasn-1",
            repositoryId,
            reviewId,
            findingFingerprint: fingerprint,
            assignee: "alice",
            assignedBy: "reviewer@company.com",
            createdAt: now,
          },
        ],
      };
    }
    if (norm.includes("insert into review_checklist_items")) {
      return {
        rows: [
          {
            id: String(params[0]),
            repositoryId: params[1],
            reviewId: params[2],
            title: params[3],
            completed: false,
            completedBy: null,
            completedAt: null,
            createdAt: now,
          },
        ],
      };
    }
    if (norm.includes("update review_checklist_items")) {
      return {
        rows: [
          {
            id: params[0],
            repositoryId,
            reviewId,
            title: "Verify DRC",
            completed: params[1],
            completedBy: params[2],
            completedAt: params[3],
            createdAt: now,
          },
        ],
      };
    }
    if (norm.includes("from review_checklist_items")) {
      return {
        rows: [
          {
            id: "rchk-1",
            repositoryId,
            reviewId,
            title: "Verify DRC",
            completed: false,
            completedBy: null,
            completedAt: null,
            createdAt: now,
          },
        ],
      };
    }
    if (norm.includes("insert into review_comments")) {
      return {
        rows: [
          {
            id: String(params[0]),
            repositoryId: params[1],
            reviewId: params[2],
            parentId: params[3],
            findingFingerprint: params[4],
            evidenceAnchor: params[5],
            authorId: params[6],
            authorType: params[7],
            content: params[8],
            status: "open",
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    }
    if (norm.includes("update review_comments")) {
      return {
        rows: [
          {
            id: params[0],
            repositoryId,
            reviewId,
            parentId: null,
            findingFingerprint: fingerprint,
            evidenceAnchor: null,
            authorId: "reviewer@company.com",
            authorType: "internal",
            content: "Please verify this finding.",
            status: params[1],
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    }
    if (norm.includes("from review_comments")) {
      return {
        rows: [
          {
            id: "rcmt-1",
            repositoryId,
            reviewId,
            parentId: null,
            findingFingerprint: fingerprint,
            evidenceAnchor: null,
            authorId: "reviewer@company.com",
            authorType: "internal",
            content: "Please verify this finding.",
            status: "open",
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    }
    if (norm.includes("insert into finding_decisions")) {
      return {
        rows: [
          {
            id: String(params[0]),
            repositoryId: params[1],
            reviewId: params[2],
            findingFingerprint: params[3],
            disposition: params[4],
            reason: params[5],
            owner: params[6],
            expiresAt: params[7],
            evidenceDigest: params[8],
            actorId: params[9],
            createdAt: now,
          },
        ],
      };
    }
    if (norm.includes("from finding_decisions")) {
      return {
        rows: [
          {
            id: "fdec-1",
            repositoryId,
            reviewId,
            findingFingerprint: fingerprint,
            disposition: "fixed",
            reason: "Verified in the updated board revision",
            owner: "hardware-lead",
            expiresAt: null,
            evidenceDigest,
            actorId: "reviewer@company.com",
            createdAt: now,
          },
        ],
      };
    }

    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  return { query, close };
}

function reviewContext(executor: ReturnType<typeof createExecutor>) {
  return {
    reviewId,
    repositoryId,
    headRunId,
    currentRevisionId: "revision-1",
    executor: executor as unknown as PgQueryExecutor,
  };
}

function request(path: string, init?: RequestInit) {
  return new Request(`https://boardreadyops.test${path}`, init);
}

describe("review collaboration API successful mutations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue(authenticatedContext());
  });

  it("reads and records finding assignments only after authoritative finding membership validation", async () => {
    const executor = createExecutor();
    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue(reviewContext(executor));
    const params = Promise.resolve({ id: reviewId });

    const getResponse = await getAssignments(request(`/api/v1/reviews/${reviewId}/assignments`), { params });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({ ok: true, assignments: [{ assignee: "alice" }] });

    const postResponse = await postAssignment(
      request(`/api/v1/reviews/${reviewId}/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingFingerprint: fingerprint, assignee: "alice" }),
      }),
      { params },
    );
    expect(postResponse.status).toBe(201);
    await expect(postResponse.json()).resolves.toMatchObject({
      ok: true,
      assignment: { reviewId, repositoryId, findingFingerprint: fingerprint, assignee: "alice" },
    });
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("SELECT 1 FROM findings"), [
      headRunId,
      fingerprint,
    ]);
  });

  it("creates, reads, and updates checklist items within the authorized review scope", async () => {
    const executor = createExecutor();
    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue(reviewContext(executor));
    const params = Promise.resolve({ id: reviewId });

    const createResponse = await postChecklist(
      request(`/api/v1/reviews/${reviewId}/checklist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Verify DRC" }),
      }),
      { params },
    );
    expect(createResponse.status).toBe(201);

    const getResponse = await getChecklist(request(`/api/v1/reviews/${reviewId}/checklist`), { params });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({ ok: true, items: [{ title: "Verify DRC" }] });

    const patchResponse = await patchChecklist(
      request(`/api/v1/reviews/${reviewId}/checklist`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "rchk-1", completed: true }),
      }),
      { params },
    );
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({ ok: true, item: { id: "rchk-1", completed: true } });
    expect(executor.query).toHaveBeenCalledWith(
      expect.stringContaining("AND review_id = $5 AND repository_id = $6"),
      expect.arrayContaining(["rchk-1", reviewId, repositoryId]),
    );
  });

  it("creates, reads, and updates comments within the authorized review scope", async () => {
    const executor = createExecutor();
    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue(reviewContext(executor));
    const params = Promise.resolve({ id: reviewId });

    const createResponse = await postComment(
      request(`/api/v1/reviews/${reviewId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "Please verify this finding.",
          findingFingerprint: fingerprint,
          authorType: "internal",
        }),
      }),
      { params },
    );
    expect(createResponse.status).toBe(201);

    const getResponse = await getComments(request(`/api/v1/reviews/${reviewId}/comments`), { params });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      ok: true,
      comments: [{ content: "Please verify this finding." }],
    });

    const patchResponse = await patchComment(
      request(`/api/v1/reviews/${reviewId}/comments`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: "rcmt-1", status: "resolved" }),
      }),
      { params },
    );
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({
      ok: true,
      comment: { id: "rcmt-1", status: "resolved" },
    });
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("AND review_id = $3 AND repository_id = $4"), [
      "rcmt-1",
      "resolved",
      reviewId,
      repositoryId,
    ]);
  });

  it("reads and records finding decisions only for findings in the authoritative head run", async () => {
    const executor = createExecutor();
    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue(reviewContext(executor));
    const params = Promise.resolve({ id: reviewId });

    const getResponse = await getDecisions(request(`/api/v1/reviews/${reviewId}/decisions`), { params });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({ ok: true, decisions: [{ disposition: "fixed" }] });

    const postResponse = await postDecision(
      request(`/api/v1/reviews/${reviewId}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingFingerprint: fingerprint,
          disposition: "fixed",
          reason: "Verified in the updated board revision",
          owner: "hardware-lead",
          evidenceDigest,
        }),
      }),
      { params },
    );
    expect(postResponse.status).toBe(201);
    await expect(postResponse.json()).resolves.toMatchObject({
      ok: true,
      decision: { reviewId, repositoryId, findingFingerprint: fingerprint, disposition: "fixed" },
    });
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("SELECT 1 FROM findings"), [
      headRunId,
      fingerprint,
    ]);
  });
});
