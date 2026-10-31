import { describe, expect, it, vi } from "vitest";
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

function fixture(replies: readonly unknown[] = [{ rows: [inventory] }, { rows: [records] }]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => replies[query.mock.calls.length - 1]);
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ consistentRead: true, statementTimeoutMs: 5000 });
    return await work({ query });
  });
  return { db: { withTransaction } as unknown as Pick<PgQueryExecutor, "withTransaction">, query, withTransaction };
}

describe("claimed consistent repository and record preparation", () => {
  it("queries both scoped slices in the same readonly transaction without completing an export", async () => {
    const { db, query, withTransaction } = fixture();
    const result = await prepareClaimedConsistentMetadataSlices(db, claim);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [, params] of query.mock.calls) expect(params).toEqual(Object.values(claim));
    const repositories = JSON.parse(result?.repositories.bytes.toString("utf8") ?? "{}");
    const records = JSON.parse(result?.records.bytes.toString("utf8") ?? "{}");
    expect(repositories.repositories).toEqual([expect.objectContaining({ repositoryId: "repo-1" })]);
    expect(records.runs).toEqual([expect.objectContaining({ id: "run-1", repositoryId: "repo-1" })]);
    expect(records.findings).toEqual([expect.objectContaining({ id: "finding-1", runId: "run-1" })]);
    expect(JSON.stringify(result)).not.toContain("storage_path");
  });

  it("fails closed when either slice is no longer authorized", async () => {
    const inventoryMissing = fixture([{ rows: [] }]);
    await expect(prepareClaimedConsistentMetadataSlices(inventoryMissing.db, claim)).resolves.toBeNull();
    expect(inventoryMissing.query).toHaveBeenCalledTimes(1);
    const recordsMissing = fixture([{ rows: [inventory] }, { rows: [] }]);
    await expect(prepareClaimedConsistentMetadataSlices(recordsMissing.db, claim)).resolves.toBeNull();
    expect(recordsMissing.query).toHaveBeenCalledTimes(2);
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
