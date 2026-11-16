/** Browser-only, bounded inspection of an already recorded manufacturing archive.
 * This checks integrity against server-provided evidence; it does NOT independently
 * authenticate GitHub/Sigstore signatures or approve fabrication.
 */

export type PreviewFile = Readonly<{ name: string; bytes: number }>;

export type ManufacturingArchiveContents = Readonly<{
  sourceSha: string;
  sha256: string;
  gerberLayers: readonly PreviewFile[];
  gerberJobs: readonly PreviewFile[];
  drills: readonly PreviewFile[];
  bomHeaders: readonly string[];
  bomRows: readonly (readonly string[])[];
  totalBomRows: number;
  positionRows: number | undefined;
  outputCount: number;
}>;

type ExpectedArchive = Readonly<{
  bytes: number;
  sha256: string;
  sourceSha: string;
}>;

const root = "build/boardreadyops-attested/";
const maxArchiveBytes = 32 * 1024 * 1024;
const maxExpandedBytes = 64 * 1024 * 1024;
const maxTarMembers = 512;
const decoder = new TextDecoder("utf-8", { fatal: true });
const hexDigest = /^[a-f0-9]{64}$/u;
const commitId = /^[a-f0-9]{40}$/u;

function invalid(reason: string): never {
  throw new Error(reason);
}

async function digest(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function inflateGzip(compressed: ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    return invalid("This browser cannot open gzip files. Use a current browser to preview the downloaded archive.");
  }
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      bytes += chunk.value.byteLength;
      if (bytes > maxExpandedBytes) {
        await reader.cancel();
        return invalid("Expanded manufacturing archive is too large for a safe browser preview.");
      }
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("too large for a safe browser preview")) {
      return invalid(error.message);
    }
    return invalid("The downloaded file is not a supported gzip manufacturing archive.");
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}

function tarText(bytes: Uint8Array, start: number, length: number): string {
  const end = bytes.indexOf(0, start);
  return decoder.decode(bytes.subarray(start, end >= start && end < start + length ? end : start + length));
}

function tarSize(bytes: Uint8Array, start: number): number {
  const value = tarText(bytes, start, 12).trim();
  if (!/^[0-7]{1,11}$/u.test(value)) invalid("Malformed manufacturing archive member length.");
  const size = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size) || size > maxExpandedBytes) invalid("Unsafe manufacturing member length.");
  return size;
}

function allowedName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 240 &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !/[\r\n]/u.test(name) &&
    !name.startsWith("/") &&
    name.split("/").every((segment) => segment && segment !== "." && segment !== "..") &&
    (name.startsWith(root) || name === "bundle.sigstore.json" || name === root.slice(0, -1) || name === "build")
  );
}

function tarFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (block.every((value) => value === 0)) return files;
    if (seen.size >= maxTarMembers) invalid("Too many manufacturing archive members.");
    const prefix = tarText(bytes, offset + 345, 155);
    const base = tarText(bytes, offset, 100);
    const rawName = (prefix ? `${prefix}/` : "") + base;
    const type = String.fromCharCode(bytes[offset + 156] ?? 0);
    const name = type === "5" && rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
    const size = tarSize(bytes, offset + 124);
    if (!allowedName(name) || seen.has(name)) invalid("Duplicate or unsafe manufacturing archive path.");
    seen.add(name);
    if (type !== "0" && type !== "\0" && type !== "5") {
      invalid("Unsupported manufacturing archive member type.");
    }
    if (type === "5" && size !== 0) invalid("Invalid manufacturing archive directory.");
    const end = offset + 512 + size;
    if (end > bytes.length) invalid("Truncated manufacturing archive.");
    if (type !== "5") {
      files.set(name, bytes.subarray(offset + 512, end));
    }
    offset = offset + 512 + Math.ceil(size / 512) * 512;
  }
  return invalid("Incomplete manufacturing archive.");
}

type ManifestArtifact = Readonly<{ path: string; kind: string; bytes: number; sha256: string }>;

/** Validate each individual untrusted output before it joins the trusted inventory. */
function manifestArtifact(value: unknown, paths: Set<string>): ManifestArtifact {
  if (!value || typeof value !== "object") invalid("Invalid manufacturing inventory entry.");
  const record = value as Record<string, unknown>;
  const { path, sha256, kind, bytes } = record;
  if (
    typeof path !== "string" ||
    !allowedName(root + path) ||
    path.startsWith("/") ||
    typeof sha256 !== "string" ||
    !hexDigest.test(sha256) ||
    typeof kind !== "string" ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    paths.has(path)
  ) {
    invalid("Unsafe or duplicate manufacturing output inventory entry.");
  }
  paths.add(path);
  return { path, kind, bytes, sha256 };
}

