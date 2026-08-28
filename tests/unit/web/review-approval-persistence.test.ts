import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  GET as getApprovals,
  POST as postApproval,
} from "../../../apps/web/app/api/v1/reviews/[id]/approvals/route.js";
import { POST as postAssignment } from "../../../apps/web/app/api/v1/reviews/[id]/assignments/route.js";
import { PATCH as patchChecklist } from "../../../apps/web/app/api/v1/reviews/[id]/checklist/route.js";
import { PATCH as patchComment } from "../../../apps/web/app/api/v1/reviews/[id]/comments/route.js";
import { POST as postDecision } from "../../../apps/web/app/api/v1/reviews/[id]/decisions/route.js";
import { ChecklistApprovalsTab } from "../../../apps/web/components/review/checklist-approvals-tab.js";
import { ReviewHeader } from "../../../apps/web/components/review/review-header.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { type ReviewApprovalRecord, ReviewApprovalStore } from "../../../packages/db/src/review-approval-store.js";

function createMockExecutor(storedRows: Record<string, unknown>[] = []) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const rows = [...storedRows];

  return {
    queries,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from repositories")) {
        return { rows: [{ github_installation_id: 1001 }] };
      }

      if (norm.includes("from review_revisions where id = $1")) {
        return {
          rows: [
            {
              id: (params[0] as string) ?? "rev_seq_1",
              sequence: 1,
              base_commit_sha: "0".repeat(40),
              head_commit_sha: "1".repeat(40),
              evidence_digest: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
            },
          ],
        };
      }

      if (norm.includes("from reviews where id = $1")) {
        return {
          rows: [
            {
              id: (params[0] as string) ?? "rev_test_123",
              repository_id: (params[1] as string) ?? "repo-hardware-main",
              pull_request_number: 42,
              title: "Power Stage & Gate Driver Review",
              status: "active",
              decision: "pending",
              base_run_id: null,
              head_run_id: "run-1",
              current_revision_id: "rev_seq_1",
              created_by: "eng@company.com",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              completed_at: null,
            },
          ],
        };
      }

      if (norm.includes("claim_approval") || norm.includes("insert into review_approvals")) {
        const record = {
          id: params[0] as string,
          repositoryId: params[1] as string,
          reviewId: params[2] as string,
          revisionId: params[3] as string,
          evidenceDigest: params[4] as string,
          approverId: params[5] as string,
          status: params[6] as string,
          reason: (params[7] as string | null) ?? null,
          isBreakGlass: (params[8] as boolean) ?? false,
          invalidatedAt: null,
          invalidatedBy: null,
          invalidationReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        rows.unshift(record);
        return { rows: [record] };
      }

      if (norm.includes("select") && norm.includes("from review_approvals")) {
        return { rows };
      }

      return { rows: [] };
    }),
    close: vi.fn(async () => {}),
  };
}

