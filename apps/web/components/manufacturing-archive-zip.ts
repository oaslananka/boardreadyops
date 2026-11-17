/** Extract exactly one gzip manufacturing export from a GitHub Actions artifact ZIP.
 * No network, filesystem paths or third-party ZIP dependencies. Unsupported ZIP
 * features fail closed; the caller must independently verify the inner SHA-256.
 */

const maxZipBytes = 34 * 1024 * 1024;
const maxGzipBytes = 32 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

type ZipMember = Readonly<{
  name: string;
  flags: number;
  method: number;
  packedSize: number;
  unpackedSize: number;
  localOffset: number;
  directoryOffset: number;
}>;

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

function findDirectoryEnd(view: DataView, length: number): number {
  for (let offset = length - 22; offset >= Math.max(0, length - 65_557); offset--) {
    if (uint32(view, offset) === 0x06054b50 && offset + 22 + uint16(view, offset + 20) === length) {
      return offset;
    }
  }
  return invalidZip("missing ZIP directory.");
}

function readMemberName(bytes: Uint8Array, offset: number, size: number): string {
  let name: string;
  try {
    name = utf8.decode(bytes.subarray(offset, offset + size));
  } catch {
    return invalidZip("unreadable archive name.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.tar\.gz$/u.test(name)) {
    invalidZip("unsafe ZIP member path or name.");
  }
  return name;
}

function validateCentralBounds(view: DataView, eocd: number, directoryOffset: number): void {
  const directorySize = uint32(view, eocd + 12);
  if (directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    invalidZip("ZIP64 is unsupported.");
  }
  if (directorySize < 46 || directoryOffset + directorySize !== eocd) {
    invalidZip("unsafe ZIP directory.");
  }
  if (uint32(view, directoryOffset) !== 0x02014b50) {
    invalidZip("invalid central header.");
  }
}

function readCentralMember(view: DataView, bytes: Uint8Array, eocd: number): ZipMember {
  if (uint16(view, eocd + 4) !== 0 || uint16(view, eocd + 6) !== 0) {
    invalidZip("multi-disk ZIP is unsupported.");
  }
  const memberCount = uint16(view, eocd + 10);
  if (memberCount !== 1 || uint16(view, eocd + 8) !== memberCount) {
    invalidZip("expected one archive file.");
  }
  const directoryOffset = uint32(view, eocd + 16);
  validateCentralBounds(view, eocd, directoryOffset);
  const flags = uint16(view, directoryOffset + 8);
  const method = uint16(view, directoryOffset + 10);
  if ((flags & ~(0x0008 | 0x0800)) !== 0 || (method !== 0 && method !== 8)) {
    invalidZip("unsupported encryption or compression.");
  }
  const packedSize = uint32(view, directoryOffset + 20);
  const unpackedSize = uint32(view, directoryOffset + 24);
  if (packedSize === 0xffffffff || unpackedSize === 0xffffffff) invalidZip("ZIP64 is unsupported.");
  if (unpackedSize < 1 || unpackedSize > maxGzipBytes) invalidZip("unsafe member size.");
  const nameLength = uint16(view, directoryOffset + 28);
  const extraLength = uint16(view, directoryOffset + 30);
  const commentLength = uint16(view, directoryOffset + 32);
  if (directoryOffset + 46 + nameLength + extraLength + commentLength !== eocd) {
    invalidZip("unexpected central directory contents.");
  }
  const localOffset = uint32(view, directoryOffset + 42);
  if (localOffset + 30 > directoryOffset) invalidZip("unsafe local header offset.");
  const name = readMemberName(bytes, directoryOffset + 46, nameLength);
  return { name, flags, method, packedSize, unpackedSize, localOffset, directoryOffset };
}

function validateDescriptor(view: DataView, member: ZipMember, dataEnd: number): void {
  const descriptorSize = member.directoryOffset - dataEnd;
  if (member.flags & 0x0008) {
    if (descriptorSize !== 12 && descriptorSize !== 16) invalidZip("invalid ZIP data descriptor.");
    const start = dataEnd + (descriptorSize === 16 ? 4 : 0);
    if (descriptorSize === 16 && uint32(view, dataEnd) !== 0x08074b50) {
      invalidZip("invalid ZIP data descriptor.");
    }
    if (uint32(view, start + 4) !== member.packedSize || uint32(view, start + 8) !== member.unpackedSize) {
      invalidZip("invalid ZIP data descriptor.");
    }
    return;
  }
  if (descriptorSize !== 0) invalidZip("unexpected ZIP data.");
  if (
    uint32(view, member.localOffset + 18) !== member.packedSize ||
    uint32(view, member.localOffset + 22) !== member.unpackedSize
  ) {
    invalidZip("local sizes do not match the directory.");
  }
}

function readLocalDataOffset(view: DataView, bytes: Uint8Array, member: ZipMember): number {
  const { localOffset, directoryOffset, packedSize, name, flags, method } = member;
  if (uint32(view, localOffset) !== 0x04034b50) invalidZip("missing local header.");
  const nameLength = uint16(view, localOffset + 26);
  const extraLength = uint16(view, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + packedSize;
  if (dataEnd > directoryOffset) invalidZip("unsafe compressed member span.");
  if (uint16(view, localOffset + 6) !== flags || uint16(view, localOffset + 8) !== method) {
    invalidZip("local header does not match the directory.");
  }
  if (readMemberName(bytes, localOffset + 30, nameLength) !== name) {
    invalidZip("local header does not match the directory.");
  }
  validateDescriptor(view, member, dataEnd);
  return dataStart;
}

function unzipHeader(bytes: Uint8Array): { offset: number; size: number; method: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const member = readCentralMember(view, bytes, findDirectoryEnd(view, bytes.length));
  return { offset: readLocalDataOffset(view, bytes, member), size: member.packedSize, method: member.method };
}

async function inflateDeflateRaw(data: ArrayBuffer, expectedBytes: number): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") invalidZip("this browser cannot decompress ZIP files.");
  let length = 0;
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      length += chunk.byteLength;
      if (length > expectedBytes) invalidZip("decompressed member exceeds the recorded size.");
      controller.enqueue(chunk);
    },
  });
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).pipeThrough(bounded);
    const output = await new Response(stream).arrayBuffer();
    if (output.byteLength !== expectedBytes) invalidZip("decompressed member size mismatch.");
    return output;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid GitHub artifact ZIP:")) throw error;
    return invalidZip("ZIP member cannot be safely decompressed.");
  }
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
  return inflateDeflateRaw(packed.buffer, expectedGzipBytes);
}
