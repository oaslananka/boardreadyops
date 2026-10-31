import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as artifactDownloads from "../../../apps/web/lib/artifact-downloads.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, open: vi.fn(real.open) };
});

import {
  maxLocalExportObjectBytes,
  readVerifiedLocalExportObject,
} from "../../../apps/web/lib/data-export-local-object.js";

const created: string[] = [];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(bytes = Buffer.from("synthetic artifact data")) {
  const root = await mkdtemp(path.join(tmpdir(), "bro-local-export-"));
  created.push(root);
  await mkdir(path.join(root, "artifacts"));
  await writeFile(path.join(root, "artifacts", "body.bin"), bytes);
  const object = { storagePath: "artifacts/body.bin", byteLength: bytes.length, sha256: sha(bytes) };
  return { root, object, bytes };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("bounded, read-only physical export object verification", () => {
  it("verifies all bytes and digest without granting access or changing files", async () => {
    const f = await fixture();
    const result = await readVerifiedLocalExportObject({
      storageDriver: "local",
      storageRoot: f.root,
      object: f.object,
    });
    expect(result).toEqual(f.bytes);
    expect(result).not.toBe(f.bytes);
  });

  it("verifies zero-length objects and chunked 1-MiB objects", async () => {
    for (const input of [Buffer.alloc(0), Buffer.alloc(1024 * 1024, 31)]) {
      const f = await fixture(input);
      await expect(
        readVerifiedLocalExportObject({ storageDriver: "local", storageRoot: f.root, object: f.object }),
      ).resolves.toEqual(input);
    }
  });

  it("rejects mismatched size, digest and same-sized tampering", async () => {
    const f = await fixture();
    const read = (object: typeof f.object) =>
      readVerifiedLocalExportObject({ storageDriver: "local", storageRoot: f.root, object });
    await expect(read({ ...f.object, byteLength: f.object.byteLength + 1 })).resolves.toBeNull();
    await expect(read({ ...f.object, sha256: "0".repeat(64) })).resolves.toBeNull();
    await writeFile(path.join(f.root, f.object.storagePath), Buffer.from("X".repeat(f.object.byteLength)));
    await expect(read(f.object)).resolves.toBeNull();
  });

  it("rejects missing objects, path traversal and symlinks escaping the root", async () => {
    const f = await fixture();
    const outside = await fixture(Buffer.from("private sibling data"));
    const ref = { storageDriver: "local", storageRoot: f.root, object: f.object };
    await expect(
      readVerifiedLocalExportObject({ ...ref, object: { ...f.object, storagePath: "missing.bin" } }),
    ).resolves.toBeNull();
    await expect(
      readVerifiedLocalExportObject({ ...ref, object: { ...f.object, storagePath: "../secret.bin" } }),
    ).resolves.toBeNull();
    await symlink(path.join(outside.root, "artifacts", "body.bin"), path.join(f.root, "artifacts", "outside.bin"));
    await expect(
      readVerifiedLocalExportObject({ ...ref, object: { ...f.object, storagePath: "artifacts/outside.bin" } }),
    ).resolves.toBeNull();
  });

  it("rejects an object removed between path resolution and opening", async () => {
    const f = await fixture();
    vi.spyOn(artifactDownloads, "resolveLocalArtifactFile").mockResolvedValue({
      state: "resolved",
      path: path.join(f.root, "artifacts", "removed-before-open.bin"),
    });
    await expect(
      readVerifiedLocalExportObject({ storageDriver: "local", storageRoot: f.root, object: f.object }),
    ).resolves.toBeNull();
  });

  it("rejects a disk read failure after opening a previously valid file", async () => {
    const f = await fixture();
    const fakeHandle = {
      stat: async () => ({ isFile: () => true, size: f.bytes.length }),
      read: async () => {
        throw new Error("synthetic disk read failure");
      },
      close: vi.fn(async () => undefined),
    };
    vi.mocked(filesystem.open).mockResolvedValueOnce(
      fakeHandle as unknown as Awaited<ReturnType<typeof filesystem.open>>,
    );
    await expect(
      readVerifiedLocalExportObject({ storageDriver: "local", storageRoot: f.root, object: f.object }),
    ).resolves.toBeNull();
    expect(fakeHandle.close).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported storage drivers, oversized inputs and malformed hash/metadata", async () => {
    const f = await fixture();
    const ref = { storageDriver: "local", storageRoot: f.root, object: f.object };
    await expect(readVerifiedLocalExportObject({ ...ref, storageDriver: "s3" })).resolves.toBeNull();
    await expect(readVerifiedLocalExportObject({ ...ref, storageRoot: "" })).resolves.toBeNull();
    await expect(
      readVerifiedLocalExportObject({ ...ref, object: { ...f.object, byteLength: maxLocalExportObjectBytes + 1 } }),
    ).resolves.toBeNull();
    await expect(
      readVerifiedLocalExportObject({ ...ref, object: { ...f.object, byteLength: -1 } }),
    ).resolves.toBeNull();
    await expect(
      readVerifiedLocalExportObject({ ...ref, object: { ...f.object, sha256: "not-a-digest" } }),
    ).resolves.toBeNull();
  });
});
