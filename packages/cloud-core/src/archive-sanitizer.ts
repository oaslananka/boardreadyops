import { inflateRawSync } from "node:zlib";

export type ArchiveSanitizerErrorCode =
  | "COMPRESSED_SIZE_EXCEEDED"
  | "TOO_MANY_FILES"
  | "DECOMPRESSION_BOMB"
  | "PATH_TRAVERSAL"
  | "SYMLINK_NOT_ALLOWED"
  | "DISALLOWED_EXTENSION"
  | "CORRUPTED_ARCHIVE";

export class ArchiveSanitizerError extends Error {
  readonly code: ArchiveSanitizerErrorCode;

  constructor(code: ArchiveSanitizerErrorCode, message: string) {
    super(message);
    this.name = "ArchiveSanitizerError";
    this.code = code;
  }
}

export interface ArchiveLimits {
  /** Maximum compressed size of the archive in bytes (default 50MB) */
  maxCompressedSizeBytes?: number;
  /** Maximum number of file entries permitted inside archive (default 500) */
  maxFiles?: number;
  /** Maximum total uncompressed size across all entries in bytes (default 250MB) */
  maxTotalExtractedBytes?: number;
  /** Maximum size for any single uncompressed entry in bytes (default 50MB) */
  maxSingleFileBytes?: number;
  /** Optional array of allowed file extensions (e.g. ['.gtl', '.gbl', '.csv']) */
  allowedExtensions?: string[];
}

export interface ExtractedArchiveFile {
  path: string;
  data: Buffer;
  size: number;
}

export interface SanitizeArchiveResult {
  files: ExtractedArchiveFile[];
  totalBytes: number;
  fileCount: number;
}

const DEFAULT_MAX_COMPRESSED_SIZE = 50 * 1024 * 1024; // 50 MB
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_TOTAL_EXTRACTED_BYTES = 250 * 1024 * 1024; // 250 MB
const DEFAULT_MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

function locateEndOfCentralDirectory(
  buffer: Buffer,
  maxFiles: number,
): { totalEntries: number; centralDirOffset: number } {
  if (buffer.length < 22) {
    throw new ArchiveSanitizerError(
      "CORRUPTED_ARCHIVE",
      "Archive is too small to contain valid End of Central Directory record",
    );
  }

  // Find End of Central Directory (EOCD) signature (0x06054b50), searching backwards.
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new ArchiveSanitizerError("CORRUPTED_ARCHIVE", "End of Central Directory record not found in archive");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxFiles) {
    throw new ArchiveSanitizerError(
      "TOO_MANY_FILES",
      `Archive contains ${totalEntries} entries, exceeding maximum allowed of ${maxFiles}`,
    );
  }
  if (centralDirOffset + centralDirSize > buffer.length) {
    throw new ArchiveSanitizerError("CORRUPTED_ARCHIVE", "Invalid central directory offset or size in archive header");
  }

  return { totalEntries, centralDirOffset };
}

interface CentralDirectoryEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttrs: number;
  localHeaderOffset: number;
  rawName: string;
  nextOffset: number;
}

function parseCentralDirectoryEntry(buffer: Buffer, cdOffset: number, entryIdx: number): CentralDirectoryEntry {
  if (cdOffset + 46 > buffer.length) {
    throw new ArchiveSanitizerError("CORRUPTED_ARCHIVE", "Unexpected end of central directory");
  }
  if (buffer.readUInt32LE(cdOffset) !== 0x02014b50) {
    throw new ArchiveSanitizerError(
      "CORRUPTED_ARCHIVE",
      `Invalid central directory header signature at entry ${entryIdx}`,
    );
  }

  const method = buffer.readUInt16LE(cdOffset + 10);
  const compressedSize = buffer.readUInt32LE(cdOffset + 20);
  const uncompressedSize = buffer.readUInt32LE(cdOffset + 24);
  const nameLen = buffer.readUInt16LE(cdOffset + 28);
  const extraLen = buffer.readUInt16LE(cdOffset + 30);
  const commentLen = buffer.readUInt16LE(cdOffset + 32);
  const externalAttrs = buffer.readUInt32LE(cdOffset + 38);
  const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);

  if (cdOffset + 46 + nameLen > buffer.length) {
    throw new ArchiveSanitizerError("CORRUPTED_ARCHIVE", "Entry name truncated in central directory");
  }
  const rawName = buffer.toString("utf8", cdOffset + 46, cdOffset + 46 + nameLen);

  return {
    method,
    compressedSize,
    uncompressedSize,
    externalAttrs,
    localHeaderOffset,
    rawName,
    nextOffset: cdOffset + 46 + nameLen + extraLen + commentLen,
  };
}

