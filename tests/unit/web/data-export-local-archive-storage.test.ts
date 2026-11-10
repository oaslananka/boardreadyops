import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePrivateLocalExportArchiveDirectory,
  readSealedLocalExportArchive,
  sealLocalExportArchive,
} from "../../../apps/web/lib/data-export-local-archive-storage.js";
import { createZipBuffer } from "../../../src/util/zip.js";

const roots: string[] = [];
const digest = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), "bro-44-sealed-"));
  roots.push(directory);
  await chmod(directory, 0o700);
  return directory;
}
function zip(exportId: string, content = "synthetic, not customer data") {
  const names = [
    "metadata/artifacts.json",
    "metadata/finding-collaboration.json",
    "metadata/repositories.json",
    "metadata/review-comments.json",
    "metadata/review-workflow.json",
    "metadata/reviews-audit.json",
    "metadata/runs-findings.json",
  ];
  const entries = names.map((name) => ({ name, data: Buffer.from(content) }));
  const receipt = Buffer.from(
    JSON.stringify({
      kind: "boardreadyops.claimed-export-integrity-receipt",
      formatVersion: 1,
      exportId,
      scope: "bounded-platform-data-only",
      excludes: ["github-repository-source", "github-actions-logs-and-artifacts"],
      entries: entries.map(({ name, data }) => ({
        path: name,
        byteLength: data.length,
        sha256: digest(data),
      })),
    }),
  );
  const bytes = createZipBuffer([{ name: "metadata/archive-integrity.json", data: receipt }, ...entries]);
  return { bytes, byteLength: bytes.length, sha256: digest(bytes) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })));
});

