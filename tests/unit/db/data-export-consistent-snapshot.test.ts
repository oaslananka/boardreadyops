import { describe, expect, it, vi } from "vitest";
import { ExportArtifactSnapshotUnavailableError } from "../../../packages/db/src/data-export-artifact-snapshot.js";
import { prepareClaimedConsistentMetadataSlices } from "../../../packages/db/src/data-export-consistent-snapshot.js";
import { ExportRecordSnapshotUnavailableError } from "../../../packages/db/src/data-export-record-snapshot.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";

const claim = {
  exportId: "export-1",
  tenantId: "tenant-1",
  installationId: "installation-1",
  workerId: "worker-1",
  token: "token-1",
};
const inventory = {
  id: claim.exportId,
  tenant_id: claim.tenantId,
  scope: "repository",
  scope_id: "repo-1",
  repositories: [
    { id: "repo-1", github_repo_id: "123", owner: "tenant-1", name: "board", private: true, disabled: false },
  ],
};
const records = {
  runs: [
    {
      id: "run-1",
      repository_id: "repo-1",
      commit_sha: "a".repeat(40),
      ref: "refs/heads/main",
      status: "completed",
      decision: null,
    },
  ],
  findings: [
    {
      id: "finding-1",
      run_id: "run-1",
      rule_id: "erc",
      severity: "warning",
      message: "review",
      path: null,
      kind: null,
    },
  ],
};

const artifacts = { artifacts: [] };

const reviewAudit = {
  revisions: [
    {
      id: "revision-1",
      review_id: "review-1",
      sequence: 1,
      base_run_id: null,
      head_run_id: "run-1",
      base_commit_sha: null,
      head_commit_sha: "a".repeat(40),
      evidence_digest: "b".repeat(64),
    },
  ],
  reviews: [
    {
      id: "review-1",
      repository_id: "repo-1",
      head_run_id: "run-1",
      title: "Review",
      status: "completed",
      decision: "approved",
    },
  ],
  audit_events: [
    {
      id: "audit-1",
      repository_id: "repo-1",
      release_run_id: "run-1",
      event_type: "review.approved",
      actor_type: "system",
      subject_type: "review",
      subject_id: "review-1",
    },
  ],
};

function fixture(
  replies: readonly unknown[] = [
    { rows: [inventory] },
    { rows: [records] },
    { rows: [reviewAudit] },
    { rows: [artifacts] },
  ],
) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => replies[query.mock.calls.length - 1]);
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ consistentRead: true, statementTimeoutMs: 5000 });
    return await work({ query });
  });
  return { db: { withTransaction } as unknown as Pick<PgQueryExecutor, "withTransaction">, query, withTransaction };
}

