import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  prepareClaimedReviewWorkflowSnapshot as prepare,
  ExportReviewWorkflowSnapshotUnavailableError as Unavailable,
} from "../../../packages/db/src/data-export-review-workflow-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const claim = { exportId: "exp", tenantId: "tenant", installationId: "inst", workerId: "worker", token: "token" };
const approval = {
  id: "app",
  repository_id: "repo",
  parent_repository_id: "repo",
  review_id: "review",
  revision_id: "rev",
  valid_revision: true,
  evidence_digest: "b".repeat(64),
  approver_id: "actor",
  status: "approved",
  reason: "approved review",
  is_break_glass: false,
  invalidated_at: null,
  invalidated_by: null,
  invalidation_reason: null,
  created_at: "2026-10-01T01:02:03.000Z",
  updated_at: "2026-10-02T01:02:03.000Z",
};
const item = {
  id: "item",
  repository_id: "repo",
  parent_repository_id: "repo",
  review_id: "review",
  title: "Checklist",
  completed: true,
  completed_by: "actor",
  completed_at: "2026-10-02T01:02:03.000Z",
  created_at: "2026-10-01T01:02:03.000Z",
};
function fixture(rows: unknown[] = [{ approvals: [approval], checklist: [item] }]) {
  const query = vi.fn(async (_sql: string, _params: readonly unknown[]) => ({ rows }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}
async function rejected(approvals: unknown[] = [approval], checklist: unknown[] = [item]) {
  await expect(prepare(fixture([{ approvals, checklist }]).db, claim)).rejects.toThrow(Unavailable);
}

describe("claimed review workflow evidence", () => {
  it("preserves approval and checklist fidelity, checksum, scope and rev relationships", async () => {
    const { db, query } = fixture();
    const result = await prepare(db, claim);
    const payload = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(payload.approvals).toEqual([
      expect.objectContaining({
        id: "app",
        repositoryId: "repo",
        revisionId: "rev",
        evidenceDigest: "b".repeat(64),
        reason: "approved review",
        isBreakGlass: false,
        invalidatedAt: null,
        createdAt: approval.created_at,
        updatedAt: approval.updated_at,
      }),
    ]);
    expect(payload.checklistItems).toEqual([
      expect.objectContaining({
        id: "item",
        repositoryId: "repo",
        title: "Checklist",
        completed: true,
        completedBy: "actor",
        completedAt: item.completed_at,
      }),
    ]);
    expect(result?.sha256).toBe(
      createHash("sha256")
        .update(result?.bytes ?? Buffer.alloc(0))
        .digest("hex"),
    );
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual(Object.values(claim));
    for (const marker of [
      "exp.preparation_lease_until>NOW()",
      "inst.suspended_at IS NULL",
      "repo.disabled_at IS NULL",
      "rev.review_id=a.review_id",
      "run.repository_id=r.repository_id",
      "base_run.repository_id=r.repository_id",
      "a.id LIMIT 101",
      "item.id LIMIT 101",
      "octet_length(approvals.rows::text)+octet_length(checklist.rows::text)<=262144",
    ])
      expect(sql).toContain(marker);
  });
  it("returns null only for an unclaimed export", async () => {
    await expect(prepare(fixture([]).db, claim)).resolves.toBeNull();
    const { db, query } = fixture();
    await expect(prepare(db, { ...claim, token: "" })).rejects.toThrow(Unavailable);
    expect(query).not.toHaveBeenCalled();
  });
  it("retains legitimate nullable fields and empty string values", async () => {
    const value = await prepare(
      fixture([
        {
          approvals: [{ ...approval, reason: "", invalidation_reason: "" }],
          checklist: [{ ...item, title: "", completed: false, completed_at: null, completed_by: null }],
        },
      ]).db,
      claim,
    );
    const result = JSON.parse(value?.bytes.toString("utf8") ?? "{}");
    expect(result.approvals[0].reason).toBe("");
    expect(result.checklistItems[0].title).toBe("");
  });
  it("rejects missing or overflowing arrays and malformed rows", async () => {
    for (const payload of [
      { approvals: null, checklist: [] },
      { approvals: [], checklist: null },
      { approvals: [null], checklist: [] },
      { approvals: [], checklist: [null] },
      { approvals: Array.from({ length: 101 }, () => approval), checklist: [] },
      { approvals: [], checklist: Array.from({ length: 101 }, () => item) },
    ])
      await expect(prepare(fixture([payload]).db, claim)).rejects.toThrow(Unavailable);
  });
  it("rejects cross-repository and invalid revision relations", async () => {
    for (const candidate of [
      { ...approval, repository_id: "foreign" },
      { ...approval, parent_repository_id: "foreign" },
      { ...approval, valid_revision: false },
      { ...approval, evidence_digest: "wrong" },
      { ...approval, status: "pending" },
      { ...approval, approver_id: " " },
      { ...approval, is_break_glass: null },
      { ...approval, created_at: "wrong" },
      { ...approval, invalidated_at: "invalid" },
      { ...approval, reason: "Ü".repeat(3000) },
      { ...approval, invalidated_by: "x".repeat(257) },
      { ...approval, invalidation_reason: "x".repeat(4097) },
    ])
      await rejected([candidate], []);
  });
  it("rejects malformed checklist or duplicate IDs and oversize payload", async () => {
    for (const candidate of [
      { ...item, repository_id: "foreign" },
      { ...item, title: "Ü".repeat(3000) },
      { ...item, completed: "yes" },
      { ...item, completed_by: " " },
      { ...item, completed_at: "wrong" },
      { ...item, created_at: "invalid" },
    ])
      await rejected([], [candidate]);
    await rejected([approval, approval], []);
    await rejected([], [item, item]);
    const oversized = Array.from({ length: 75 }, (_, index) => ({
      ...item,
      id: String(index),
      title: "x".repeat(4096),
    }));
    await rejected([], oversized);
  });
});
