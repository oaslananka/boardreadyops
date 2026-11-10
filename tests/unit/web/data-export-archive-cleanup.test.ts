import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredPrivateLocalExportArchive } from "../../../apps/web/lib/data-export-archive-cleanup.js";
import { DataExportArchiveCommitmentStore } from "../../../packages/db/src/data-export-archive-commitment-store.js";

const roots: string[] = [];
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "bro-44-cleanup-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}
const exportId = "3df63e1f-adf1-43d3-b252-63f483e76fe4";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bounded private ZIP physical cleanup admission", () => {
  it("refuses invalid IDs, arbitrary paths and missing directories without querying the DB", async () => {
    const withTransaction = vi.fn();
    const db = { withTransaction } as never;
    const root = await folder();
    const input = {
      db,
      exportId,
      tenantId: "tenant-a",
      installationId: "install-a",
      archiveRoot: path.join(root, ".private-export-archives"),
    };
    await expect(cleanupExpiredPrivateLocalExportArchive(input)).resolves.toBe("quarantined");
    await expect(
      cleanupExpiredPrivateLocalExportArchive({
        ...input,
        exportId: "../escape",
      }),
    ).resolves.toBe("quarantined");
    await expect(
      cleanupExpiredPrivateLocalExportArchive({
        ...input,
        archiveRoot: root,
      }),
    ).resolves.toBe("quarantined");
    await expect(
      cleanupExpiredPrivateLocalExportArchive({
        ...input,
        archiveRoot: ".private-export-archives",
      }),
    ).resolves.toBe("quarantined");
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("marks a genuinely absent private archive missing only inside the owned transaction", async () => {
    const parent = await folder();
    const archiveRoot = path.join(parent, ".private-export-archives");
    await mkdir(archiveRoot, { mode: 0o700 });
    const lockCandidate = vi
      .spyOn(DataExportArchiveCommitmentStore.prototype, "lockCleanupCandidate")
      .mockResolvedValue({
        sha256: "a".repeat(64),
        byteLength: 9,
        disposition: "eligible",
      });
    const markCleaned = vi
      .spyOn(DataExportArchiveCommitmentStore.prototype, "markPhysicallyCleaned")
      .mockResolvedValue();
    const query = vi.fn();
    const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
    const request = {
      db: { withTransaction } as never,
      exportId,
      tenantId: "tenant-a",
      installationId: "install-a",
      archiveRoot,
    };
    expect(await cleanupExpiredPrivateLocalExportArchive(request)).toBe("missing");
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(lockCandidate).toHaveBeenCalledWith({
      exportId,
      tenantId: "tenant-a",
      installationId: "install-a",
    });
    expect(markCleaned).toHaveBeenCalledWith(
      { exportId, tenantId: "tenant-a", installationId: "install-a" },
      "missing",
    );
  });

  it("quarantines an unsafe existing archive without unlinking or committing cleanup", async () => {
    const parent = await folder();
    const archiveRoot = path.join(parent, ".private-export-archives");
    await mkdir(archiveRoot, { mode: 0o700 });
    const stored = path.join(archiveRoot, `${exportId}.zip`);
    const contents = "unsafe-archive";
    await writeFile(stored, contents, { mode: 0o644 });
    vi.spyOn(DataExportArchiveCommitmentStore.prototype, "lockCleanupCandidate").mockResolvedValue({
      sha256: "a".repeat(64),
      byteLength: Buffer.byteLength(contents),
      disposition: "eligible",
    });
    const markCleaned = vi.spyOn(DataExportArchiveCommitmentStore.prototype, "markPhysicallyCleaned");
    const withTransaction = vi.fn(async (work: (tx: { query: typeof vi.fn }) => Promise<unknown>) =>
      work({ query: vi.fn() }),
    );
    expect(
      await cleanupExpiredPrivateLocalExportArchive({
        db: { withTransaction } as never,
        exportId,
        tenantId: "tenant-a",
        installationId: "install-a",
        archiveRoot,
      }),
    ).toBe("quarantined");
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(markCleaned).not.toHaveBeenCalled();
    expect(await readFile(stored, "utf8")).toBe(contents);
  });

  it("rejects symlinked and group-readable roots before acquiring cleanup locks", async () => {
    const parent = await folder();
    const privateRoot = await folder();
    const withTransaction = vi.fn();
    const input = {
      db: { withTransaction } as never,
      exportId,
      tenantId: "tenant-a",
      installationId: "install-a",
      archiveRoot: path.join(parent, ".private-export-archives"),
    };
    await symlink(privateRoot, input.archiveRoot);
    expect(await cleanupExpiredPrivateLocalExportArchive(input)).toBe("quarantined");
    await rm(input.archiveRoot);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(input.archiveRoot, { mode: 0o750 });
    expect(await cleanupExpiredPrivateLocalExportArchive(input)).toBe("quarantined");
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
