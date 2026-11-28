import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyClaimedExportArchiveIntegrity } from "../../../apps/web/lib/data-export-archive-integrity.js";
import {
  consumeAuthorizedSealedLocalExportArchive,
  readAuthorizedSealedLocalExportArchive,
} from "../../../apps/web/lib/data-export-local-archive.js";
import {
  readSealedLocalExportArchive,
  sealLocalExportArchive,
} from "../../../apps/web/lib/data-export-local-archive-storage.js";
import { DataExportArchiveCommitmentStore } from "../../../packages/db/src/data-export-archive-commitment-store.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";

vi.mock("node:fs/promises", { spy: true });
vi.mock("../../../apps/web/lib/data-export-archive-integrity.js", () => ({
  verifyClaimedExportArchiveIntegrity: vi.fn(() => true),
}));

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
function fixture() {
  // Mock only private-volume admission and descriptor IO. Existing Linux
  // tests cover real permissions and native sealing.
  Object.defineProperty(process, "platform", { ...originalPlatform, value: "linux" });
  const bytes = Buffer.from("synthetic private ZIP");
  const archiveRoot = path.resolve("synthetic-private-export");
  const exportId = randomUUID();
  const input = { archiveRoot, exportId, sha256: sha(bytes), byteLength: bytes.length };
  const stat = {
    isFile: () => true,
    size: bytes.length,
    nlink: 1,
    mode: 0o600,
    uid: process.getuid?.() ?? 0,
    dev: 1,
    ino: 2,
    mtimeMs: 10,
    ctimeMs: 10,
  };
  vi.mocked(lstat).mockResolvedValue({ ...stat, isDirectory: () => true, isSymbolicLink: () => false } as never);
  vi.mocked(realpath).mockResolvedValue(archiveRoot);
  const captured = Buffer.from(bytes);
  const handle = {
    stat: vi.fn(async () => stat),
    readFile: vi.fn(async () => captured),
    read: vi.fn(async (target: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = bytes.copy(
        target,
        offset,
        Math.min(position, bytes.length),
        Math.min(position + length, bytes.length),
      );
      return { bytesRead, buffer: target };
    }),
    close: vi.fn(async () => undefined),
  };
  vi.mocked(open).mockResolvedValue(handle as never);
  return { bytes, input, stat, handle, captured };
}

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  vi.restoreAllMocks();
  vi.mocked(open).mockReset();
  vi.mocked(lstat).mockReset();
  vi.mocked(realpath).mockReset();
  vi.mocked(link).mockReset();
  vi.mocked(unlink).mockReset();
  vi.mocked(verifyClaimedExportArchiveIntegrity).mockReset();
  vi.mocked(verifyClaimedExportArchiveIntegrity).mockReturnValue(true);
});

