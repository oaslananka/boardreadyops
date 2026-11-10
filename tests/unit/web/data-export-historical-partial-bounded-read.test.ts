import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, open, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyHistoricalUserPartialArchive } from "../../../apps/web/lib/data-export-historical-archive.js";
import { readSealedHistoricalUserPartial } from "../../../apps/web/lib/data-export-historical-partial-storage.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
vi.mock("../../../apps/web/lib/data-export-historical-archive.js", () => ({
  verifyHistoricalUserPartialArchive: vi.fn(() => true),
  prepareVerifiedHistoricalUserPartialArchive: vi.fn(),
}));

type FileHandle = Awaited<ReturnType<typeof open>>;
const roots: string[] = [];

async function privateFixture() {
  const base = await mkdtemp(path.join(tmpdir(), "boardreadyops-bounded-zip-"));
  roots.push(base);
  const archiveRoot = path.join(base, ".private-export-archives");
  await mkdir(archiveRoot, { mode: 0o700 });
  const exportId = randomUUID();
  const bytes = Buffer.from("bound-to-original-user-private-zip");
  const file = path.join(archiveRoot, `${exportId}.historical-private-partial-v3.zip`);
  await writeFile(file, bytes, { mode: 0o600 });
  const input = { archiveRoot, exportId, sha256: "a".repeat(64), byteLength: bytes.length };
  return { input, file, bytes };
}

afterEach(async () => {
  vi.mocked(open).mockReset();
  vi.mocked(verifyHistoricalUserPartialArchive).mockReset();
  vi.mocked(verifyHistoricalUserPartialArchive).mockReturnValue(true);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// These success-path filesystem tests require Linux private-volume semantics.
const linuxIt = it.skipIf(process.platform !== "linux");

describe("source-only historical private ZIP bounded file-descriptor reads", () => {
  linuxIt("accepts only the exact fixed-length verified private bytes", async () => {
    const { input, bytes } = await privateFixture();
    const accepted = await readSealedHistoricalUserPartial(input);
    expect(accepted).not.toBeNull();
    expect(accepted).toEqual(bytes);
    expect(verifyHistoricalUserPartialArchive).toHaveBeenCalledWith(accepted, input.sha256, input.exportId);
    expect(accepted?.every((byte) => byte === 0)).toBe(false);
    accepted?.fill(0);
  });

  linuxIt("refuses appended data after initial stat without growing the read buffer", async () => {
    const { input, file } = await privateFixture();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const observedLengths: number[] = [];
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const read = handle.read.bind(handle);
      let appended = false;
      handle.read = (async (buffer: Buffer, offset: number, length: number, position: number) => {
        observedLengths.push(length);
        if (!appended) {
          appended = true;
          await appendFile(file, Buffer.from("untrusted-tail"));
        }
        return read(buffer, offset, length, position);
      }) as FileHandle["read"];
      return handle;
    });
    expect(await readSealedHistoricalUserPartial(input)).toBeNull();
    expect(observedLengths).toEqual([input.byteLength, 1]);
    expect(verifyHistoricalUserPartialArchive).not.toHaveBeenCalled();
  });

  it("rejects a truncated descriptor during read without verifying partial bytes", async () => {
    const { input, file } = await privateFixture();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const read = handle.read.bind(handle);
      let truncated = false;
      handle.read = (async (buffer: Buffer, offset: number, length: number, position: number) => {
        if (!truncated) {
          truncated = true;
          await truncate(file, 2);
        }
        return read(buffer, offset, length, position);
      }) as FileHandle["read"];
      return handle;
    });
    expect(await readSealedHistoricalUserPartial(input)).toBeNull();
    expect(verifyHistoricalUserPartialArchive).not.toHaveBeenCalled();
  });

  linuxIt("zeroizes the fixed-size buffer on failed ZIP integrity verification", async () => {
    const { input } = await privateFixture();
    let captured: Buffer | undefined;
    vi.mocked(verifyHistoricalUserPartialArchive).mockImplementationOnce((bytes) => {
      captured = bytes;
      return false;
    });
    expect(await readSealedHistoricalUserPartial(input)).toBeNull();
    expect(captured?.length).toBe(input.byteLength);
    expect(captured?.every((byte) => byte === 0)).toBe(true);
  });

  linuxIt("does not release verified ZIP bytes when the file descriptor fails to close", async () => {
    const { input } = await privateFixture();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      handle.close = (async () => {
        await close();
        throw new Error("Simulated unsafe descriptor close");
      }) as FileHandle["close"];
      return handle;
    });
    let captured: Buffer | null = null;
    vi.mocked(verifyHistoricalUserPartialArchive).mockImplementationOnce((bytes) => {
      captured = bytes;
      return true;
    });
    expect(await readSealedHistoricalUserPartial(input)).toBeNull();
    expect(captured).not.toBeNull();
    expect((captured as Buffer | null)?.every((byte: number) => byte === 0)).toBe(true);
  });

  it("rejects forged sizes outside the 64 MiB budget before opening any ZIP", async () => {
    const { input } = await privateFixture();
    for (const byteLength of [0, -1, Number.NaN, 64 * 1024 * 1024 + 1]) {
      expect(await readSealedHistoricalUserPartial({ ...input, byteLength })).toBeNull();
    }
    expect(open).not.toHaveBeenCalled();
  });
});
