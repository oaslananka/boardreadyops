import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readClaimedVerifiedLocalExportObject } from "../../../apps/web/lib/data-export-verified-object.js";
import type { ExportRecordClaim } from "../../../packages/db/src/data-export-record-snapshot.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const roots: string[] = [];
const claim: ExportRecordClaim = {
  exportId: "export-1",
  tenantId: "tenant-1",
  installationId: "install-1",
  workerId: "worker-1",
  token: "secret-claim",
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-claimed-object-"));
  roots.push(root);
  await mkdir(path.join(root, "store"));
  const bytes = Buffer.from("synthetic, not customer data");
  const storagePath = "store/object.bin";
  await writeFile(path.join(root, storagePath), bytes);
  const row = {
    id: "artifact-1",
    run_id: "run-1",
    repository_id: "repo-1",
    storage_path: storagePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
  return { root, bytes, row };
}
function dbWithRows(...rows: Array<Record<string, unknown> | null>) {
  const query = vi.fn(async (_sql: string, _args?: readonly unknown[]) => ({
    rows: [rows[query.mock.calls.length - 1]].filter(Boolean),
  }));
  return { db: { query } as unknown as SqlQueryExecutor, query };
}
function input(root: string, db: SqlQueryExecutor) {
  return { db, claim, artifactId: "artifact-1", storageDriver: "local", storageRoot: root };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("claimed export object post-IO authority recheck", () => {
  it("returns verified bytes only if the original scoped claim survives both DB reads", async () => {
    const f = await fixture();
    const { db, query } = dbWithRows(f.row, f.row);
    const value = await readClaimedVerifiedLocalExportObject(input(f.root, db));
    expect(value?.bytes).toEqual(f.bytes);
    expect(value?.object).toMatchObject({ artifactId: f.row.id, repositoryId: f.row.repository_id });
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, args] of query.mock.calls) {
      expect(sql).toContain("artifact.retention_until > NOW()");
      expect(sql).toContain("artifact_deletion_jobs");
      expect(sql).toContain("exports.preparation_lease_until > NOW()");
      expect(args).toEqual([...Object.values(claim), f.row.id]);
    }
  });

  it("rejects malformed claim identifiers without querying the database", async () => {
    const f = await fixture();
    const { db, query } = dbWithRows(f.row);
    await expect(
      readClaimedVerifiedLocalExportObject({
        ...input(f.root, db),
        claim: { ...claim, token: "" },
      }),
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects missing, revoked or expired claim before reading any object bytes", async () => {
    const f = await fixture();
    const { db, query } = dbWithRows(null);
    await expect(readClaimedVerifiedLocalExportObject(input(f.root, db))).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects a claim revoked during filesystem I/O", async () => {
    const f = await fixture();
    const { db, query } = dbWithRows(f.row, null);
    await expect(readClaimedVerifiedLocalExportObject(input(f.root, db))).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects changed scope, path, length or digest after IO", async () => {
    const f = await fixture();
    const differences = [
      { repository_id: "other-repo" },
      { storage_path: "different-path" },
      { bytes: f.bytes.length + 1 },
      { sha256: "0".repeat(64) },
    ];
    for (const changes of differences) {
      const { db, query } = dbWithRows(f.row, { ...f.row, ...changes });
      await expect(readClaimedVerifiedLocalExportObject(input(f.root, db))).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects unsupported storage driver and physically modified bytes", async () => {
    const f = await fixture();
    const { db, query } = dbWithRows(f.row, f.row);
    await expect(
      readClaimedVerifiedLocalExportObject({ ...input(f.root, db), storageDriver: "cloud" }),
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    await writeFile(path.join(f.root, f.row.storage_path), Buffer.alloc(f.bytes.length, 23));
    const next = dbWithRows(f.row, f.row);
    await expect(readClaimedVerifiedLocalExportObject(input(f.root, next.db))).resolves.toBeNull();
    expect(next.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed on incorrect, oversized or malformed database metadata", async () => {
    const f = await fixture();
    for (const changes of [
      { id: "another-id" },
      { bytes: 64 * 1024 * 1024 + 1 },
      { sha256: "bad" },
      { bytes: -1 },
      { storage_path: "" },
    ]) {
      const { db, query } = dbWithRows({ ...f.row, ...changes });
      await expect(readClaimedVerifiedLocalExportObject(input(f.root, db))).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
    }
  });
});