describe("private, locally sealed export ZIP", () => {
  it("creates only the reserved private subdirectory under the existing artifact volume", async () => {
    const storageRoot = await root();
    const privateArchiveRoot = path.join(storageRoot, ".private-export-archives");
    const config = { storageRoot, privateArchiveRoot };
    expect(await ensurePrivateLocalExportArchiveDirectory(config)).toBe(true);
    const stat = await lstat(privateArchiveRoot);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o077).toBe(0);
    expect(await ensurePrivateLocalExportArchiveDirectory(config)).toBe(true);
    expect(
      await ensurePrivateLocalExportArchiveDirectory({
        ...config,
        privateArchiveRoot: storageRoot,
      }),
    ).toBe(false);
    expect(
      await ensurePrivateLocalExportArchiveDirectory({
        ...config,
        privateArchiveRoot: path.join(storageRoot, "objects"),
      }),
    ).toBe(false);
    expect(
      await ensurePrivateLocalExportArchiveDirectory({
        ...config,
        privateArchiveRoot: "relative/.private-export-archives",
      }),
    ).toBe(false);
    expect(
      await ensurePrivateLocalExportArchiveDirectory({
        ...config,
        storageRoot: "relative",
      }),
    ).toBe(false);
  });

  it("refuses group-readable and symlinked pre-existing private directories", async () => {
    const storageRoot = await root();
    const privateArchiveRoot = path.join(storageRoot, ".private-export-archives");
    const config = { storageRoot, privateArchiveRoot };
    await symlink(await root(), privateArchiveRoot);
    expect(await ensurePrivateLocalExportArchiveDirectory(config)).toBe(false);
    await rm(privateArchiveRoot);
    expect(await ensurePrivateLocalExportArchiveDirectory(config)).toBe(true);
    await chmod(privateArchiveRoot, 0o750);
    expect(await ensurePrivateLocalExportArchiveDirectory(config)).toBe(false);
    await chmod(storageRoot, 0o777);
    expect(await ensurePrivateLocalExportArchiveDirectory(config)).toBe(false);
  });

  it("fsyncs and stores a deterministic no-clobber ZIP, then independently verifies every entry", async () => {
    const archiveRoot = await root();
    const exportId = randomUUID();
    const archive = zip(exportId);
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive })).toEqual({
      exportId,
      sha256: archive.sha256,
      byteLength: archive.byteLength,
    });
    const filename = path.join(archiveRoot, `${exportId}.zip`);
    const stat = await lstat(filename);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o077).toBe(0);
    expect(stat.nlink).toBe(1);
    expect(await readSealedLocalExportArchive({ archiveRoot, exportId, ...archive })).toEqual(archive.bytes);
    for (const byteLength of [0, -1, Number.NaN, 2 ** 53, 64 * 1024 * 1024 + 1]) {
      expect(await readSealedLocalExportArchive({ archiveRoot, exportId, ...archive, byteLength })).toBeNull();
    }
    expect(
      await readSealedLocalExportArchive({ archiveRoot, exportId, ...archive, sha256: "A".repeat(64) }),
    ).toBeNull();
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive })).toMatchObject({
      sha256: archive.sha256,
    });
    expect(await readFile(filename)).toEqual(archive.bytes);
  });

  it("refuses to overwrite an export ID even when a caller supplies a valid alternative ZIP and digest", async () => {
    const archiveRoot = await root();
    const exportId = randomUUID();
    const first = zip(exportId);
    const second = zip(exportId, "not the same bytes");
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive: first })).not.toBeNull();
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive: second })).toBeNull();
    expect(await readFile(path.join(archiveRoot, `${exportId}.zip`))).toEqual(first.bytes);
  });

  it("rejects a modified, truncated, or renamed ZIP before an internal reader returns bytes", async () => {
    const archiveRoot = await root();
    const exportId = randomUUID();
    const archive = zip(exportId);
    const descriptor = { archiveRoot, exportId, sha256: archive.sha256, byteLength: archive.byteLength };
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive })).not.toBeNull();
    expect(await readSealedLocalExportArchive({ ...descriptor, sha256: "f".repeat(64) })).toBeNull();
    expect(await readSealedLocalExportArchive({ ...descriptor, exportId: randomUUID() })).toBeNull();
    await writeFile(path.join(archiveRoot, `${exportId}.zip`), Buffer.alloc(archive.byteLength));
    expect(await readSealedLocalExportArchive(descriptor)).toBeNull();
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive })).toBeNull();
    await writeFile(path.join(archiveRoot, `${exportId}.zip`), Buffer.alloc(0));
    expect(await readSealedLocalExportArchive(descriptor)).toBeNull();
  });

  it("rejects symlinks, group-readable roots, fabricated UUIDs and digest mismatch", async () => {
    const archiveRoot = await root();
    const exportId = randomUUID();
    const archive = zip(exportId);
    const symlinkRoot = path.join(await root(), "alias");
    await symlink(archiveRoot, symlinkRoot);
    expect(await sealLocalExportArchive({ archiveRoot: symlinkRoot, exportId, archive })).toBeNull();
    expect(await readSealedLocalExportArchive({ archiveRoot: symlinkRoot, exportId, ...archive })).toBeNull();
    await chmod(archiveRoot, 0o750);
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive })).toBeNull();
    await chmod(archiveRoot, 0o700);
    expect(await sealLocalExportArchive({ archiveRoot, exportId: "../../other", archive })).toBeNull();
    expect(
      await sealLocalExportArchive({ archiveRoot, exportId, archive: { ...archive, sha256: "0".repeat(64) } }),
    ).toBeNull();
    expect(
      await sealLocalExportArchive({
        archiveRoot,
        exportId,
        archive: { ...archive, byteLength: archive.byteLength + 1 },
      }),
    ).toBeNull();
  });

  it("never follows a preexisting symlink at the final export path", async () => {
    const archiveRoot = await root();
    const exportId = randomUUID();
    const archive = zip(exportId);
    const external = path.join(await root(), "outside.txt");
    await writeFile(external, "not customer data");
    await symlink(external, path.join(archiveRoot, `${exportId}.zip`));
    expect(await sealLocalExportArchive({ archiveRoot, exportId, archive })).toBeNull();
    expect(await readFile(external, "utf8")).toBe("not customer data");
    expect(await readSealedLocalExportArchive({ archiveRoot, exportId, ...archive })).toBeNull();
  });
});