function assertNotSymlink(externalAttrs: number): void {
  // Unix symlink detection (S_IFLNK = 0o120000) in high 16 bits of external attributes.
  const unixMode = (externalAttrs >>> 16) & 0xffff;
  if ((unixMode & 0o170000) === 0o120000) {
    throw new ArchiveSanitizerError(
      "SYMLINK_NOT_ALLOWED",
      "Archive contains symbolic links or reparse points, which are rejected for security",
    );
  }
}

function resolveSafeEntryPath(rawName: string): string {
  if (rawName.includes("\0")) {
    throw new ArchiveSanitizerError("PATH_TRAVERSAL", "Path contains null bytes");
  }

  const normalizedName = rawName.replaceAll("\\", "/");
  if (normalizedName.startsWith("/") || /^[a-zA-Z]:/u.test(rawName) || normalizedName.split("/").includes("..")) {
    throw new ArchiveSanitizerError("PATH_TRAVERSAL", `Path traversal attempt detected in entry: ${rawName}`);
  }

  return normalizedName;
}

function assertAllowedExtension(normalizedName: string, allowedExtSet: Set<string> | null): void {
  if (!allowedExtSet) return;
  const ext = normalizedName.match(/\.[^./\\]+$/)?.[0]?.toLowerCase() ?? "";
  if (!allowedExtSet.has(ext)) {
    throw new ArchiveSanitizerError("DISALLOWED_EXTENSION", `File extension "${ext}" is not permitted in upload`);
  }
}

function assertWithinBombLimits(
  normalizedName: string,
  uncompressedSize: number,
  compressedSize: number,
  maxSingleFile: number,
  maxTotalExtracted: number,
  totalExtractedSoFar: number,
): void {
  if (uncompressedSize > maxSingleFile) {
    throw new ArchiveSanitizerError(
      "DECOMPRESSION_BOMB",
      `Entry ${normalizedName} uncompressed size ${uncompressedSize} exceeds single file limit ${maxSingleFile}`,
    );
  }
  if (totalExtractedSoFar + uncompressedSize > maxTotalExtracted) {
    throw new ArchiveSanitizerError(
      "DECOMPRESSION_BOMB",
      `Total extracted bytes exceed maximum threshold of ${maxTotalExtracted}`,
    );
  }
  if (uncompressedSize > 1024 * 1024 && uncompressedSize / Math.max(compressedSize, 1) > 100) {
    throw new ArchiveSanitizerError(
      "DECOMPRESSION_BOMB",
      `Suspicious compression ratio detected in entry ${normalizedName}`,
    );
  }
}

function extractEntryBytes(buffer: Buffer, entry: CentralDirectoryEntry, normalizedName: string): Buffer {
  const { localHeaderOffset, compressedSize, uncompressedSize, method } = entry;

  if (localHeaderOffset + 30 > buffer.length) {
    throw new ArchiveSanitizerError("CORRUPTED_ARCHIVE", "Local file header offset out of bounds");
  }
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new ArchiveSanitizerError(
      "CORRUPTED_ARCHIVE",
      `Invalid local file header signature at offset ${localHeaderOffset}`,
    );
  }

  const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
  const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
  if (dataOffset + compressedSize > buffer.length) {
    throw new ArchiveSanitizerError("CORRUPTED_ARCHIVE", "Entry data truncated in archive");
  }

  const compressedSlice = buffer.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) return Buffer.from(compressedSlice);
  if (method === 8) {
    try {
      return inflateRawSync(compressedSlice, { maxOutputLength: uncompressedSize + 1024 });
    } catch (err) {
      throw new ArchiveSanitizerError(
        "CORRUPTED_ARCHIVE",
        `Failed to decompress entry ${normalizedName}: ${(err as Error).message}`,
      );
    }
  }
  throw new ArchiveSanitizerError(
    "CORRUPTED_ARCHIVE",
    `Unsupported compression method ${method} in entry ${normalizedName}`,
  );
}

