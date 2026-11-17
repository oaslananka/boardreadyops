/** Extract exactly one gzip manufacturing export from a GitHub Actions artifact ZIP.
 * No network, filesystem paths or third-party ZIP dependencies. Unsupported ZIP
 * features fail closed; the caller must independently verify the inner SHA-256.
 */

const maxZipBytes = 34 * 1024 * 1024;
const maxGzipBytes = 32 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function invalidZip(detail: string): never {
  throw new Error(`Invalid GitHub artifact ZIP: ${detail}`);
}

function uint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) invalidZip("truncated header.");
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) invalidZip("truncated header.");
  return view.getUint32(offset, true);
}

function unzipHeader(bytes: Uint8Array): { offset: number; size: number; method: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record has an optional bounded comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (uint32(view, i) === 0x06054b50 && i + 22 + uint16(view, i + 20) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) invalidZip("missing ZIP directory.");
  if (uint16(view, eocd + 4) !== 0 || uint16(view, eocd + 6) !== 0) invalidZip("multi-disk ZIP is unsupported.");
  const members = uint16(view, eocd + 10);
  if (members !== 1 || uint16(view, eocd + 8) !== members) invalidZip("expected one archive file.");
  const size = uint32(view, eocd + 12);
  const directory = uint32(view, eocd + 16);
  if (size === 0xffffffff || directory === 0xffffffff || directory + size !== eocd || size < 46) {
    invalidZip("unsafe ZIP directory.");
  }
  if (uint32(view, directory) !== 0x02014b50) invalidZip("invalid central header.");
  const flags = uint16(view, directory + 8);
  const method = uint16(view, directory + 10);
  if ((flags & ~(0x0008 | 0x0800)) !== 0 || (method !== 0 && method !== 8)) {
    invalidZip("unsupported encryption or compression.");
  }
  const packedSize = uint32(view, directory + 20);
  const unpackedSize = uint32(view, directory + 24);
  const nameLength = uint16(view, directory + 28);
  const extraLength = uint16(view, directory + 30);
  const commentLength = uint16(view, directory + 32);
  const localOffset = uint32(view, directory + 42);
  if (
    packedSize === 0xffffffff ||
    unpackedSize === 0xffffffff ||
    unpackedSize <= 0 ||
    unpackedSize > maxGzipBytes ||
    directory + 46 + nameLength + extraLength + commentLength !== eocd ||
    localOffset + 30 > directory
  ) {
    invalidZip("unsafe member size or header.");
  }
  let name: string;
  try {
    name = utf8.decode(bytes.subarray(directory + 46, directory + 46 + nameLength));
  } catch {
    invalidZip("unreadable archive name.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.tar\.gz$/u.test(name)) {
    invalidZip("unsafe ZIP member path or name.");
  }
  if (uint32(view, localOffset) !== 0x04034b50) invalidZip("missing local header.");
  const localFlags = uint16(view, localOffset + 6);
  const localNameLength = uint16(view, localOffset + 26);
  const localExtraLength = uint16(view, localOffset + 28);
  const localNameStart = localOffset + 30;
  const dataStart = localNameStart + localNameLength + localExtraLength;
  const dataEnd = dataStart + packedSize;
  if (
    localFlags !== flags ||
    uint16(view, localOffset + 8) !== method ||
    localNameLength !== nameLength ||
    dataEnd > directory ||
    utf8.decode(bytes.subarray(localNameStart, localNameStart + localNameLength)) !== name
  ) {
    invalidZip("local header does not match the directory.");
  }
  const descriptorSize = directory - dataEnd;
  if (flags & 0x0008) {
    const descriptorStart = dataEnd + (descriptorSize === 16 ? 4 : 0);
    if (
      (descriptorSize !== 12 && descriptorSize !== 16) ||
      (descriptorSize === 16 && uint32(view, dataEnd) !== 0x08074b50) ||
      uint32(view, descriptorStart + 4) !== packedSize ||
      uint32(view, descriptorStart + 8) !== unpackedSize
    ) {
      invalidZip("invalid ZIP data descriptor.");
    }
  } else if (
    descriptorSize !== 0 ||
    uint32(view, localOffset + 18) !== packedSize ||
    uint32(view, localOffset + 22) !== unpackedSize
  ) {
    invalidZip("unexpected ZIP data.");
  }
  return { offset: dataStart, size: packedSize, method };
}

/** ZIP is only a transport wrapper, not a trusted signed artifact. */
export async function unwrapGitHubArtifactZip(file: Blob, expectedGzipBytes: number): Promise<ArrayBuffer> {
  if (file.size < 22 || file.size > maxZipBytes || expectedGzipBytes < 1 || expectedGzipBytes > maxGzipBytes) {
    invalidZip("ZIP size outside safe preview limits.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { offset, size, method } = unzipHeader(bytes);
  const packed = bytes.slice(offset, offset + size);
  if (method === 0) {
    if (packed.byteLength !== expectedGzipBytes) invalidZip("wrong stored member size.");
    return packed.buffer;
  }
  if (typeof DecompressionStream === "undefined") {
    invalidZip("this browser cannot decompress ZIP files.");
  }
  const reader = new Blob([packed.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > expectedGzipBytes) {
        await reader.cancel();
        invalidZip("decompressed member exceeds the recorded size.");
      }
      parts.push(value);
    }
  } catch {
    invalidZip("ZIP member cannot be safely decompressed.");
  } finally {
    reader.releaseLock();
  }
  if (length !== expectedGzipBytes) invalidZip("decompressed member size mismatch.");
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output.buffer;
}
