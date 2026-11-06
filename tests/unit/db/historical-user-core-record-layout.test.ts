import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HistoricalUserInventoryUnavailableError,
  prepareVerifiedHistoricalUserConsistentCorePreflight,
} from "../../../packages/db/src/data-export-historical-inventory.js";

const exportId = randomUUID();
const repositoryId = randomUUID();
const runId = randomUUID();
const reviewId = randomUUID();
const revisionId = randomUUID();
const commentId = randomUUID();
const sha = "a".repeat(64);

function retainedOriginalUserFixture(): Record<string, unknown> {
  return {
    id: exportId,
    repositories: [
      {
        repositoryId,
        githubRepositoryId: "123456",
        owner: "private-owner",
        name: "private-name",
        private: true,
        disabled: true,
      },
    ],
    runs: [
      {
        id: runId,
        repository_id: repositoryId,
        commit_sha: sha.slice(0, 40),
        ref: "private-branch",
        status: "completed",
        decision: null,
      },
    ],
    findings: [
      {
        id: randomUUID(),
        run_id: runId,
        rule_id: "example",
        severity: "high",
        message: "private-message",
        path: "private-path",
        kind: null,
      },
    ],
    artifacts: [
      {
        id: randomUUID(),
        run_id: runId,
        kind: "other",
        name: "private-file",
        role: "evidence",
        sha256: sha,
        bytes: 1024,
        content_type: "application/octet-stream",
        retention_expired: false,
      },
    ],
    reviews: [
      {
        id: reviewId,
        repository_id: repositoryId,
        head_run_id: runId,
        title: "private-review",
        status: "open",
        decision: "pending",
        foreign_head_run: false,
      },
    ],
    revisions: [
      {
        id: revisionId,
        review_id: reviewId,
        sequence: 1,
        base_run_id: null,
        head_run_id: runId,
        head_commit_sha: sha.slice(0, 40),
        evidence_digest: sha,
        foreign_run: false,
      },
    ],
    audit_events: [
      {
        id: randomUUID(),
        repository_id: repositoryId,
        release_run_id: runId,
        event_type: "run.completed",
        actor_type: "system",
        subject_type: "run",
        foreign_review_subject: false,
      },
    ],
    installation_audit_events: [
      { id: randomUUID(), event_type: "app.uninstalled", actor_type: "system", subject_type: "installation" },
    ],
    comments: [
      {
        id: commentId,
        repository_id: repositoryId,
        review_id: reviewId,
        parent_id: null,
        status: "open",
        author_type: "internal",
        content: "private-comment",
        finding_fingerprint: null,
        evidence_anchor: null,
        foreign_repository: false,
        invalid_parent: false,
      },
    ],
    approvals: [
      {
        id: randomUUID(),
        repository_id: repositoryId,
        review_id: reviewId,
        revision_id: revisionId,
        status: "approved",
        evidence_digest: sha,
        reason: "private-reason",
        invalidation_reason: null,
        is_break_glass: false,
        foreign_repository: false,
      },
    ],
    checklist: [
      {
        id: randomUUID(),
        repository_id: repositoryId,
        review_id: reviewId,
        completed: false,
        title: "private-check",
        foreign_repository: false,
      },
    ],
    finding_decisions: [
      {
        id: randomUUID(),
        repository_id: repositoryId,
        review_id: reviewId,
        finding_fingerprint: "fingerprint",
        disposition: "deferred",
        reason: "private-reason",
        evidence_digest: sha,
        expires_at: null,
        foreign_repository: false,
      },
    ],
    finding_assignments: [
      {
        id: randomUUID(),
        repository_id: repositoryId,
        review_id: reviewId,
        finding_fingerprint: "fingerprint",
        foreign_repository: false,
      },
    ],
    excluded_source_class_counts: {
      runSnapshots: 0,
      apiTokens: 0,
      runnerRegistrations: 0,
      installationComponentCredentials: 0,
      installationComponentObservations: 0,
    },
    redacted_audit_field_counts: {
      installationActorIdentities: 0,
      installationSubjectIdentifiers: 0,
      installationRequestIdentifiers: 0,
      installationPrivateMetadata: 0,
      repositoryActorIdentities: 0,
      repositorySubjectIdentifiers: 0,
      repositoryRequestIdentifiers: 0,
      repositoryPrivateMetadata: 0,
    },
  };
}