interface EntryLimits {
  maxSingleFile: number;
  maxTotalExtracted: number;
  allowedExtSet: Set<string> | null;
}

function processCentralDirectoryEntry(
  buffer: Buffer,
  cdOffset: number,
  entryIdx: number,
  limits: EntryLimits,
  totalExtractedSoFar: number,
): { file: ExtractedArchiveFile | null; nextOffset: number; extractedBytes: number } {
  const entry = parseCentralDirectoryEntry(buffer, cdOffset, entryIdx);
  assertNotSymlink(entry.externalAttrs);
  const normalizedName = resolveSafeEntryPath(entry.rawName);

  if (normalizedName.endsWith("/")) {
    return { file: null, nextOffset: entry.nextOffset, extractedBytes: 0 };
  }

  assertAllowedExtension(normalizedName, limits.allowedExtSet);
  assertWithinBombLimits(
    normalizedName,
    entry.uncompressedSize,
    entry.compressedSize,
    limits.maxSingleFile,
    limits.maxTotalExtracted,
    totalExtractedSoFar,
  );

  const extractedData = extractEntryBytes(buffer, entry, normalizedName);
  if (totalExtractedSoFar + extractedData.length > limits.maxTotalExtracted) {
    throw new ArchiveSanitizerError(
      "DECOMPRESSION_BOMB",
      `Total extracted bytes exceeded limit of ${limits.maxTotalExtracted}`,
    );
  }

  return {
    file: { path: normalizedName, data: extractedData, size: extractedData.length },
    nextOffset: entry.nextOffset,
    extractedBytes: extractedData.length,
  };
}

/**
 * Validates, sanitizes, and safely extracts zip archives into memory buffers.
 * Enforces compression ratio ceilings, zip bomb limits, symlink detection,
 * and path traversal prevention.
 */
export function sanitizeAndExtractArchive(buffer: Buffer, limits: ArchiveLimits = {}): SanitizeArchiveResult {
  const maxCompressedSize = limits.maxCompressedSizeBytes ?? DEFAULT_MAX_COMPRESSED_SIZE;
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalExtracted = limits.maxTotalExtractedBytes ?? DEFAULT_MAX_TOTAL_EXTRACTED_BYTES;
  const maxSingleFile = limits.maxSingleFileBytes ?? DEFAULT_MAX_SINGLE_FILE_BYTES;

  if (buffer.length > maxCompressedSize) {
    throw new ArchiveSanitizerError(
      "COMPRESSED_SIZE_EXCEEDED",
      `Archive size ${buffer.length} bytes exceeds maximum allowed ${maxCompressedSize} bytes`,
    );
  }

  const { totalEntries, centralDirOffset } = locateEndOfCentralDirectory(buffer, maxFiles);
  const allowedExtSet = limits.allowedExtensions
    ? new Set(limits.allowedExtensions.map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`)))
    : null;
  const entryLimits: EntryLimits = { maxSingleFile, maxTotalExtracted, allowedExtSet };

  let cdOffset = centralDirOffset;
  let totalExtractedBytes = 0;
  const files: ExtractedArchiveFile[] = [];

  for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
    const result = processCentralDirectoryEntry(buffer, cdOffset, entryIdx, entryLimits, totalExtractedBytes);
    if (result.file) {
      files.push(result.file);
      totalExtractedBytes += result.extractedBytes;
    }
    cdOffset = result.nextOffset;
  }

  return {
    files,
    totalBytes: totalExtractedBytes,
    fileCount: files.length,
  };
}