describe("Review Approval Persistence & State Lifecycle (Authoritative Architecture)", () => {
  const reviewId = "rev_test_123";
  const repositoryId = "repo-hardware-main";
  const revisionId = "rev_seq_1";
  const evidenceDigest = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

  it("ReviewApprovalStore records approval and retrieves it authoritatively", async () => {
    const executor = createMockExecutor();
    const store = new ReviewApprovalStore(executor);

    const approval = await store.recordApproval({
      repositoryId,
      reviewId,
      revisionId,
      evidenceDigest,
      approverId: "senior.engineer@company.com",
      status: "approved",
      reason: "High-voltage clearance >= 2.0mm confirmed.",
      isBreakGlass: false,
    });

    expect(approval).toBeDefined();
    expect(approval.status).toBe("approved");
    expect(approval.approverId).toBe("senior.engineer@company.com");
    expect(approval.reason).toBe("High-voltage clearance >= 2.0mm confirmed.");

    const list = await store.listApprovalsForReview(reviewId);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(approval.id);
  });

  it("POST /api/v1/reviews/[id]/approvals persists approval via resolveReviewApiContext and atomic CTE", async () => {
    const mockExecutor = createMockExecutor();

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId,
      actorId: "lead.hardware@company.com",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId,
        evidenceDigest,
        status: "approved",
        reason: "Layer stackup and trace impedance verified.",
        isBreakGlass: false,
      }),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; approval: ReviewApprovalRecord };
    expect(body.ok).toBe(true);
    expect(body.approval.status).toBe("approved");
    expect(body.approval.approverId).toBe("lead.hardware@company.com");

    // Verify CTE statement was executed
    const cteQuery = mockExecutor.queries.find((q) => q.sql.includes("claim_approval AS ("));
    expect(cteQuery).toBeDefined();
    expect(cteQuery?.params[1]).toBe(repositoryId);
    expect(cteQuery?.params[2]).toBe(reviewId);
    expect(cteQuery?.params[3]).toBe(revisionId);

    // Test GET /api/v1/reviews/[id]/approvals
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId,
      actorId: "lead.hardware@company.com",
      scopes: ["reviews:read"],
      authType: "session",
      installationIds: [1001],
    });

    const getReq = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`);
    const getRes = await getApprovals(getReq, { params });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { ok: boolean; approvals: ReviewApprovalRecord[] };
    expect(getBody.ok).toBe(true);
    expect(getBody.approvals).toHaveLength(1);
  });

  it("POST /api/v1/reviews/[id]/approvals rejects stale revision with 409 Conflict", async () => {
    const mockExecutor = createMockExecutor();

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "engineer@company.com",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      currentRevisionId: "rev_current_v2", // Current active is v2
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId: "rev_stale_v1", // Submitting stale v1
        evidenceDigest,
        status: "approved",
      }),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Submitted revision is not the current active review revision");
  });

  it("POST /api/v1/reviews/[id]/approvals rejects evidence digest mismatch with 409 Conflict", async () => {
    const mockExecutor = createMockExecutor();

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "engineer@company.com",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId,
        evidenceDigest: "b".repeat(64), // Mismatch digest
        status: "approved",
      }),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Evidence digest does not match");
  });

  it("POST /api/v1/reviews/[id]/approvals returns 403 when session user does not own installation", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "outsider@othercorp.com",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [9999], // Different installation
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue(
      Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 }),
    );

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId,
        evidenceDigest,
        status: "approved",
      }),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(403);
  });

  it("POST /api/v1/reviews/[id]/approvals rejects invalid payload with 400", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId,
      actorId: "tester@company.com",
      scopes: ["reviews:write"],
      authType: "session",
    });

    const mockExecutor = createMockExecutor();
    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId: "", // invalid empty revision
        evidenceDigest: "invalid-hash",
        status: "invalid_status",
      }),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it("POST /api/v1/reviews/[id]/approvals returns 401 when unauthenticated", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: false,
      error: "Authentication required",
      status: 401,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/reviews/[id]/approvals returns 409 Conflict when duplicate approval payload conflicts", async () => {
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId,
      actorId: "lead.hardware@company.com",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    const mockExecutor = createMockExecutor();
    // Simulate conflict: existing row has different reason
    mockExecutor.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from review_revisions where id = $1")) {
        return {
          rows: [
            {
              id: (params[0] as string) ?? "rev_seq_1",
              sequence: 1,
              base_commit_sha: "0".repeat(40),
              head_commit_sha: "1".repeat(40),
              evidence_digest: evidenceDigest,
            },
          ],
        };
      }
      if (norm.includes("claim_approval")) {
        return { rows: [] }; // 0 rows inserted/updated due to conflicting payload
      }
      if (norm.includes("from review_approvals")) {
        return {
          rows: [
            {
              id: "rapp_1",
              status: "approved",
              reason: "Initial reason",
            },
          ],
        };
      }
      return { rows: [] };
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId,
        evidenceDigest,
        status: "approved",
        reason: "Different conflicting reason",
      }),
    });

    const res = await postApproval(req, { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Conflicting approval payload");
  });

  it("renders ReviewHeader reflecting approved decision state", () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewHeader, {
        reviewId,
        title: "Main Power Inverter Board",
        repositoryName: "acme/power-board",
        pullRequestNumber: 42,
        status: "active",
        decision: "approved",
        currentRevisionSequence: 1,
        baseCommitSha: "0".repeat(40),
        headCommitSha: "1".repeat(40),
        evidenceDigest,
        evidenceState: "current",
      }),
    );

    expect(markup).toContain("Approved");
    expect(markup).toContain("✓ Approved");
  });

  it("renders ChecklistApprovalsTab showing authoritative approvals and verification items", () => {
    const approval: ReviewApprovalRecord = {
      id: "rapp_test_123",
      repositoryId,
      reviewId,
      revisionId,
      evidenceDigest,
      approverId: "chief.engineer@company.com",
      status: "approved",
      reason: "High-voltage creepage meets IEC 60664.",
      isBreakGlass: true,
      invalidatedAt: null,
      invalidatedBy: null,
      invalidationReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const markup = renderToStaticMarkup(
      createElement(ChecklistApprovalsTab, {
        checklist: [
          {
            id: "chk_1",
            title: "Thermal dissipation simulation passed",
            completed: true,
            completedBy: "thermal@company.com",
            completedAt: new Date().toISOString(),
          },
        ],
        approvals: [approval],
        evidenceDigest,
      }),
    );

    expect(markup).toContain("Hardware Verification Checklist");
    expect(markup).toContain("Formal Approvals &amp; Sign-Off Ledger");
    expect(markup).toContain("chief.engineer@company.com");
    expect(markup).toContain("⚡ Break-Glass");
    expect(markup).toContain("High-voltage creepage meets IEC 60664.");
  });

  it("PATCH checklist route passes review and repository scope and fails closed (404) if item not in review", async () => {
    const mockExecutor = createMockExecutor();
    // Simulate no rows returned on scoped update
    mockExecutor.query.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from reviews")) {
        return {
          rows: [
            {
              review_id: reviewId,
              repository_id: repositoryId,
              head_run_id: "run-1",
              current_revision_id: revisionId,
              github_installation_id: 1001,
            },
          ],
        };
      }
      if (norm.includes("update review_checklist_items")) {
        return { rows: [] }; // Item not found in review scope
      }
      return { rows: [] };
    });

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "test-actor",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      headRunId: "run-1",
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost:3000/api/v1/reviews/${reviewId}/checklist`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "rchk_unknown", completed: true }),
    });

    const res = await patchChecklist(req, { params });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Checklist item not found");
  });

  it("PATCH comments route passes review and repository scope and fails closed (404) if comment not in review", async () => {
    const mockExecutor = createMockExecutor();
    mockExecutor.query.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from reviews")) {
        return {
          rows: [
            {
              review_id: reviewId,
              repository_id: repositoryId,
              head_run_id: "run-1",
              current_revision_id: revisionId,
              github_installation_id: 1001,
            },
          ],
        };
      }
      if (norm.includes("update review_comments")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "test-actor",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      headRunId: "run-1",
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost:3000/api/v1/reviews/${reviewId}/comments`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commentId: "rcmt_unknown", status: "resolved" }),
    });

    const res = await patchComment(req, { params });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Comment not found");
  });

  it("POST decisions route verifies finding belongs to review head run and returns 404 for unknown finding", async () => {
    const mockExecutor = createMockExecutor();
    mockExecutor.query.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from reviews")) {
        return {
          rows: [
            {
              review_id: reviewId,
              repository_id: repositoryId,
              head_run_id: "run-1",
              current_revision_id: revisionId,
              github_installation_id: 1001,
            },
          ],
        };
      }
      if (norm.includes("from findings where run_id = $1")) {
        return { rows: [] }; // Finding not in review run
      }
      return { rows: [] };
    });

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "test-actor",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      headRunId: "run-1",
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost:3000/api/v1/reviews/${reviewId}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        findingFingerprint: "fp_unknown_unrelated",
        disposition: "fixed",
        reason: "Fixed trace clearance in board layout",
        owner: "engineer@company.com",
        evidenceDigest,
      }),
    });

    const res = await postDecision(req, { params });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Finding not found in review run");
  });

  it("POST assignments route verifies finding belongs to review head run and returns 404 for unknown finding", async () => {
    const mockExecutor = createMockExecutor();
    mockExecutor.query.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from reviews")) {
        return {
          rows: [
            {
              review_id: reviewId,
              repository_id: repositoryId,
              head_run_id: "run-1",
              current_revision_id: revisionId,
              github_installation_id: 1001,
            },
          ],
        };
      }
      if (norm.includes("from findings where run_id = $1")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "test-actor",
      scopes: ["reviews:write"],
      authType: "session",
      installationIds: [1001],
    });

    vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
      reviewId,
      repositoryId,
      headRunId: "run-1",
      currentRevisionId: revisionId,
      executor: mockExecutor as unknown as PgQueryExecutor,
    });

    const params = Promise.resolve({ id: reviewId });
    const req = new Request(`http://localhost:3000/api/v1/reviews/${reviewId}/assignments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        findingFingerprint: "fp_unknown_unrelated",
        assignee: "alice@company.com",
      }),
    });

    const res = await postAssignment(req, { params });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Finding not found in review run");
  });
});