describe("ordinary private ZIP read lifetime", () => {
  it("uses a fixed allocation and one-byte probe, never readFile", async () => {
    const f = fixture();
    await expect(readSealedLocalExportArchive(f.input)).resolves.toEqual(f.bytes);
    expect(f.handle.readFile).not.toHaveBeenCalled();
    expect(f.handle.read.mock.calls.map((call) => call[2])).toEqual([f.bytes.length, 1]);
  });

  it("rejects appended bytes even if metadata appears unchanged", async () => {
    const f = fixture();
    const read = f.handle.read.getMockImplementation();
    if (!read) throw new Error("Missing synthetic descriptor reader");
    f.handle.read.mockImplementation(async (target, offset, length, position) => {
      if (position === f.bytes.length) {
        target[offset] = 88;
        return { bytesRead: 1, buffer: target };
      }
      return read(target, offset, length, position);
    });
    await expect(readSealedLocalExportArchive(f.input)).resolves.toBeNull();
    expect(f.handle.readFile).not.toHaveBeenCalled();
    expect(f.handle.read.mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
    expect(f.handle.read.mock.calls[1]?.[0]).toEqual(Buffer.alloc(1));
    expect(verifyClaimedExportArchiveIntegrity).not.toHaveBeenCalled();
  });

  it("wipes a partially read ZIP on short read", async () => {
    const f = fixture();
    f.handle.read
      .mockImplementationOnce(async (target) => {
        f.bytes.copy(target, 0, 0, 2);
        return { bytesRead: 2, buffer: target };
      })
      .mockImplementationOnce(async (target) => ({ bytesRead: 0, buffer: target }));
    await expect(readSealedLocalExportArchive(f.input)).resolves.toBeNull();
    expect(f.handle.read.mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
  });

  it("wipes rejected digest bytes", async () => {
    const f = fixture();
    vi.mocked(verifyClaimedExportArchiveIntegrity).mockReturnValueOnce(false);
    await expect(readSealedLocalExportArchive(f.input)).resolves.toBeNull();
    expect(vi.mocked(verifyClaimedExportArchiveIntegrity).mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
  });

  it("denies and wipes bytes when descriptor close fails", async () => {
    const f = fixture();
    f.handle.close.mockRejectedValueOnce(new Error("synthetic close failure"));
    await expect(readSealedLocalExportArchive(f.input)).resolves.toBeNull();
    expect(vi.mocked(verifyClaimedExportArchiveIntegrity).mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
  });

  it("rejects a permission change during the read", async () => {
    const f = fixture();
    f.handle.stat.mockResolvedValueOnce(f.stat).mockResolvedValueOnce({ ...f.stat, mode: 0o644, ctimeMs: 11 });
    await expect(readSealedLocalExportArchive(f.input)).resolves.toBeNull();
    expect(f.handle.read.mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
  });

  it("pins the validated archive identity before asynchronous IO", async () => {
    const f = fixture();
    const original = { ...f.input };
    vi.mocked(realpath).mockImplementationOnce(async () => {
      f.input.byteLength = 64 * 1024 * 1024 + 1;
      f.input.exportId = randomUUID();
      return original.archiveRoot;
    });
    await expect(readSealedLocalExportArchive(f.input)).resolves.toEqual(f.bytes);
    expect(open).toHaveBeenCalledWith(path.join(original.archiveRoot, `${original.exportId}.zip`), expect.any(Number));
    expect(verifyClaimedExportArchiveIntegrity).toHaveBeenCalledWith(
      expect.any(Buffer),
      original.sha256,
      original.exportId,
    );
  });

  it("wipes seal readback but preserves the caller-owned ZIP", async () => {
    const f = fixture();
    const writable = {
      writeFile: vi.fn(async () => undefined),
      sync: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    vi.mocked(open)
      .mockResolvedValueOnce(writable as never)
      .mockResolvedValueOnce(writable as never);
    vi.mocked(link).mockResolvedValue(undefined);
    vi.mocked(unlink).mockResolvedValue(undefined);
    const archive = { bytes: f.bytes, sha256: f.input.sha256, byteLength: f.bytes.length };
    const original = Buffer.from(archive.bytes);
    await expect(
      sealLocalExportArchive({ archiveRoot: f.input.archiveRoot, exportId: f.input.exportId, archive }),
    ).resolves.toEqual({
      exportId: f.input.exportId,
      sha256: archive.sha256,
      byteLength: archive.byteLength,
    });
    expect(vi.mocked(verifyClaimedExportArchiveIntegrity).mock.calls[1]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
    expect(archive.bytes).toEqual(original);
  });

  it.each(["denied", "error"] as const)("wipes bytes on late requester audit %s", async (outcome) => {
    const f = fixture();
    const commitment = {
      sha256: f.input.sha256,
      byteLength: f.input.byteLength,
      files: 8,
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    vi.spyOn(DataExportArchiveCommitmentStore.prototype, "readForRequester").mockResolvedValue(commitment);
    const audit = vi.spyOn(DataExportArchiveCommitmentStore.prototype, "auditVerifiedReadForRequester");
    if (outcome === "error") audit.mockRejectedValue(new Error("synthetic audit failure"));
    else audit.mockResolvedValue(null);
    const request = {
      ...f.input,
      tenantId: "tenant",
      installationId: "installation",
      actorLogin: "user",
      db: { query: vi.fn() } as unknown as Pick<PgQueryExecutor, "query">,
    };
    if (outcome === "error")
      await expect(readAuthorizedSealedLocalExportArchive(request)).rejects.toThrow("synthetic audit failure");
    else await expect(readAuthorizedSealedLocalExportArchive(request)).resolves.toBeNull();
    expect(vi.mocked(verifyClaimedExportArchiveIntegrity).mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
  });

  it.each(["success", "error"] as const)("wipes transaction-owned ZIP after consumer %s", async (outcome) => {
    const f = fixture();
    const commitment = {
      sha256: f.input.sha256,
      byteLength: f.input.byteLength,
      files: 8,
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    vi.spyOn(DataExportArchiveCommitmentStore.prototype, "readForRequester").mockResolvedValue(commitment);
    vi.spyOn(DataExportArchiveCommitmentStore.prototype, "auditVerifiedReadForRequester").mockResolvedValue(commitment);
    const db = {
      withTransaction: async (work: (tx: object) => Promise<unknown>) => work({ query: vi.fn() }),
    } as unknown as Pick<PgQueryExecutor, "withTransaction">;
    const request = { ...f.input, tenantId: "tenant", installationId: "installation", actorLogin: "user", db };
    const consume = vi.fn(async (bytes: Buffer) => {
      expect(bytes).toEqual(f.bytes);
      if (outcome === "error") throw new Error("synthetic sink failure");
    });
    const result = consumeAuthorizedSealedLocalExportArchive(request, consume);
    if (outcome === "error") await expect(result).rejects.toThrow("synthetic sink failure");
    else await expect(result).resolves.toBe(true);
    expect(consume.mock.calls[0]?.[0]).toEqual(Buffer.alloc(f.bytes.length));
  });
});