function parseManifest(bytes: Uint8Array, expectedSource: string): ManifestArtifact[] {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    return invalid("The archive has no readable source provenance manifest.");
  }
  if (!value || typeof value !== "object") invalid("Invalid manufacturing manifest.");
  const manifest = value as Record<string, unknown>;
  const git = manifest.git as Record<string, unknown> | undefined;
  if (
    manifest.kind !== "boardreadyops.export-provenance" ||
    manifest.sourceSnapshot !== "stable" ||
    git?.sha !== expectedSource ||
    git.dirty !== false
  )
    invalid("The archive manifest does not match this run's recorded source commit.");
  const artifacts = manifest.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > 256) {
    invalid("Missing or excessive manufacturing artifact inventory.");
  }
  const result: ManifestArtifact[] = [];
  const paths = new Set<string>();
  for (const entry of artifacts) result.push(manifestArtifact(entry, paths));
  if (!result.some((entry) => entry.kind === "gerber") || !result.some((entry) => entry.kind === "drill")) {
    invalid("The archive does not contain the required Gerber and drill evidence.");
  }
  return result;
}

function checkCsvPreviewLimits(row: readonly string[], rows: readonly string[][], cell: string): void {
  if (row.length > 24 || rows.length > 5000 || cell.length > 2048) {
    invalid("BOM exceeds the supported preview limits.");
  }
}

function parseCsv(text: string): { header: string[]; rows: string[][]; total: number } {
  if (text.length > 262_144) invalid("BOM is too large for this browser preview.");
  const data = text.replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < data.length; i++) {
    const character = data.charAt(i);
    if (character === '"') {
      if (quoted && data.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      row.push(cell);
      if (row.some((item) => item.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && data.charAt(i + 1) === "\n") i++;
    } else {
      cell += character;
    }
    checkCsvPreviewLimits(row, rows, cell);
  }
  if (quoted) invalid("Malformed quoted BOM field.");
  row.push(cell);
  if (row.some((item) => item.trim().length > 0)) rows.push(row);
  const header = rows.shift() ?? [];
  if (!header.length || header.length > 24) invalid("Invalid BOM headers.");
  const previewRows = rows
    .slice(0, 20)
    .map((entry) => Array.from({ length: header.length }, (_, column) => entry.at(column) ?? ""));
  return { header, rows: previewRows, total: rows.length };
}

/** No network request or upload. Matching an ingested digest is not a browser-side signature verification. */
export async function inspectDownloadedManufacturingArchive(
  file: Blob,
  expected: ExpectedArchive,
): Promise<ManufacturingArchiveContents> {
  if (!hexDigest.test(expected.sha256) || !commitId.test(expected.sourceSha)) {
    return invalid("The recorded artifact is missing a valid digest or source revision.");
  }
  if (!Number.isSafeInteger(expected.bytes) || file.size !== expected.bytes) {
    return invalid("The selected file size does not match the recorded archive.");
  }
  if (file.size === 0 || file.size > maxArchiveBytes) {
    return invalid("Archive is outside the supported browser preview size; download and inspect it locally.");
  }
  const compressed = await file.arrayBuffer();
  if ((await digest(compressed)) !== expected.sha256) {
    return invalid("SHA-256 mismatch. Select the .tar.gz from this Run's GitHub artifact ZIP.");
  }
  const files = tarFiles(await inflateGzip(compressed));
  const manifestBytes = files.get(`${root}manifest.json`);
  if (!manifestBytes || !files.has("bundle.sigstore.json")) {
    return invalid("Signed archive metadata is incomplete.");
  }
  const entries = parseManifest(manifestBytes, expected.sourceSha);
  if (files.size !== entries.length + 2) {
    return invalid("Manufacturing archive inventory contains unrecorded files.");
  }
  for (const entry of entries) {
    const actual = files.get(root + entry.path);
    if (!actual || actual.byteLength !== entry.bytes) {
      return invalid("A manufacturing output does not match the manifest digest.");
    }
    const independentBytes = new Uint8Array(actual.byteLength);
    independentBytes.set(actual);
    if ((await digest(independentBytes.buffer)) !== entry.sha256) {
      return invalid("A manufacturing output does not match the manifest digest.");
    }
  }
  const selected = (kind: string) =>
    entries.filter((entry) => entry.kind === kind).map((entry) => ({ name: entry.path, bytes: entry.bytes }));
  const gerbers = selected("gerber");
  const bom = entries.find((entry) => entry.kind === "bom" && entry.path.endsWith(".csv"));
  const positions = entries.find((entry) => entry.kind === "cpl" && entry.path.endsWith(".csv"));
  const bomCsv = bom ? parseCsv(decoder.decode(files.get(root + bom.path))) : undefined;
  const positionCsv = positions ? parseCsv(decoder.decode(files.get(root + positions.path))) : undefined;
  return {
    sha256: expected.sha256,
    sourceSha: expected.sourceSha,
    gerberLayers: gerbers.filter((entry) => !entry.name.endsWith(".gbrjob")),
    gerberJobs: gerbers.filter((entry) => entry.name.endsWith(".gbrjob")),
    drills: selected("drill"),
    bomHeaders: bomCsv?.header ?? [],
    bomRows: bomCsv?.rows ?? [],
    totalBomRows: bomCsv?.total ?? 0,
    positionRows: positionCsv?.total,
    outputCount: entries.length,
  };
}