describe("claimed consistent repository, record, review and artifact metadata preparation", () => {
  it("queries four scoped slices in the same readonly transaction without completing an export", async () => {
    const { db, query, withTransaction } = fixture();
    const result = await prepareClaimedConsistentMetadataSlices(db, claim);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(4);
    for (const [, params] of query.mock.calls) expect(params).toEqual(Object.values(claim));
    const repositories = JSON.parse(result?.repositories.bytes.toString("utf8") ?? "{}");
    const records = JSON.parse(result?.records.bytes.toString("utf8") ?? "{}");
    expect(repositories.repositories).toEqual([expect.objectContaining({ repositoryId: "repo-1" })]);
    expect(records.runs).toEqual([expect.objectContaining({ id: "run-1", repositoryId: "repo-1" })]);
    expect(records.findings).toEqual([expect.objectContaining({ id: "finding-1", runId: "run-1" })]);
    const reviewData = JSON.parse(result?.reviewAudit.bytes.toString("utf8") ?? "{}");
    expect(reviewData.reviews).toEqual([expect.objectContaining({ id: "review-1", repositoryId: "repo-1" })]);
    expect(reviewData.revisions).toEqual([expect.objectContaining({ id: "revision-1", reviewId: "review-1" })]);
    expect(reviewData.auditEvents).toEqual([expect.objectContaining({ id: "audit-1", repositoryId: "repo-1" })]);
    const artifactData = JSON.parse(result?.artifactMetadata.bytes.toString("utf8") ?? "{}");
    expect(artifactData.artifacts).toEqual([]);
    expect(artifactData.exclusions).toContain("artifact-contents");
    expect(JSON.stringify(result)).not.toContain("storage_path");
  });

  it("fails closed when either slice is no longer authorized", async () => {
    const inventoryMissing = fixture([{ rows: [] }]);
    await expect(prepareClaimedConsistentMetadataSlices(inventoryMissing.db, claim)).resolves.toBeNull();
    expect(inventoryMissing.query).toHaveBeenCalledTimes(1);
    const recordsMissing = fixture([{ rows: [inventory] }, { rows: [] }]);
    await expect(prepareClaimedConsistentMetadataSlices(recordsMissing.db, claim)).resolves.toBeNull();
    expect(recordsMissing.query).toHaveBeenCalledTimes(2);
    const auditMissing = fixture([{ rows: [inventory] }, { rows: [records] }, { rows: [] }]);
    await expect(prepareClaimedConsistentMetadataSlices(auditMissing.db, claim)).resolves.toBeNull();
    expect(auditMissing.query).toHaveBeenCalledTimes(3);
    const artifactMissing = fixture([
      { rows: [inventory] },
      { rows: [records] },
      { rows: [reviewAudit] },
      { rows: [] },
    ]);
    await expect(prepareClaimedConsistentMetadataSlices(artifactMissing.db, claim)).resolves.toBeNull();
    expect(artifactMissing.query).toHaveBeenCalledTimes(4);
  });

  it("keeps artifact metadata only when its run is part of the exact same record snapshot", async () => {
    const artifact = {
      id: "artifact-1",
      run_id: "run-1",
      kind: "manufacturing",
      name: "board.zip",
      role: "package",
      sha256: "c".repeat(64),
      bytes: 512,
      content_type: "application/zip",
    };
    const allowed = fixture([
      { rows: [inventory] },
      { rows: [records] },
      { rows: [reviewAudit] },
      { rows: [{ artifacts: [artifact] }] },
    ]);
    const prepared = await prepareClaimedConsistentMetadataSlices(allowed.db, claim);
    expect(JSON.parse(prepared?.artifactMetadata.bytes.toString("utf8") ?? "{}").artifacts).toEqual([
      expect.objectContaining({ id: artifact.id, runId: "run-1" }),
    ]);

    const orphaned = fixture([
      { rows: [inventory] },
      { rows: [records] },
      { rows: [reviewAudit] },
      { rows: [{ artifacts: [{ ...artifact, run_id: "foreign-run" }] }] },
    ]);
    await expect(prepareClaimedConsistentMetadataSlices(orphaned.db, claim)).rejects.toThrow(
      ExportArtifactSnapshotUnavailableError,
    );
    expect(orphaned.withTransaction).toHaveBeenCalledTimes(1);
    expect(orphaned.query).toHaveBeenCalledTimes(4);
  });

  it("rejects excessive artifacts instead of returning a truncated shared snapshot", async () => {
    const overflow = fixture([
      { rows: [inventory] },
      { rows: [records] },
      { rows: [reviewAudit] },
      { rows: [{ artifacts: Array.from({ length: 101 }, (_, index) => ({ id: `artifact-${index}` })) }] },
    ]);
    await expect(prepareClaimedConsistentMetadataSlices(overflow.db, claim)).rejects.toThrow(
      ExportArtifactSnapshotUnavailableError,
    );
    expect(overflow.query).toHaveBeenCalledTimes(4);
  });

  it("rejects overflow rather than returning an incomplete record package", async () => {
    const exceeded = fixture([
      { rows: [inventory] },
      { rows: [{ runs: Array.from({ length: 101 }, () => records.runs[0]), findings: [] }] },
    ]);
    await expect(prepareClaimedConsistentMetadataSlices(exceeded.db, claim)).rejects.toThrow(
      ExportRecordSnapshotUnavailableError,
    );
    expect(exceeded.withTransaction).toHaveBeenCalledTimes(1);
  });
});
