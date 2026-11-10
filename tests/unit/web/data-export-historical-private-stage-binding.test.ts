import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareVerifiedHistoricalUserPartialArchive,
  verifyHistoricalUserPartialArchive,
} from "../../../apps/web/lib/data-export-historical-archive.js";
import { prepareSealedHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-storage.js";

const beforePrepare = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/data-export-historical-archive.js", () => ({
  prepareVerifiedHistoricalUserPartialArchive: vi.fn(),
  verifyHistoricalUserPartialArchive: vi.fn(() => true),
}));
vi.mock("../../../apps/web/lib/data-export-local-archive-storage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../apps/web/lib/data-export-local-archive-storage.js")>();
  return {
    ...original,
    ensurePrivateLocalExportArchiveDirectory: async (
      input: Parameters<typeof original.ensurePrivateLocalExportArchiveDirectory>[0],
    ) => {
      const result = await original.ensurePrivateLocalExportArchiveDirectory(input);
      beforePrepare();
      return result;
    },
  };
});

const roots: string[] = [];
const bytes = Buffer.from("sealed-private-original-user-archive-mock");
const digest = "a".repeat(64);
const prepare = vi.mocked(prepareVerifiedHistoricalUserPartialArchive);

async function fixture() {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "bro-private-original-user-"));
  roots.push(storageRoot);
  const authority = { exportId: randomUUID(), verifiedGitHubUserId: 974_211 };
  const db = { query: vi.fn(), withTransaction: vi.fn() } as never;
  const input = { db, authority, storageRoot, storageDriver: "local" };
  const returned = { bytes: Buffer.from(bytes), sha256: digest, byteLength: bytes.length };
  return { input, returned };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyHistoricalUserPartialArchive).mockReturnValue(true);
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// These success-path filesystem tests require Linux private-volume semantics.
const linuxIt = it.skipIf(process.platform !== "linux");

describe("source-only historical USER physical ZIP stage trusted binding", () => {
  linuxIt("holds the same numeric USER, export UUID, DB, storage root and driver after first source read", async () => {
    const { input, returned } = await fixture();
    const original = {
      db: input.db,
      uid: input.authority.verifiedGitHubUserId,
      exportId: input.authority.exportId,
      root: input.storageRoot,
    };
    const otherDb = { query: vi.fn(), withTransaction: vi.fn() } as never;
    const observed: unknown[] = [];
    prepare.mockImplementation(async (snapshot) => {
      observed.push({
        db: snapshot.db,
        uid: snapshot.authority.verifiedGitHubUserId,
        exportId: snapshot.authority.exportId,
        root: snapshot.storageRoot,
        driver: snapshot.storageDriver,
      });
      if (observed.length === 1) {
        input.db = otherDb;
        input.authority.exportId = randomUUID();
        input.authority.verifiedGitHubUserId++;
        input.storageRoot = path.join(original.root, "untrusted-root");
        input.storageDriver = "r2";
      }
      return { ...returned, bytes: Buffer.from(returned.bytes) };
    });
    const receipt = await prepareSealedHistoricalUserPrivatePartial(input);
    expect(receipt).toMatchObject({
      exportId: original.exportId,
      sha256: digest,
      byteLength: bytes.length,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
    });
    const expectedRead = {
      db: original.db,
      uid: original.uid,
      exportId: original.exportId,
      root: original.root,
      driver: "local",
    };
    expect(observed).toEqual([expectedRead, expectedRead]);
    expect(
      await readFile(
        path.join(original.root, ".private-export-archives", `${original.exportId}.historical-private-partial-v3.zip`),
      ),
    ).toEqual(bytes);
  });

  linuxIt("freezes original USER/DB/storage inputs BEFORE asynchronous private directory preparation", async () => {
    const { input, returned } = await fixture();
    const original = {
      db: input.db,
      uid: input.authority.verifiedGitHubUserId,
      exportId: input.authority.exportId,
      root: input.storageRoot,
    };
    beforePrepare.mockImplementationOnce(() => {
      input.db = { query: vi.fn(), withTransaction: vi.fn() } as never;
      input.authority.exportId = randomUUID();
      input.authority.verifiedGitHubUserId++;
      input.storageRoot = "/untrusted/other-volume";
      input.storageDriver = "r2";
    });
    prepare.mockResolvedValue({ ...returned, bytes: Buffer.from(returned.bytes) });
    const receipt = await prepareSealedHistoricalUserPrivatePartial(input);
    expect(receipt?.exportId).toBe(original.exportId);
    expect(prepare).toHaveBeenCalledTimes(2);
    for (const [request] of prepare.mock.calls) {
      expect(request).toMatchObject({
        db: original.db,
        authority: { exportId: original.exportId, verifiedGitHubUserId: original.uid },
        storageRoot: original.root,
        storageDriver: "local",
      });
    }
    expect(
      await readFile(
        path.join(original.root, ".private-export-archives", `${original.exportId}.historical-private-partial-v3.zip`),
      ),
    ).toEqual(bytes);
  });
});
