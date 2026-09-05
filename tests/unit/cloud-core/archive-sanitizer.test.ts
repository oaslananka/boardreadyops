import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  type ArchiveLimits,
  ArchiveSanitizerError,
  sanitizeAndExtractArchive,
} from "../../../packages/cloud-core/src/archive-sanitizer.js";

function buildCustomZip(
  entries: Array<{
    name: string;
    content: string | Buffer;
    externalAttributes?: number;
    compressionMethod?: number;
  }>,
): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const rawData = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const nameBytes = Buffer.from(entry.name, "utf8");
    const method = entry.compressionMethod ?? 0;
    const compressedData = method === 8 ? deflateRawSync(rawData) : rawData;

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header sig
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // method
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(0, 14); // crc32
    local.writeUInt32LE(compressedData.length, 18); // compressed size
    local.writeUInt32LE(rawData.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26); // name length
    local.writeUInt16LE(0, 28); // extra len
    nameBytes.copy(local, 30);

    parts.push(local, compressedData);

    const cHeader = Buffer.alloc(46 + nameBytes.length);
    cHeader.writeUInt32LE(0x02014b50, 0); // central dir sig
    cHeader.writeUInt16LE(20, 4); // version made by
    cHeader.writeUInt16LE(20, 6); // version needed
    cHeader.writeUInt16LE(0, 8); // flags
    cHeader.writeUInt16LE(method, 10); // method
    cHeader.writeUInt16LE(0, 12); // time
    cHeader.writeUInt16LE(0, 14); // date
    cHeader.writeUInt32LE(0, 16); // crc32
    cHeader.writeUInt32LE(compressedData.length, 20); // compressed size
    cHeader.writeUInt32LE(rawData.length, 24); // uncompressed size
    cHeader.writeUInt16LE(nameBytes.length, 28); // name len
    cHeader.writeUInt16LE(0, 30); // extra len
    cHeader.writeUInt16LE(0, 32); // comment len
    cHeader.writeUInt16LE(0, 34); // disk num
    cHeader.writeUInt16LE(0, 36); // internal attr
    cHeader.writeUInt32LE((entry.externalAttributes ?? 0) >>> 0, 38); // external attr
    cHeader.writeUInt32LE(offset, 42); // offset
    nameBytes.copy(cHeader, 46);

    central.push(cHeader);
    offset += local.length + compressedData.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(central);
  const centralSize = centralBuffer.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralBuffer, eocd]);
}

