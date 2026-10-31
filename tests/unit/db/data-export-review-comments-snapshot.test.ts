import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  prepareClaimedReviewCommentsSnapshot as prepare,
  ExportReviewCommentsSnapshotUnavailableError as Unavailable,
} from "../../../packages/db/src/data-export-review-comments-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const claim = {
  exportId: "export-1",
  tenantId: "tenant-1",
  installationId: "install-1",
  workerId: "worker-1",
  token: "token-1",
};
const comment = {
  id: "comment-1",
  review_id: "review-1",
  repository_id: "repo-1",
  review_repository_id: "repo-1",
  parent_id: null,
  parent_valid: true,
  author_id: "actor-1",
  author_type: "internal",
  content: "synthetic",
  status: "open",
  finding_fingerprint: "fp-1",
  evidence_anchor: "anchor-1",
  created_at: "2026-10-01T01:02:03.000Z",
  updated_at: "2026-10-02T01:02:03.000Z",
};
function fixture(rows: unknown[] = [{ comments: [comment] }]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}
async function rejects(candidate: unknown) {
  await expect(prepare(fixture([{ comments: [candidate] }]).db, claim)).rejects.toThrow(Unavailable);
}

describe("review comment export claim snapshot", () => {
  it("returns deterministic complete fields, digest and bounded SQL scopes", async () => {
    const { db, query } = fixture();
    const result = await prepare(db, claim);
    const data = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(data.comments).toEqual([
      expect.objectContaining({
        id: comment.id,
        reviewId: comment.review_id,
        repositoryId: comment.repository_id,
        findingFingerprint: comment.finding_fingerprint,
        evidenceAnchor: comment.evidence_anchor,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
      }),
    ]);
    expect(result?.sha256).toBe(
      createHash("sha256")
        .update(result?.bytes ?? Buffer.alloc(0))
        .digest("hex"),
    );
    expect(result?.contentType).toBe("application/json");
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual(Object.values(claim));
    for (const part of [
      "exp.preparation_lease_until > NOW()",
      "inst.suspended_at IS NULL",
      "repo.disabled_at IS NULL",
      "parent.review_id=comments.review_id",
      "comment_bundle AS MATERIALIZED",
      "OCTET_LENGTH(comment_bundle.comments::text) <= 262144",
      "CHAR_LENGTH(comments.author_id) <= 256",
      "OCTET_LENGTH(comments.content) <= 65536",
      "LIMIT 101",
    ])
      expect(sql).toContain(part);
  });
  it("returns no slice for a missing original worker claim", async () => {
    await expect(prepare(fixture([]).db, claim)).resolves.toBeNull();
  });
  it("rejects invalid claim before SQL", async () => {
    const { db, query } = fixture();
    await expect(prepare(db, { ...claim, token: " " })).rejects.toThrow(Unavailable);
    expect(query).not.toHaveBeenCalled();
  });
  it("returns scoped empty data, never an export completion", async () => {
    const result = await prepare(fixture([{ comments: [] }]).db, claim);
    const data = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(data.comments).toEqual([]);
    expect(data).not.toHaveProperty("downloadUrl");
  });
  it("rejects malformed SQL rows instead of silently truncating", async () => {
    for (const row of [
      { comments: null },
      { comments: [null] },
      { comments: [{ ...comment, repository_id: "foreign" }] },
      { comments: [{ ...comment, review_repository_id: "" }] },
      { comments: [{ ...comment, parent_valid: false }] },
      { comments: [{ ...comment, author_type: "guest-admin" }] },
      { comments: [{ ...comment, status: "deleted" }] },
      { comments: Array.from({ length: 101 }, () => comment) },
    ])
      await expect(prepare(fixture([row]).db, claim)).rejects.toThrow(Unavailable);
  });
  it("rejects malformed identity, time, comment and optional evidence fields", async () => {
    for (const row of [
      { ...comment, id: "" },
      { ...comment, author_id: "x".repeat(257) },
      { ...comment, content: null },
      { ...comment, content: "Ü".repeat(40_000) },
      { ...comment, parent_id: " " },
      { ...comment, evidence_anchor: "e".repeat(2049) },
      { ...comment, created_at: "garbled" },
      { ...comment, updated_at: null },
    ])
      await rejects(row);
  });
  it("keeps nullable evidence and accepts exact comment bytes cap", async () => {
    const slice = await prepare(
      fixture([
        { comments: [{ ...comment, finding_fingerprint: null, evidence_anchor: null, content: "a".repeat(65536) }] },
      ]).db,
      claim,
    );
    expect(JSON.parse(slice?.bytes.toString("utf8") ?? "{}").comments[0]).toMatchObject({
      findingFingerprint: null,
      evidenceAnchor: null,
    });
  });
  it("rejects total payload >256KiB without dropping comments", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      ...comment,
      id: `comment-${i}`,
      content: "a".repeat(60000),
    }));
    await expect(prepare(fixture([{ comments: candidates }]).db, claim)).rejects.toThrow(Unavailable);
  });
  it("preserves valid empty evidence fields without accepting SQL overflow sentinels", async () => {
    const slice = await prepare(
      fixture([{ comments: [{ ...comment, finding_fingerprint: "", evidence_anchor: "" }] }]).db,
      claim,
    );
    expect(JSON.parse(slice?.bytes.toString("utf8") ?? "{}").comments[0]).toMatchObject({
      findingFingerprint: "",
      evidenceAnchor: "",
    });
    await rejects({ ...comment, finding_fingerprint: "x".repeat(2049) });
    await rejects({ ...comment, evidence_anchor: "x".repeat(2049) });
  });

  it("validates complete parent chains and rejects missing, cyclic or duplicate parents", async () => {
    const parent = { ...comment, id: "parent" };
    const child = { ...comment, id: "child", parent_id: "parent" };
    const good = await prepare(fixture([{ comments: [parent, child] }]).db, claim);
    expect(JSON.parse(good?.bytes.toString("utf8") ?? "{}").comments[1].parentId).toBe("parent");
    for (const comments of [
      [child],
      [{ ...comment, id: "self", parent_id: "self" }],
      [
        { ...comment, id: "a", parent_id: "b" },
        { ...comment, id: "b", parent_id: "a" },
      ],
      [
        { ...comment, id: "a", review_id: "other" },
        { ...comment, id: "b", parent_id: "a" },
      ],
      [parent, parent],
    ])
      await expect(prepare(fixture([{ comments }]).db, claim)).rejects.toThrow(Unavailable);
  });
});
