import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ExportReviewAuditSnapshotUnavailableError,
  prepareClaimedReviewAuditSnapshot,
} from "../../../packages/db/src/data-export-review-audit-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const claim = {
  exportId: "export-1",
  tenantId: "tenant-1",
  installationId: "install-1",
  workerId: "worker-1",
  token: "claim-1",
};
const review = {
  id: "review-1",
  repository_id: "repo-1",
  head_run_id: "run-1",
  title: "synthetic review",
  status: "completed",
  decision: "approved",
};
const revision = {
  id: "revision-1",
  review_id: "review-1",
  sequence: 1,
  base_run_id: null,
  head_run_id: "run-1",
  base_commit_sha: null,
  head_commit_sha: "a".repeat(40),
  evidence_digest: "b".repeat(64),
};
const audit = {
  id: "audit-1",
  repository_id: "repo-1",
  release_run_id: "run-1",
  event_type: "review.approved",
  actor_type: "system",
  subject_type: "review",
  subject_id: "review-1",
};
function fixture(rows: unknown[] = [{ reviews: [review], revisions: [revision], audit_events: [audit] }]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}

describe("claimed, bounded review and audit descriptor snapshot", () => {
  it("returns deterministic scoped metadata with digest, without sensitive audit metadata", async () => {
    const { db, query } = fixture();
    const result = await prepareClaimedReviewAuditSnapshot(db, claim);
    expect(result).not.toBeNull();
    const decoded = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(decoded.reviews).toEqual([
      {
        id: review.id,
        repositoryId: review.repository_id,
        headRunId: review.head_run_id,
        title: review.title,
        status: review.status,
        decision: review.decision,
      },
    ]);
    expect(decoded.revisions).toEqual([
      {
        id: revision.id,
        reviewId: revision.review_id,
        sequence: 1,
        baseRunId: null,
        headRunId: revision.head_run_id,
        baseCommitSha: null,
        headCommitSha: revision.head_commit_sha,
        evidenceDigest: revision.evidence_digest,
      },
    ]);
    expect(decoded.exclusions).not.toContain("review-revisions");
    expect(decoded.auditEvents).toEqual([
      {
        id: audit.id,
        repositoryId: audit.repository_id,
        releaseRunId: audit.release_run_id,
        eventType: audit.event_type,
        actorType: audit.actor_type,
        subjectType: audit.subject_type,
        subjectId: audit.subject_id,
      },
    ]);
    expect(decoded.exclusions).toContain("audit-metadata");
    expect(decoded.exclusions).toContain("review-comments");
    expect(result?.byteLength).toBe(result?.bytes.length);
    expect(result?.sha256).toBe(
      createHash("sha256")
        .update(result?.bytes ?? Buffer.alloc(0))
        .digest("hex"),
    );
    expect(result?.contentType).toBe("application/json");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("permitted_repositories"), Object.values(claim));
    expect(query.mock.calls[0]?.[0]).toContain("audit.installation_id");
  });

  it("returns an explicit empty scope when there are no authorized records", async () => {
    const { db } = fixture([{ reviews: [], revisions: [], audit_events: [] }]);
    const result = await prepareClaimedReviewAuditSnapshot(db, claim);
    const parsed = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(parsed.reviews).toEqual([]);
    expect(parsed.revisions).toEqual([]);
    expect(parsed.auditEvents).toEqual([]);
  });

  it("returns null for an invalid or inactive original claim", async () => {
    const { db } = fixture([]);
    await expect(prepareClaimedReviewAuditSnapshot(db, claim)).resolves.toBeNull();
  });

  it("rejects malformed claim inputs before executing a query", async () => {
    const { db, query } = fixture();
    await expect(prepareClaimedReviewAuditSnapshot(db, { ...claim, token: " " })).rejects.toThrow(
      ExportReviewAuditSnapshotUnavailableError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed rather than truncating 101 reviews, revisions or audit events", async () => {
    for (const record of [
      { reviews: Array.from({ length: 101 }, () => review), revisions: [], audit_events: [] },
      { reviews: [], revisions: Array.from({ length: 101 }, () => revision), audit_events: [] },
      { reviews: [], revisions: [], audit_events: Array.from({ length: 101 }, () => audit) },
    ]) {
      await expect(prepareClaimedReviewAuditSnapshot(fixture([record]).db, claim)).rejects.toThrow(
        ExportReviewAuditSnapshotUnavailableError,
      );
    }
  });

  it("rejects malformed data instead of serializing an unverified object", async () => {
    for (const row of [
      { reviews: null, revisions: [], audit_events: [] },
      { reviews: [], revisions: [], audit_events: null },
      { reviews: [null], revisions: [], audit_events: [] },
      { reviews: [], revisions: [], audit_events: [null] },
      { reviews: [], revisions: null, audit_events: [] },
      { reviews: [], revisions: [null], audit_events: [] },
      { reviews: [], revisions: [{ ...revision, sequence: 0 }], audit_events: [] },
      { reviews: [], revisions: [{ ...revision, sequence: 1.5 }], audit_events: [] },
      { reviews: [], revisions: [{ ...revision, head_run_id: "" }], audit_events: [] },
      { reviews: [], revisions: [{ ...revision, base_run_id: " " }], audit_events: [] },
      { reviews: [], revisions: [{ ...revision, evidence_digest: "not-sha256" }], audit_events: [] },
      { reviews: [{ ...review, id: "" }], revisions: [], audit_events: [] },
      { reviews: [{ ...review, title: null }], revisions: [], audit_events: [] },
      { reviews: [], revisions: [], audit_events: [{ ...audit, repository_id: "" }] },
      { reviews: [], revisions: [], audit_events: [{ ...audit, release_run_id: " " }] },
    ]) {
      await expect(prepareClaimedReviewAuditSnapshot(fixture([row]).db, claim)).rejects.toThrow(
        ExportReviewAuditSnapshotUnavailableError,
      );
    }
  });

  it("rejects an oversized snapshot rather than silently dropping rows", async () => {
    const oversized = { ...review, title: "x".repeat(263_000) };
    await expect(
      prepareClaimedReviewAuditSnapshot(fixture([{ reviews: [oversized], revisions: [], audit_events: [] }]).db, claim),
    ).rejects.toThrow(ExportReviewAuditSnapshotUnavailableError);
  });
});
