import { describe, expect, it, vi } from "vitest";
import { POST as postApproval } from "../../../apps/web/app/api/v1/reviews/[id]/approvals/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";

const reviewId = "rev_gated_1";
const repositoryId = "repo-gated";
const revisionId = "rev_seq_1";
const headRunId = "run-gated-1";
const tenantId = "lead.hardware@company.com";
const evidenceDigest = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

type MockOptions = {
  findingSeverity?: string;
  severityGate?: "error" | "high" | "medium" | null;
  requiredChecklist?: string[];
  checklistItems?: { id: string; title: string; completed: boolean }[];
};

function createMockExecutor(options: MockOptions = {}) {
  const { findingSeverity = "high", severityGate = "high", requiredChecklist = [], checklistItems = [] } = options;

  const queries: { sql: string; params: unknown[] }[] = [];

  return {
    queries,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from review_revisions where id = $1")) {
        return {
          rows: [
            {
              id: params[0] as string,
              sequence: 1,
              base_commit_sha: "0".repeat(40),
              head_commit_sha: "1".repeat(40),
              evidence_digest: evidenceDigest,
            },
          ],
        };
      }
      if (norm.includes("from release_runs where id = $1")) {
        return { rows: [{ id: headRunId }] };
      }
      if (norm.includes("from findings where run_id = $1")) {
        return {
          rows: [
            {
              fingerprint: "fp_open_finding",
              severity: findingSeverity,
              rule_id: "kicad/track-clearance",
              path: "board.kicad_pcb",
            },
          ],
        };
      }
      if (norm.includes("from finding_decisions")) {
        return { rows: [] }; // no decision recorded -> finding stays open/unwaived
      }
      if (norm.includes("from review_checklist_items")) {
        return { rows: checklistItems };
      }
      if (norm.includes("from review_policies")) {
        if (norm.includes("scope = $2") && params[1] === "repository") {
          return {
            rows: [
              {
                id: "rpol_1",
                tenantId,
                scope: "repository",
                scopeId: repositoryId,
                name: "Repository Gate",
                description: null,
                requiredChecklist,
                requiredRoles: [],
                severityGate,
                requireEvidencePack: false,
                requireExternalReview: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
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
        return { rows: [record] };
      }
      if (norm.includes("from review_approvals")) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
    close: vi.fn(async () => {}),
  };
}

function mockAuthAndContext(executor: ReturnType<typeof createMockExecutor>) {
  vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
    ok: true,
    repositoryId,
    actorId: tenantId,
    scopes: ["reviews:write"],
    authType: "session",
    installationIds: [1001],
  });
  vi.spyOn(apiAuth, "resolveReviewApiContext").mockResolvedValue({
    reviewId,
    repositoryId,
    headRunId,
    currentRevisionId: revisionId,
    executor: executor as unknown as PgQueryExecutor,
  });
}

function approvalRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/v1/reviews/${reviewId}/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revisionId, evidenceDigest, ...body }),
  });
}

describe("POST /api/v1/reviews/[id]/approvals enforces effective policy readiness", () => {
  it("blocks approval with 409 when an open finding is at or above the policy severity gate", async () => {
    const executor = createMockExecutor({ findingSeverity: "high", severityGate: "high" });
    mockAuthAndContext(executor);

    const res = await postApproval(approvalRequest({ status: "approved" }), {
      params: Promise.resolve({ id: reviewId }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string; blockers: Array<{ type: string }> };
    expect(body.ok).toBe(false);
    expect(body.blockers.some((b) => b.type === "unresolved_finding")).toBe(true);
  });

  it("allows approval when the open finding is below the policy severity gate", async () => {
    const executor = createMockExecutor({ findingSeverity: "medium", severityGate: "high" });
    mockAuthAndContext(executor);

    const res = await postApproval(approvalRequest({ status: "approved" }), {
      params: Promise.resolve({ id: reviewId }),
    });

    expect(res.status).toBe(201);
  });

  it("blocks approval with 409 when a policy-required checklist item is missing", async () => {
    const executor = createMockExecutor({
      findingSeverity: "medium",
      severityGate: "high",
      requiredChecklist: ["Thermal simulation reviewed"],
      checklistItems: [],
    });
    mockAuthAndContext(executor);

    const res = await postApproval(approvalRequest({ status: "approved" }), {
      params: Promise.resolve({ id: reviewId }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; blockers: Array<{ type: string }> };
    expect(body.blockers.some((b) => b.type === "missing_required_checklist_item")).toBe(true);
  });

  it("allows approval once the required checklist item is present and completed", async () => {
    const executor = createMockExecutor({
      findingSeverity: "medium",
      severityGate: "high",
      requiredChecklist: ["Thermal simulation reviewed"],
      checklistItems: [{ id: "chk_1", title: "Thermal simulation reviewed", completed: true }],
    });
    mockAuthAndContext(executor);

    const res = await postApproval(approvalRequest({ status: "approved" }), {
      params: Promise.resolve({ id: reviewId }),
    });

    expect(res.status).toBe(201);
  });

  it("lets a break-glass approval bypass the policy gate despite an open blocking finding", async () => {
    const executor = createMockExecutor({ findingSeverity: "high", severityGate: "high" });
    mockAuthAndContext(executor);

    const res = await postApproval(approvalRequest({ status: "approved", isBreakGlass: true }), {
      params: Promise.resolve({ id: reviewId }),
    });

    expect(res.status).toBe(201);
  });

  it("does not run the readiness gate for changes_requested submissions", async () => {
    const executor = createMockExecutor({ findingSeverity: "high", severityGate: "high" });
    mockAuthAndContext(executor);

    const res = await postApproval(approvalRequest({ status: "changes_requested", reason: "Needs rework" }), {
      params: Promise.resolve({ id: reviewId }),
    });

    expect(res.status).toBe(201);
    const policyQueries = executor.queries.filter((q) => q.sql.toLowerCase().includes("from review_policies"));
    expect(policyQueries).toHaveLength(0);
  });
});
