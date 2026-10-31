import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ExportArtifactSnapshotUnavailableError,
  prepareClaimedArtifactMetadataSnapshot,
} from "../../../packages/db/src/data-export-artifact-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const claim = {
  exportId: "export-1",
  tenantId: "owner-1",
  installationId: "installation-1",
  workerId: "worker-1",
  token: "original-lease",
};

const artifact = {
  id: "artifact-1",
  run_id: "run-1",
  kind: "manufacturing",
  name: "board.zip",
  role: "manufacturing",
  sha256: "a".repeat(64),
  bytes: 1234,
  content_type: "application/zip",
  storage_path: "/private/customer-artifacts/unavailable",
};

function withArtifacts(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _params?: readonly unknown[]) => ({ rows }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}

describe("claimed artifact metadata is not a deliverable export", () => {
  it("prepares deterministic allowlisted metadata under the original worker claim", async () => {
    const { db, query } = withArtifacts([{ artifacts: [artifact] }]);
    const output = await prepareClaimedArtifactMetadataSnapshot(db, claim);
    expect(output?.contentType).toBe("application/json");
    expect(output?.byteLength).toBe(output?.bytes.length);
    expect(output?.sha256).toBe(
      createHash("sha256")
        .update(output?.bytes ?? Buffer.alloc(0))
        .digest("hex"),
    );
    const parsed = JSON.parse(output?.bytes.toString("utf8") ?? "{}");
    expect(parsed).toMatchObject({
      kind: "boardreadyops.claimed-artifact-metadata-snapshot",
      exportId: claim.exportId,
      artifacts: [{ id: artifact.id, runId: artifact.run_id, sha256: artifact.sha256, byteLength: 1234 }],
    });
    expect(parsed.exclusions).toContain("artifact-contents");
    expect(output?.bytes.toString("utf8")).not.toContain(artifact.storage_path);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(Object.values(claim));
    const sql = query.mock.calls[0]?.[0] as string;
    for (const required of [
      "exports.preparation_worker=$4",
      "exports.preparation_token=$5",
      "exports.preparation_lease_until>NOW()",
      "installations.suspended_at IS NULL",
      "repositories.disabled_at IS NULL",
      "permitted_repositories.id=release_runs.repository_id",
      "LIMIT 101",
    ])
      expect(sql).toContain(required);
    expect(sql).not.toContain("storage_path");
    expect(sql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/iu);
  });

  it("returns null when the scoped lease is missing and preserves a valid empty inventory", async () => {
    expect(await prepareClaimedArtifactMetadataSnapshot(withArtifacts([]).db, claim)).toBeNull();
    const empty = await prepareClaimedArtifactMetadataSnapshot(withArtifacts([{ artifacts: [] }]).db, claim);
    expect(JSON.parse(empty?.bytes.toString("utf8") ?? "{}").artifacts).toEqual([]);
  });

  it("rejects invalid claimed identity without querying customer records", async () => {
    const { db, query } = withArtifacts([{ artifacts: [artifact] }]);
    await expect(prepareClaimedArtifactMetadataSnapshot(db, { ...claim, token: " " })).rejects.toThrow(
      ExportArtifactSnapshotUnavailableError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed, unbounded or duplicate artifact metadata without truncating", async () => {
    const invalidRows = [
      [{ ...artifact, sha256: "not-a-digest" }],
      [{ ...artifact, sha256: "A".repeat(64) }],
      [{ ...artifact, sha256: "g".repeat(64) }],
      [{ ...artifact, sha256: "a".repeat(63) }],
      [{ ...artifact, sha256: "a".repeat(65) }],
      [{ ...artifact, sha256: "a".repeat(100_000) }],
      [{ ...artifact, bytes: -1 }],
      [{ ...artifact, bytes: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...artifact, name: "" }],
      [{ ...artifact, content_type: null }],
      [artifact, { ...artifact, storage_path: "/another/path" }],
      Array.from({ length: 101 }, (_, index) => ({ ...artifact, id: `artifact-${index}` })),
      [{ ...artifact, name: "x".repeat(270_000) }],
      [{ ...artifact, name: "é".repeat(600) }],
      [{ ...artifact, content_type: "é".repeat(150) }],
    ];
    for (const rows of invalidRows) {
      await expect(
        prepareClaimedArtifactMetadataSnapshot(withArtifacts([{ artifacts: rows }]).db, claim),
      ).rejects.toThrow(ExportArtifactSnapshotUnavailableError);
    }
    await expect(
      prepareClaimedArtifactMetadataSnapshot(withArtifacts([{ artifacts: null }]).db, claim),
    ).rejects.toThrow(ExportArtifactSnapshotUnavailableError);
  });
});
