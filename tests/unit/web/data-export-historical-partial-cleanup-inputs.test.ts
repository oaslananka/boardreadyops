import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanupHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-cleanup.js";

const valid = {
  db: { withTransaction: vi.fn() },
  authority: { exportId: randomUUID(), verifiedGitHubUserId: 9235789401 },
  archiveRoot: "/srv/exports/.private-export-archives",
};

describe("manual historical private cleanup input gate", () => {
  it("rejects malformed identities, missing DB and unsafe roots before any IO", async () => {
    const inputs = [
      null,
      { ...valid, db: null },
      { ...valid, db: {} },
      { ...valid, authority: null },
      { ...valid, authority: { ...valid.authority, exportId: "wrong-id" } },
      { ...valid, authority: { ...valid.authority, verifiedGitHubUserId: -1 } },
      { ...valid, authority: { ...valid.authority, verifiedGitHubUserId: Number.NaN } },
      { ...valid, archiveRoot: "relative/.private-export-archives" },
      { ...valid, archiveRoot: "/srv/exports/../.private-export-archives" },
      { ...valid, archiveRoot: "/srv/exports/.private-export-archives/" },
      { ...valid, archiveRoot: "/srv/exports/other" },
    ];
    for (const input of inputs) {
      expect(await cleanupHistoricalUserPrivatePartial(input as never)).toBe("quarantined");
    }
    expect(valid.db.withTransaction).not.toHaveBeenCalled();
  });

  it("admits only a private, owned canonical root into the DB transaction gate", async () => {
    const base = await mkdtemp(join(tmpdir(), "boardreadyops-cleanup-input-"));
    const archiveRoot = join(base, ".private-export-archives");
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      const withTransaction = vi.fn().mockResolvedValue("quarantined");
      expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: { withTransaction }, archiveRoot })).toBe(
        "quarantined",
      );
      expect(withTransaction).toHaveBeenCalledOnce();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