describe("Archive Sanitizer & Security Boundary", () => {
  it("successfully extracts valid entries from benign zip archive", () => {
    const zipBuffer = buildCustomZip([
      { name: "board.gtl", content: "G04 Gerber Layer Top*", compressionMethod: 8 },
      { name: "bom.csv", content: "Designator,Comment,Footprint\nR1,10k,0603", compressionMethod: 0 },
    ]);

    const result = sanitizeAndExtractArchive(zipBuffer);
    expect(result.fileCount).toBe(2);
    expect(result.files.map((f) => f.path)).toEqual(["board.gtl", "bom.csv"]);
    expect(result.files[0]?.data.toString()).toBe("G04 Gerber Layer Top*");
    expect(result.files[1]?.data.toString()).toContain("Designator,Comment,Footprint");
  });

  it("rejects corrupted archive missing End of Central Directory", () => {
    const garbage = Buffer.from("not a valid zip file content");
    expect(() => sanitizeAndExtractArchive(garbage)).toThrowError(ArchiveSanitizerError);
    try {
      sanitizeAndExtractArchive(garbage);
    } catch (err) {
      expect((err as ArchiveSanitizerError).code).toBe("CORRUPTED_ARCHIVE");
    }
  });

  it("enforces maxCompressedSizeBytes limit", () => {
    const largeBuffer = Buffer.alloc(1024, 0);
    const limits: ArchiveLimits = { maxCompressedSizeBytes: 512 };

    expect(() => sanitizeAndExtractArchive(largeBuffer, limits)).toThrowError(ArchiveSanitizerError);
    try {
      sanitizeAndExtractArchive(largeBuffer, limits);
    } catch (err) {
      expect((err as ArchiveSanitizerError).code).toBe("COMPRESSED_SIZE_EXCEEDED");
    }
  });

  it("enforces maxFiles limit", () => {
    const zipBuffer = buildCustomZip([
      { name: "f1.txt", content: "1" },
      { name: "f2.txt", content: "2" },
      { name: "f3.txt", content: "3" },
    ]);
    const limits: ArchiveLimits = { maxFiles: 2 };

    expect(() => sanitizeAndExtractArchive(zipBuffer, limits)).toThrowError(ArchiveSanitizerError);
    try {
      sanitizeAndExtractArchive(zipBuffer, limits);
    } catch (err) {
      expect((err as ArchiveSanitizerError).code).toBe("TOO_MANY_FILES");
    }
  });

  it("detects and rejects decompression bombs exceeding maxTotalExtractedBytes", () => {
    // Uncompressed content 5KB, limit 2KB
    const zipBuffer = buildCustomZip([{ name: "bomb.txt", content: Buffer.alloc(5000, 0x41), compressionMethod: 8 }]);
    const limits: ArchiveLimits = { maxTotalExtractedBytes: 2000 };

    expect(() => sanitizeAndExtractArchive(zipBuffer, limits)).toThrowError(ArchiveSanitizerError);
    try {
      sanitizeAndExtractArchive(zipBuffer, limits);
    } catch (err) {
      expect((err as ArchiveSanitizerError).code).toBe("DECOMPRESSION_BOMB");
    }
  });

  it("blocks directory traversal attacks with ../ or root / or drive letters", () => {
    const maliciousPaths = [
      "../../etc/passwd",
      "..\\..\\windows\\system32\\calc.exe",
      "/absolute/root/file.txt",
      "\\windows\\path.txt",
      "C:\\payload.exe",
      "subfolder/../../../escape.txt",
    ];

    for (const badPath of maliciousPaths) {
      const zipBuffer = buildCustomZip([{ name: badPath, content: "evil payload" }]);
      expect(() => sanitizeAndExtractArchive(zipBuffer), `Should reject path: ${badPath}`).toThrowError(
        ArchiveSanitizerError,
      );

      try {
        sanitizeAndExtractArchive(zipBuffer);
      } catch (err) {
        expect((err as ArchiveSanitizerError).code).toBe("PATH_TRAVERSAL");
      }
    }
  });

  it("hard rejects archives containing unix symlink entries", () => {
    // S_IFLNK = 0o120000, shifted by 16 bits = 0xa0000000
    const symlinkAttr = 0o120000 << 16;
    const zipBuffer = buildCustomZip([
      { name: "innocent.txt", content: "innocent content" },
      { name: "symlink_link", content: "/etc/shadow", externalAttributes: symlinkAttr },
    ]);

    expect(() => sanitizeAndExtractArchive(zipBuffer)).toThrowError(ArchiveSanitizerError);
    try {
      sanitizeAndExtractArchive(zipBuffer);
    } catch (err) {
      expect((err as ArchiveSanitizerError).code).toBe("SYMLINK_NOT_ALLOWED");
    }
  });

  it("enforces allowedExtensions whitelist when configured", () => {
    const zipBuffer = buildCustomZip([
      { name: "board.gtl", content: "gerber" },
      { name: "malicious.exe", content: "executable payload" },
    ]);
    const limits: ArchiveLimits = { allowedExtensions: [".gtl", ".gbl", ".csv"] };

    expect(() => sanitizeAndExtractArchive(zipBuffer, limits)).toThrowError(ArchiveSanitizerError);
    try {
      sanitizeAndExtractArchive(zipBuffer, limits);
    } catch (err) {
      expect((err as ArchiveSanitizerError).code).toBe("DISALLOWED_EXTENSION");
    }
  });
});
