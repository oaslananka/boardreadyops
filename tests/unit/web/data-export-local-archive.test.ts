import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareClaimedLocalArchiveZip } from "../../../apps/web/lib/data-export-local-archive.js";
import { sanitizeAndExtractArchive } from "../../../packages/cloud-core/src/archive-sanitizer.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";

const folders: string[] = [];
const claim = {
  exportId: "export-1",
  tenantId: "tenant-1",
  installationId: "install-1",
  workerId: "worker-1",
  token: "secret-claim",
};
const sha = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

async function fixture(options: { artifacts?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "bro-archive-claim-"));
  folders.push(root);
  await mkdir(path.join(root, "objects"));
  const bytes = Buffer.from("private, entirely synthetic artifact bytes");
  await writeFile(path.join(root, "objects", "artifact.bin"), bytes);
  const row = {
    id: "artifact-1",
    run_id: "run-1",
    repository_id: "repo-1",
    storage_path: "objects/artifact.bin",
    sha256: sha(bytes),
    bytes: bytes.length,
  };
  const inventory = {
    id: claim.exportId,
    tenant_id: claim.tenantId,
    scope: "repository",
    scope_id: "repo-1",
    repositories: [
      {
        id: "repo-1",
        github_repo_id: "123",
        owner: "tenant-1",
        name: "board",
        private: true,
        disabled: false,
      },
    ],
  };
  const artifactRows =
    options.artifacts === false
      ? []
      : [
          {
            id: row.id,
            run_id: row.run_id,
            kind: "manufacturing",
            name: "board.zip",
            role: "package",
            sha256: row.sha256,
            bytes: row.bytes,
            content_type: "application/zip",
          },
        ];
  const txReplies = [
    { rows: [inventory] },
    {
      rows: [
        {
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
          findings: [],
        },
      ],
    },
    { rows: [{ revisions: [], reviews: [], audit_events: [] }] },
    { rows: [{ comments: [] }] },
    { rows: [{ approvals: [], checklist: [] }] },
    { rows: [{ decisions: [], assignments: [] }] },
    { rows: [{ artifacts: artifactRows }] },
  ];
  const queryInside = vi.fn(async () => txReplies[queryInside.mock.calls.length - 1]);
  const withTransaction = vi.fn(
    async (work: (tx: { query: typeof queryInside }) => Promise<unknown>) => await work({ query: queryInside }),
  );
  const liveReplies: Array<{ rows: Record<string, unknown>[] }> =
    options.artifacts === false
      ? [{ rows: [inventory] }]
      : [{ rows: [row] }, { rows: [row] }, { rows: [row] }, { rows: [row] }, { rows: [inventory] }];
  let liveIndex = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("boardreadyops_begin_export_object_copy")) return { rows: [{ outcome: "reserved" }] };
    if (sql.includes("boardreadyops_finish_export_object_copy")) return { rows: [{ outcome: "released" }] };
    return liveReplies[liveIndex++];
  });
  const db = { withTransaction, query } as unknown as Pick<PgQueryExecutor, "withTransaction" | "query">;
  const input = { db, claim, storageDriver: "local", storageRoot: root };
  return { input, root, bytes, row, inventory, txReplies, liveReplies, withTransaction, query, queryInside };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("internal claim-bound local archive assembly", () => {
  it("builds an independently verifiable ZIP only after snapshot and repeated live claim checks", async () => {
    const f = await fixture();
    const result = await prepareClaimedLocalArchiveZip(f.input);
    expect(result?.files).toBe(8);
    expect(result?.sha256).toBe(sha(result?.bytes ?? Buffer.alloc(0)));
    const extracted = sanitizeAndExtractArchive(result?.bytes ?? Buffer.alloc(0));
    expect(extracted.fileCount).toBe(8);
    expect(extracted.files.find(({ path: name }) => name === "objects/artifact-1.bin")?.data).toEqual(f.bytes);
    expect(JSON.stringify(extracted.files.map(({ path: name }) => name))).not.toContain(f.row.storage_path);
    expect(f.withTransaction).toHaveBeenCalledTimes(1);
    expect(f.queryInside).toHaveBeenCalledTimes(7);
    expect(f.query).toHaveBeenCalledTimes(7);
    for (const [sql, params] of f.query.mock.calls) {
      if (sql.includes("FROM data_exports AS exports")) {
        expect(sql).toContain("artifact_deletion_jobs");
        expect(sql).toContain("retention_until > NOW()");
        expect(params).toEqual([...Object.values(claim), "artifact-1"]);
      } else if (sql.includes("boardreadyops_begin_export_object_copy")) {
        expect(params).toEqual([...Object.values(claim), "artifact-1", f.row.storage_path, expect.any(String)]);
      } else if (sql.includes("boardreadyops_finish_export_object_copy")) {
        expect(params).toEqual([claim.exportId, claim.workerId, expect.any(String)]);
      } else {
        expect(sql).toContain("preparation_lease_until > NOW()");
      }
    }
  });

  it("works for metadata-only snapshots while revalidating the empty export's claim", async () => {
    const f = await fixture({ artifacts: false });
    const result = await prepareClaimedLocalArchiveZip(f.input);
    expect(result?.files).toBe(7);
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a revoked claim before reading or after filesystem IO", async () => {
    const f = await fixture();
    f.liveReplies[0] = { rows: [] };
    await expect(prepareClaimedLocalArchiveZip(f.input)).resolves.toBeNull();
    expect(f.query).toHaveBeenCalledTimes(1);
    const next = await fixture();
    next.liveReplies[2] = { rows: [] };
    await expect(prepareClaimedLocalArchiveZip(next.input)).resolves.toBeNull();
    expect(next.query).toHaveBeenCalledTimes(5);
  });

  it("rejects revocation after an object was verified but before final ZIP assembly", async () => {
    const f = await fixture();
    f.liveReplies[3] = { rows: [] };
    await expect(prepareClaimedLocalArchiveZip(f.input)).resolves.toBeNull();
    expect(f.query).toHaveBeenCalledTimes(6);
    const later = await fixture();
    later.liveReplies[4] = { rows: [] };
    await expect(prepareClaimedLocalArchiveZip(later.input)).resolves.toBeNull();
    expect(later.query).toHaveBeenCalledTimes(7);
  });

  it("rejects changed repository or storage path on the final object recheck", async () => {
    const f = await fixture();
    f.liveReplies[3] = { rows: [{ ...f.row, repository_id: "foreign-repo" }] };
    await expect(prepareClaimedLocalArchiveZip(f.input)).resolves.toBeNull();
    const next = await fixture();
    next.liveReplies[3] = { rows: [{ ...next.row, storage_path: "other/file" }] };
    await expect(prepareClaimedLocalArchiveZip(next.input)).resolves.toBeNull();
  });

  it("rejects tampered on-disk bytes and disabled storage drivers", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, f.row.storage_path), Buffer.alloc(f.bytes.length, 0));
    await expect(prepareClaimedLocalArchiveZip(f.input)).resolves.toBeNull();
    const next = await fixture();
    await expect(prepareClaimedLocalArchiveZip({ ...next.input, storageDriver: "cloud" })).resolves.toBeNull();
    expect(next.withTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when the first object is revoked while a second object is read", async () => {
    const f = await fixture();
    const extra = Buffer.from("another wholly synthetic payload");
    await writeFile(path.join(f.root, "objects", "another.bin"), extra);
    const otherRow = {
      ...f.row,
      id: "artifact-2",
      storage_path: "objects/another.bin",
      sha256: sha(extra),
      bytes: extra.length,
    };
    const existing = f.txReplies[6].rows[0].artifacts[0];
    f.txReplies[6] = {
      rows: [
        { artifacts: [existing, { ...existing, id: otherRow.id, sha256: otherRow.sha256, bytes: otherRow.bytes }] },
      ],
    };
    f.liveReplies.splice(3, 0, { rows: [otherRow] }, { rows: [otherRow] }, { rows: [otherRow] });
    f.liveReplies.splice(7, 0, { rows: [otherRow] });
    // Both objects were independently checked after their own IO, but the
    // first is now revoked before the final all-object authorization fence.
    f.liveReplies[6] = { rows: [] };
    await expect(prepareClaimedLocalArchiveZip(f.input)).resolves.toBeNull();
    expect(f.query).toHaveBeenCalledTimes(11);
  });

  it("rejects over-budget object metadata before any physical IO", async () => {
    const f = await fixture();
    const existing = f.txReplies[6].rows[0].artifacts[0];
    f.txReplies[6] = { rows: [{ artifacts: [{ ...existing, bytes: 64 * 1024 * 1024 }] }] };
    await expect(prepareClaimedLocalArchiveZip(f.input)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });

  it("rejects a changed repository inventory on the final lease recheck", async () => {
    const f = await fixture();
    f.liveReplies[4] = {
      rows: [
        {
          ...f.inventory,
          repositories: [{ ...f.inventory.repositories[0], name: "a-renamed-repository" }],
        },
      ],
    };
    await expect(prepareClaimedLocalArchiveZip(f.input)).resolves.toBeNull();
    expect(f.query).toHaveBeenCalledTimes(7);
  });

  it("rejects snapshot-integrity mismatches before any physical object lookup", async () => {
    const f = await fixture();
    f.txReplies[6] = { rows: [{ artifacts: [{ ...f.txReplies[6].rows[0].artifacts[0], run_id: "other-run" }] }] };
    await expect(prepareClaimedLocalArchiveZip(f.input)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
});
