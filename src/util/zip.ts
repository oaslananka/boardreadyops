import { deflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  data: Buffer;
}

interface ZipCentralEntry {
  name: Buffer;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  compressedData: Buffer;
  offset: number;
  dosDate: number;
  dosTime: number;
}

function crc32(data: Buffer): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crc32Table: Uint32Array | undefined;
function crc32Table(): Uint32Array {
  if (_crc32Table) {
    return _crc32Table;
  }
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    _crc32Table[i] = c;
  }
  return _crc32Table;
}

function dosDateTime(date: Date): { dosDate: number; dosTime: number } {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { dosDate, dosTime };
}

/**
 * Creates a ZIP archive in memory from a list of named file entries.
 * Uses DEFLATE compression. No external dependencies required.
 */
export function createZipBuffer(entries: ZipEntry[], date = new Date()): Buffer {
  const { dosDate, dosTime } = dosDateTime(date);
  const centralEntries: ZipCentralEntry[] = [];
  const parts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    // Use deflate; fall back to stored if deflated is larger
    const deflated = deflateRawSync(entry.data, { level: 6 });
    const useDeflate = deflated.length < entry.data.length;
    const compressedData = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.allocUnsafe(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header sig
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0, 6); // general purpose flags
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    nameBytes.copy(localHeader, 30);

    parts.push(localHeader, compressedData);

    centralEntries.push({
      name: nameBytes,
      crc32: checksum,
      compressedSize: compressedData.length,
      uncompressedSize: entry.data.length,
      compressedData,
      offset,
      dosDate,
      dosTime,
    });

    offset += localHeader.length + compressedData.length;
  }

  const centralStart = offset;

  for (const entry of centralEntries) {
    const centralHeader = Buffer.allocUnsafe(46 + entry.name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir sig
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // general purpose flags
    centralHeader.writeUInt16LE(entry.compressedSize < entry.uncompressedSize ? 8 : 0, 10); // method
    centralHeader.writeUInt16LE(entry.dosTime, 12);
    centralHeader.writeUInt16LE(entry.dosDate, 14);
    centralHeader.writeUInt32LE(entry.crc32, 16);
    centralHeader.writeUInt32LE(entry.compressedSize, 20);
    centralHeader.writeUInt32LE(entry.uncompressedSize, 24);
    centralHeader.writeUInt16LE(entry.name.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0, 38); // external attributes
    centralHeader.writeUInt32LE(entry.offset, 42);
    entry.name.copy(centralHeader, 46);
    parts.push(centralHeader);
    offset += centralHeader.length;
  }

  const centralSize = offset - centralStart;

  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory sig
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(centralEntries.length, 8);
  eocd.writeUInt16LE(centralEntries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  parts.push(eocd);

  return Buffer.concat(parts);
}
