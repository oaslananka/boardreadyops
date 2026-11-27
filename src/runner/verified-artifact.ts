import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";

function sameArtifact(before: Stats, after: Stats): boolean {
  return (
    after.isFile() &&
    after.size === before.size &&
    after.dev === before.dev &&
    after.ino === before.ino &&
    after.mtimeMs === before.mtimeMs &&
    after.ctimeMs === before.ctimeMs
  );
}

// Each yielded chunk is a view of the single declared-size allocation.
// The async generator settles a read before advancing to the next offset.
async function* readDeclaredChunks(handle: FileHandle, content: Buffer): AsyncGenerator<Buffer> {
  let offset = 0;
  while (offset < content.length) {
    yield handle.read(content, offset, Math.min(64 * 1024, content.length - offset), offset).then(({ bytesRead }) => {
      if (bytesRead === 0) throw new Error("artifact size changed before transfer");
      const chunk = content.subarray(offset, offset + bytesRead);
      offset += bytesRead;
      return chunk;
    });
  }
}

async function readDeclaredDigest(handle: FileHandle, content: Buffer): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of readDeclaredChunks(handle, content)) {
    hash.update(chunk);
  }
  const extra = Buffer.alloc(1);
  try {
    if ((await handle.read(extra, 0, 1, content.length)).bytesRead !== 0) {
      throw new Error("artifact size changed before transfer");
    }
  } finally {
    extra.fill(0);
  }
  return hash.digest("hex");
}

/** Read a declared artifact from one descriptor, never beyond its declared size plus a one-byte probe. */
export async function readVerifiedRunnerArtifact(
  filePath: string,
  byteLength: number,
  expectedSha256: string,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maximumBytes) {
    throw new Error("artifact size declaration is outside the permitted bound");
  }
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error("artifact upload SHA-256 declaration is invalid");
  }
  const pathInfo = await lstat(filePath);
  if (!pathInfo.isFile()) throw new Error("artifact is not a regular file");
  if (pathInfo.size !== byteLength) throw new Error("artifact size changed before transfer");
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let content: Buffer | undefined;
  let verified = false;
  try {
    const before = await handle.stat();
    if (!sameArtifact(pathInfo, before)) throw new Error("artifact changed before transfer");
    content = Buffer.alloc(byteLength);
    const digest = await readDeclaredDigest(handle, content);
    if (!sameArtifact(before, await handle.stat())) throw new Error("artifact changed before transfer");
    if (digest !== expectedSha256) {
      throw new Error("artifact digest changed: bytes do not match its declaration");
    }
    verified = true;
  } finally {
    let closed = false;
    try {
      await handle.close();
      closed = true;
    } finally {
      if (!verified || !closed) content?.fill(0);
    }
  }
  if (!content) throw new Error("artifact verification did not complete");
  return content;
}
