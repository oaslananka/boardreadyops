import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  prepareClaimedFindingCollaborationSnapshot as prepare,
  ExportFindingCollaborationSnapshotUnavailableError as Unavailable,
} from "../../../packages/db/src/data-export-finding-collaboration-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const claim = {
  exportId: "exp-1",
  tenantId: "tenant-1",
  installationId: "install-1",
  workerId: "worker-1",
  token: "token-1",
};
const decision = {
  id: "decision-1",
  repository_id: "repo-1",
  review_repository_id: "repo-1",
  review_id: "review-1",
  finding_fingerprint: "fingerprint-1",
  disposition: "accepted_risk",
  reason: "Synthetic risk acceptance rationale with sufficient detail",
  owner: "owner-1",
  expires_at: "2026-12-01T01:02:03.000Z",
  evidence_digest: "a".repeat(64),
  actor_id: "actor-1",
  created_at: "2026-10-01T01:02:03.000Z",
};
const assignment = {
  id: "assignment-1",
  repository_id: "repo-1",
  review_repository_id: "repo-1",
  review_id: "review-1",
  finding_fingerprint: "fingerprint-1",
  assignee: "assignee-1",
  assigned_by: "actor-1",
  created_at: "2026-10-01T01:02:03.000Z",
};
function fixture(rows: unknown[] = [{ decisions: [decision], assignments: [assignment] }]) {
  const query = vi.fn(async (_sql: string, _params: readonly unknown[]) => ({ rows }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}
async function rejects(decisions: unknown[] = [decision], assignments: unknown[] = [assignment]) {
  await expect(prepare(fixture([{ decisions, assignments }]).db, claim)).rejects.toThrow(Unavailable);
}

describe("claimed finding collaboration snapshot", () => {
  it("preserves decision history and assignment fields with SHA and original scoped claim", async () => {
    const { db, query } = fixture();
    const result = await prepare(db, claim);
    const payload = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(payload.decisions).toEqual([
      expect.objectContaining({
        id: decision.id,
        repositoryId: decision.repository_id,
        reviewId: decision.review_id,
        findingFingerprint: decision.finding_fingerprint,
        disposition: decision.disposition,
        reason: decision.reason,
        owner: decision.owner,
        expiresAt: decision.expires_at,
        evidenceDigest: decision.evidence_digest,
        actorId: decision.actor_id,
        createdAt: decision.created_at,
      }),
    ]);
    expect(payload.assignments).toEqual([
      expect.objectContaining({
        id: assignment.id,
        repositoryId: assignment.repository_id,
        reviewId: assignment.review_id,
        findingFingerprint: assignment.finding_fingerprint,
        assignee: assignment.assignee,
        assignedBy: assignment.assigned_by,
        createdAt: assignment.created_at,
      }),
    ]);
    expect(result?.sha256).toBe(
      createHash("sha256")
        .update(result?.bytes ?? Buffer.alloc(0))
        .digest("hex"),
    );
    expect(result?.contentType).toBe("application/json");
    expect(payload).not.toHaveProperty("downloadUrl");
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual(Object.values(claim));
    for (const marker of [
      "exp.preparation_lease_until>NOW()",
      "inst.suspended_at IS NULL",
      "repo.disabled_at IS NULL",
      "permitted.id=r.repository_id",
      "ORDER BY d.id LIMIT 101",
      "ORDER BY a.id LIMIT 101",
      "octet_length(decisions.rows::text)+octet_length(assignments.rows::text)<=262144",
    ])
      expect(sql).toContain(marker);
  });
  it("returns empty bounded metadata for authorized empty data and null for missing claim", async () => {
    const result = await prepare(fixture([{ decisions: [], assignments: [] }]).db, claim);
    expect(JSON.parse(result?.bytes.toString("utf8") ?? "{}")).toMatchObject({
      decisions: [],
      assignments: [],
      exportId: claim.exportId,
    });
    await expect(prepare(fixture([]).db, claim)).resolves.toBeNull();
  });
  it("refuses an invalid claim before querying", async () => {
    const { db, query } = fixture();
    await expect(prepare(db, { ...claim, workerId: "" })).rejects.toThrow(Unavailable);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects wrong database shape, overlong rows and non-object entries", async () => {
    for (const input of [
      { decisions: null, assignments: [] },
      { decisions: [], assignments: null },
      { decisions: Array.from({ length: 101 }, () => decision), assignments: [] },
      { decisions: [], assignments: Array.from({ length: 101 }, () => assignment) },
      { decisions: [null], assignments: [] },
      { decisions: [], assignments: [null] },
      { decisions: [["bad"]], assignments: [] },
      { decisions: [], assignments: [["bad"]] },
    ])
      await expect(prepare(fixture([input]).db, claim)).rejects.toThrow(Unavailable);
  });
  it("fails closed on cross-repository, malformed evidence or oversized decisions", async () => {
    for (const value of [
      { ...decision, repository_id: "foreign" },
      { ...decision, review_repository_id: "foreign" },
      { ...decision, id: "" },
      { ...decision, owner: "x".repeat(257) },
      { ...decision, disposition: "unknown" },
      { ...decision, expires_at: "wrong" },
      { ...decision, created_at: null },
      { ...decision, evidence_digest: "wrong" },
      { ...decision, reason: "Ü".repeat(2100) },
      { ...decision, finding_fingerprint: "Ü".repeat(1025) },
      { ...decision, actor_id: " " },
    ])
      await rejects([value], []);
  });
  it("rejects forged assignments and malformed fields", async () => {
    for (const value of [
      { ...assignment, repository_id: "foreign" },
      { ...assignment, review_repository_id: "foreign" },
      { ...assignment, id: null },
      { ...assignment, assignee: " " },
      { ...assignment, assigned_by: "x".repeat(257) },
      { ...assignment, finding_fingerprint: "Ü".repeat(1025) },
      { ...assignment, created_at: "bad" },
    ])
      await rejects([], [value]);
  });
  it("keeps legal empty strings and nullable expiry without losing record fidelity", async () => {
    const result = await prepare(
      fixture([
        {
          decisions: [{ ...decision, finding_fingerprint: "", reason: "", expires_at: null }],
          assignments: [{ ...assignment, finding_fingerprint: "" }],
        },
      ]).db,
      claim,
    );
    const data = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(data.decisions[0]).toMatchObject({ findingFingerprint: "", reason: "", expiresAt: null });
    expect(data.assignments[0].findingFingerprint).toBe("");
  });
  it("rejects duplicate IDs or large aggregate rather than silently truncating", async () => {
    await rejects([decision, decision], []);
    await rejects([], [assignment, assignment]);
    const lots = Array.from({ length: 72 }, (_, i) => ({ ...decision, id: String(i), reason: "x".repeat(4000) }));
    await rejects(lots, []);
  });
});
