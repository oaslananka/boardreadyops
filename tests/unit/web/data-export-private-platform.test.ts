import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredPrivateLocalExportArchive } from "../../../apps/web/lib/data-export-archive-cleanup.js";
import { cleanupHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-cleanup.js";
import { readSealedHistoricalUserPartial } from "../../../apps/web/lib/data-export-historical-partial-storage.js";
import {
  ensurePrivateLocalExportArchiveDirectory,
  readSealedLocalExportArchive,
} from "../../../apps/web/lib/data-export-local-archive-storage.js";

/**
 * The private local ZIP store requires a Linux container filesystem:
 * 0700/0600 owner/UID permissions, no-follow opens, hard-link no-clobber,
 * and durable directory fsync. Windows ACLs or macOS directory sync do not
 * provide the same tested promise. Deny access, even with valid inputs.
 */
describe("private ZIP storage platform contract", () => {
  it.skipIf(process.platform === "linux")(
    "fails closed without provisioning or any DB cleanup side effect",
    async () => {
      const storageRoot = await mkdtemp(path.join(tmpdir(), "boardreadyops-unsupported-private-"));
      const archiveRoot = path.join(storageRoot, ".private-export-archives");
      const exportId = randomUUID();
      const sha256 = "a".repeat(64);
      const withTransaction = vi.fn();
      try {
        expect(await ensurePrivateLocalExportArchiveDirectory({ storageRoot, privateArchiveRoot: archiveRoot })).toBe(
          false,
        );
        await expect(lstat(archiveRoot)).rejects.toMatchObject({ code: "ENOENT" });
        await mkdir(archiveRoot);
        expect(await readSealedLocalExportArchive({ archiveRoot, exportId, sha256, byteLength: 16 })).toBeNull();
        expect(await readSealedHistoricalUserPartial({ archiveRoot, exportId, sha256, byteLength: 16 })).toBeNull();
        expect(
          await cleanupExpiredPrivateLocalExportArchive({
            archiveRoot,
            exportId,
            db: { withTransaction } as never,
            tenantId: "tenant-a",
            installationId: "install-a",
          }),
        ).toBe("quarantined");
        expect(
          await cleanupHistoricalUserPrivatePartial({
            archiveRoot,
            db: { withTransaction } as never,
            authority: { exportId, verifiedGitHubUserId: 101 },
          }),
        ).toBe("quarantined");
        expect(withTransaction).not.toHaveBeenCalled();
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    },
  );
});
