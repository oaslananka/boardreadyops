import { describe, expect, it } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import {
  ReviewStore,
  type StoredReviewRevisionRow,
  type StoredReviewRow,
} from "../../../packages/db/src/review-store.js";

class InMemoryMockDb implements SqlQueryExecutor {
  reviews: StoredReviewRow[] = [];
  revisions: StoredReviewRevisionRow[] = [];
  releaseRuns: { id: string; repository_id: string }[] = [];
  findings: {
    id: string;
    run_id: string;
    rule_id: string;
    severity: "error" | "high" | "medium" | "low" | "info";
    message: string;
    path: string | null;
    kind: string | null;
    fingerprint: string | null;
    waived_at: string | Date | null;
  }[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.toLowerCase();

    // Check existing review by PR
    if (s.includes("from reviews where repository_id = $1 and pull_request_number = $2")) {
      const repoId = params[0] as string;
      const pr = params[1] as number;
      const found = this.reviews.filter((r) => r.repository_id === repoId && r.pull_request_number === pr);
      return { rows: found };
    }

    // Check existing review by head_run_id
    if (s.includes("from reviews where repository_id = $1 and head_run_id = $2")) {
      const repoId = params[0] as string;
      const runId = params[1] as string;
      const found = this.reviews.filter((r) => r.repository_id === repoId && r.head_run_id === runId);
      return { rows: found };
    }

    // Get review by id
    if (s.includes("from reviews where id = $1 and repository_id = $2")) {
      const id = params[0] as string;
      const repoId = params[1] as string;
      const found = this.reviews.filter((r) => r.id === id && r.repository_id === repoId);
      return { rows: found };
    }

    // Next sequence
    if (s.includes("max(sequence)")) {
      const reviewId = params[0] as string;
      const revs = this.revisions.filter((r) => r.review_id === reviewId);
      const maxSeq = revs.length > 0 ? Math.max(...revs.map((r) => r.sequence)) : 0;
      return { rows: [{ next_seq: maxSeq + 1 }] };
    }

    // Insert revision
    if (s.includes("insert into review_revisions")) {
      const row: StoredReviewRevisionRow = {
        id: params[0] as string,
        review_id: params[1] as string,
        sequence: params[2] as number,
        base_run_id: params[3] as string | null,
        head_run_id: params[4] as string,
        base_commit_sha: params[5] as string | null,
        head_commit_sha: params[6] as string,
        evidence_digest: params[7] as string,
        created_at: params[8] as string,
      };
      this.revisions.push(row);
      return { rows: [row] };
    }

    // Upsert review
    if (s.includes("insert into reviews")) {
      const id = params[0] as string;
      const existingIdx = this.reviews.findIndex((r) => r.id === id);
      const existing = existingIdx >= 0 ? this.reviews[existingIdx] : undefined;
      const row: StoredReviewRow = {
        id,
        repository_id: params[1] as string,
        pull_request_number: params[2] as number | null,
        title: params[3] as string,
        status: "active",
        decision: "pending",
        base_run_id: params[4] as string | null,
        head_run_id: params[5] as string,
        current_revision_id: params[6] as string,
        created_by: params[7] as string,
        created_at: existing ? existing.created_at : (params[8] as string),
        updated_at: params[8] as string,
        completed_at: null,
      };
      if (existingIdx >= 0) {
        this.reviews[existingIdx] = row;
      } else {
        this.reviews.push(row);
      }
      return { rows: [row] };
    }

    // List reviews
    if (s.includes("select * from reviews where repository_id = $1")) {
      const repoId = params[0] as string;
      const matched = this.reviews.filter((r) => r.repository_id === repoId);
      // Sort desc
      matched.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      return { rows: matched };
    }

    // List revisions
    if (s.includes("select * from review_revisions where review_id = $1")) {
      const reviewId = params[0] as string;
      const revs = this.revisions.filter((r) => r.review_id === reviewId);
      revs.sort((a, b) => a.sequence - b.sequence);
      return { rows: revs };
    }

    return { rows: [] };
  }
}

describe("ReviewStore", () => {
  it("creates initial review with revision sequence 1, then increments sequence on subsequent run", async () => {
    const db = new InMemoryMockDb();
    const store = new ReviewStore(db);

    const firstRun = await store.upsertReviewForRun({
      repositoryId: "repo-1",
      pullRequestNumber: 42,
      title: "Add power circuit",
      headRunId: "run-101",
      headCommitSha: "abc1111111111111111111111111111111111111",
      evidenceDigest: "a".repeat(64),
      createdBy: "eng-1",
    });

    expect(firstRun.review.repositoryId).toBe("repo-1");
    expect(firstRun.review.pullRequestNumber).toBe(42);
    expect(firstRun.revision.sequence).toBe(1);
    expect(firstRun.review.currentRevisionId).toBe(firstRun.revision.id);

    // Second run on same PR
    const secondRun = await store.upsertReviewForRun({
      repositoryId: "repo-1",
      pullRequestNumber: 42,
      title: "Add power circuit",
      headRunId: "run-102",
      headCommitSha: "abc2222222222222222222222222222222222222",
      baseRunId: "run-101",
      evidenceDigest: "b".repeat(64),
      createdBy: "eng-1",
    });

    expect(secondRun.review.id).toBe(firstRun.review.id);
    expect(secondRun.revision.sequence).toBe(2);
    expect(secondRun.revision.baseRunId).toBe("run-101");
    expect(secondRun.review.currentRevisionId).toBe(secondRun.revision.id);

    const revisions = await store.listReviewRevisions("repo-1", firstRun.review.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.sequence).toBe(1);
    expect(revisions[1]?.sequence).toBe(2);
  });

  it("enforces tenant isolation across repositories", async () => {
    const db = new InMemoryMockDb();
    const store = new ReviewStore(db);

    const run = await store.upsertReviewForRun({
      repositoryId: "repo-tenant-A",
      pullRequestNumber: 10,
      title: "Review A",
      headRunId: "run-A",
      headCommitSha: "abc1111111111111111111111111111111111111",
      evidenceDigest: "a".repeat(64),
    });

    const tenantAView = await store.getReviewById("repo-tenant-A", run.review.id);
    expect(tenantAView).toBeDefined();

    const tenantBView = await store.getReviewById("repo-tenant-B", run.review.id);
    expect(tenantBView).toBeUndefined();

    const tenantBRevs = await store.listReviewRevisions("repo-tenant-B", run.review.id);
    expect(tenantBRevs).toHaveLength(0);
  });
});