function readScopedRecord(record: Record<string, unknown>) {
  const query = vi.fn(async () => ({ rows: [record] }));
  const withTransaction = vi.fn(async (read: (tx: { query: typeof query }) => Promise<unknown>) => read({ query }));
  return { query, withTransaction, db: { withTransaction } as never };
}

const read = (record: Record<string, unknown>) =>
  prepareVerifiedHistoricalUserConsistentCorePreflight(readScopedRecord(record).db, {
    exportId,
    verifiedGitHubUserId: 42,
  });

describe("historical original-user bounded core validation", () => {
  it("accepts a complete scoped snapshot while redacting unrelated free text and identifiers", async () => {
    const fixture = readScopedRecord(retainedOriginalUserFixture());
    const snapshot = await prepareVerifiedHistoricalUserConsistentCorePreflight(fixture.db, {
      exportId,
      verifiedGitHubUserId: 42,
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.reviewCount).toBe(1);
    const body = snapshot?.bytes.toString("utf8") ?? "";
    for (const privateValue of [
      "private-owner",
      "private-name",
      "private-branch",
      "private-message",
      "private-path",
      "private-file",
      "private-review",
      "private-comment",
      "private-reason",
      "private-check",
    ])
      expect(body).not.toContain(privateValue);
    expect(body).toContain('"completeCustomerExport":false');
    expect(fixture.withTransaction).toHaveBeenCalledOnce();
    expect(fixture.query).toHaveBeenCalledOnce();
  });

  it("denies missing, non-array and oversized source classes without truncating output", async () => {
    const classes = [
      "repositories",
      "runs",
      "findings",
      "artifacts",
      "reviews",
      "revisions",
      "audit_events",
      "installation_audit_events",
      "comments",
      "approvals",
      "checklist",
      "finding_decisions",
      "finding_assignments",
    ];
    for (const key of classes) {
      for (const invalid of [undefined, null, {}, "rows", Array.from({ length: 101 }, () => null)]) {
        const record = retainedOriginalUserFixture();
        record[key] = invalid;
        await expect(read(record)).rejects.toThrow(HistoricalUserInventoryUnavailableError);
      }
    }
  });

  it("denies malformed retained class records even with a structurally complete scoped envelope", async () => {
    const changes: Array<[string, string, unknown]> = [
      ["comments", "content", "x".repeat(8193)],
      ["comments", "invalid_parent", true],
      ["approvals", "foreign_repository", true],
      ["approvals", "evidence_digest", "invalid"],
      ["checklist", "foreign_repository", true],
      ["reviews", "foreign_head_run", true],
      ["revisions", "foreign_run", true],
      ["artifacts", "sha256", "invalid"],
      ["runs", "repository_id", randomUUID()],
      ["findings", "run_id", randomUUID()],
      ["audit_events", "foreign_review_subject", true],
      ["finding_decisions", "foreign_repository", true],
      ["finding_assignments", "foreign_repository", true],
    ];
    for (const [section, key, value] of changes) {
      const record = retainedOriginalUserFixture();
      const row = (record[section] as Record<string, unknown>[])[0];
      if (!row) throw new Error("Fixture row unavailable");
      row[key] = value;
      await expect(read(record)).rejects.toThrow(HistoricalUserInventoryUnavailableError);
    }
  });

  it("denies a cyclic parent-comment relationship even with individually valid rows", async () => {
    const record = retainedOriginalUserFixture();
    const comments = record.comments as Record<string, unknown>[];
    const first = comments[0];
    if (!first) throw new Error("Fixture comment unavailable");
    const second = { ...first, id: randomUUID(), parent_id: first.id };
    first.parent_id = second.id;
    comments.push(second);
    await expect(read(record)).rejects.toThrow(HistoricalUserInventoryUnavailableError);
  });
});
