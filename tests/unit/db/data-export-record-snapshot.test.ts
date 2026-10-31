import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ExportRecordSnapshotUnavailableError,
  prepareClaimedRunFindingSnapshot,
} from "../../../packages/db/src/data-export-record-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const claim = {
  exportId: "export-123",
  tenantId: "acme",
  installationId: "inst-123",
  workerId: "worker-123",
  token: "original-lease",
};
const run = {
  id: "run-1",
  repository_id: "repo-1",
  commit_sha: "a".repeat(40),
  ref: "refs/heads/main",
  status: "completed",
  decision: null,
};
const finding = {
  id: "finding-1",
  run_id: run.id,
  rule_id: "rule-123",
  severity: "warning",
  message: "customer report",
  path: "Board.kicad_pcb",
  kind: "erc",
};

function withRows(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}

describe("claimed control-plane record snapshot is read-only and non-deliverable", () => {
  it("uses one lease-bound SQL statement and allowlisted deterministic bytes", async () => {
    const { db, query } = withRows([{ runs: [run], findings: [finding] }]);
    const result = await prepareClaimedRunFindingSnapshot(db, claim);
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("application/json");
    expect(result?.sha256).toBe(
      createHash("sha256")
        .update(result?.bytes ?? Buffer.alloc(0))
        .digest("hex"),
    );
    const decoded = JSON.parse(result?.bytes.toString("utf8") ?? "{}");
    expect(decoded).toMatchObject({
      kind: "boardreadyops.claimed-run-finding-snapshot",
      coverage: "active-installation-release-runs-and-findings-only",
      exportId: claim.exportId,
      runs: [{ id: "run-1", repositoryId: "repo-1" }],
      findings: [{ id: "finding-1", runId: "run-1", message: "customer report" }],
    });
    expect(decoded.exclusions).toContain("artifacts");
    expect(result?.bytes.toString("utf8")).not.toContain("storage_path");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(Object.values(claim));
    const sql = query.mock.calls[0]?.[0] as string;
    for (const fragment of [
      "exports.preparation_worker=$4",
      "exports.preparation_token=$5",
      "exports.preparation_lease_until>NOW()",
      "installations.suspended_at IS NULL",
      "repositories.disabled_at IS NULL",
      "permitted_repositories.id=release_runs.repository_id",
      "LIMIT 101",
    ])
      expect(sql).toContain(fragment);
    expect(sql).not.toContain("storage_path");
    expect(sql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/iu);
  });

  it("fails closed without claim scope or with malformed or foreign run references", async () => {
    const missing = withRows([]);
    expect(await prepareClaimedRunFindingSnapshot(missing.db, claim)).toBeNull();
    const invalid = withRows([]);
    await expect(prepareClaimedRunFindingSnapshot(invalid.db, { ...claim, token: " " })).rejects.toThrow(
      ExportRecordSnapshotUnavailableError,
    );
    expect(invalid.query).not.toHaveBeenCalled();
    await expect(
      prepareClaimedRunFindingSnapshot(withRows([{ runs: [{ ...run, commit_sha: null }], findings: [] }]).db, claim),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
    await expect(
      prepareClaimedRunFindingSnapshot(
        withRows([{ runs: [run], findings: [{ ...finding, run_id: "other-run" }] }]).db,
        claim,
      ),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
    await expect(
      prepareClaimedRunFindingSnapshot(
        withRows([{ runs: [run], findings: [{ ...finding, message: null }] }]).db,
        claim,
      ),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
  });

  it("rejects truncation beyond 100 rows, oversize bytes and corrupt arrays", async () => {
    await expect(
      prepareClaimedRunFindingSnapshot(
        withRows([{ runs: Array.from({ length: 101 }, (_, i) => ({ ...run, id: `run-${i}` })), findings: [] }]).db,
        claim,
      ),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
    await expect(
      prepareClaimedRunFindingSnapshot(
        withRows([
          { runs: [run], findings: Array.from({ length: 101 }, (_, i) => ({ ...finding, id: `finding-${i}` })) },
        ]).db,
        claim,
      ),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
    await expect(
      prepareClaimedRunFindingSnapshot(
        withRows([{ runs: [run], findings: [{ ...finding, message: "x".repeat(270_000) }] }]).db,
        claim,
      ),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
    await expect(
      prepareClaimedRunFindingSnapshot(withRows([{ runs: "not-an-array", findings: [] }]).db, claim),
    ).rejects.toThrow(ExportRecordSnapshotUnavailableError);
  });
});
