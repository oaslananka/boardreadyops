import { chmod, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredPrivateLocalExportArchive } from "../../../apps/web/lib/data-export-archive-cleanup.js";

const roots: string[] = [];
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "bro-44-cleanup-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}
const exportId = "3df63e1f-adf1-43d3-b252-63f483e76fe4";

afterEach(async () => {
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
