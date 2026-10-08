import fs from "node:fs/promises";
import path from "node:path";

const MAX_OUTPUT_ENTRIES = 4096;
const MAX_OUTPUT_DEPTH = 32;

type ScanNode = { absolute: string; relative: string; depth: number };
type ScanResult = { files: Set<string>; aliases: Set<string>; reasons: string[] };

export function canonicalGeneratedPath(value: string): boolean {
  if (!value || value.includes("\\") || path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (path.posix.normalize(value) !== value) return false;
  return value
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !/[<>:"|?*]/u.test(segment) &&
        [...segment].every((character) => (character.codePointAt(0) ?? 0) >= 32) &&
        !/[. ]$/u.test(segment) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment),
    );
}

function recordOutputFile(result: ScanResult, relative: string): void {
  if (!canonicalGeneratedPath(relative)) result.reasons.push(`Non-canonical generated output filename: ${relative}`);
  const alias = relative.normalize("NFC").toLowerCase();
  if (result.aliases.has(alias)) result.reasons.push(`Cross-platform generated output filename alias: ${relative}`);
  result.aliases.add(alias);
  result.files.add(relative);
}

async function recordOutputEntry(
  current: ScanNode,
  name: string,
  root: string,
  manifestPath: string,
  expectedDirectories: ReadonlySet<string>,
  pending: ScanNode[],
  result: ScanResult,
): Promise<void> {
  const relative = current.relative ? `${current.relative}/${name}` : name;
  const absolute = path.join(current.absolute, name);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) {
    result.reasons.push(`Symlink in generated output: ${relative}`);
  } else if (stat.isDirectory()) {
    if (!expectedDirectories.has(relative)) result.reasons.push(`Undeclared generated directory: ${relative}`);
    if (current.depth >= MAX_OUTPUT_DEPTH) throw new Error(`Output tree scan exceeds depth ${MAX_OUTPUT_DEPTH}.`);
    if ((await fs.realpath(absolute)) !== path.resolve(root, relative)) {
      throw new Error(`Generated directory has a noncanonical real path: ${relative}`);
    }
    pending.push({ absolute, relative, depth: current.depth + 1 });
  } else if (!stat.isFile()) {
    result.reasons.push(`Non-file entry in generated output: ${relative}`);
  } else if (absolute !== manifestPath) {
    recordOutputFile(result, relative);
  }
}

export async function scanGeneratedOutputTree(
  directory: string,
  manifestPath: string,
  expectedDirectories: ReadonlySet<string>,
): Promise<{ files: ReadonlySet<string>; reasons: string[] }> {
  const root = await fs.realpath(directory);
  const result: ScanResult = { files: new Set(), aliases: new Set(), reasons: [] };
  const pending: ScanNode[] = [{ absolute: directory, relative: "", depth: 0 }];
  let scannedEntries = 0;
  while (pending.length) {
    const current = pending.shift();
    if (!current) break;
    const handle = await fs.opendir(current.absolute);
    for await (const entry of handle) {
      if (++scannedEntries > MAX_OUTPUT_ENTRIES)
        throw new Error(`Output tree scan exceeds ${MAX_OUTPUT_ENTRIES} entries.`);
      // Bound I/O and never follow symbolic links within the enumerated output tree.
      await recordOutputEntry(current, entry.name, root, manifestPath, expectedDirectories, pending, result);
    }
  }
  return result;
}
