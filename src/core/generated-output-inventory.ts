import fs from "node:fs/promises";
import path from "node:path";

// Exact-file-set checking is limited to first-party generated output directories.
// Matching self-reported bytes does NOT authenticate the reviewed Git commit or exporter.
const MAX_FIRST_PARTY_OUTPUT_ENTRIES = 4096;
const MAX_FIRST_PARTY_OUTPUT_DEPTH = 32;

type FirstPartyScanState = {
  declaredFiles: Set<string>;
  declaredAliases: Set<string>;
  expectedDirectories: Set<string>;
  actualFiles: Set<string>;
  actualAliases: Set<string>;
  reasons: string[];
};

type OutputScanNode = { dir: string; relative: string; depth: number };

function canonicalGeneratedPath(value: string): boolean {
  if (!value || value.includes("\\") || path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (path.posix.normalize(value) !== value) return false;
  return value
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !/[<>:"|?*]/u.test(part) &&
        part.split("").every((character) => (character.codePointAt(0) ?? 0) >= 32) &&
        !/[. ]$/u.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part),
    );
}

function addDeclaredOutput(state: FirstPartyScanState, name: string, manifestName: string): void {
  if (!canonicalGeneratedPath(name) || name === manifestName) {
    state.reasons.push(`Non-canonical generated artifact path or manifest self-reference: ${name}`);
    return;
  }
  const portableKey = name.normalize("NFC").toLowerCase();
  if (state.declaredAliases.has(portableKey)) {
    state.reasons.push(`Cross-platform generated artifact alias: ${name}`);
    return;
  }
  state.declaredAliases.add(portableKey);
  state.declaredFiles.add(name);
  const parts = name.split("/");
  for (let index = 1; index < parts.length; index++) {
    state.expectedDirectories.add(parts.slice(0, index).join("/"));
  }
}

function expectedOutputState(manifestPath: string, artifacts: readonly { path: string }[]): FirstPartyScanState {
  const state: FirstPartyScanState = {
    declaredFiles: new Set<string>(),
    declaredAliases: new Set<string>(),
    expectedDirectories: new Set<string>(),
    actualFiles: new Set<string>(),
    actualAliases: new Set<string>(),
    reasons: [],
  };
  for (const artifact of artifacts) addDeclaredOutput(state, artifact.path, path.basename(manifestPath));
  return state;
}

function recordGeneratedFile(state: FirstPartyScanState, relative: string): void {
  if (!canonicalGeneratedPath(relative)) {
    state.reasons.push(`Non-canonical generated output filename: ${relative}`);
  }
  const portableKey = relative.normalize("NFC").toLowerCase();
  if (state.actualAliases.has(portableKey)) {
    state.reasons.push(`Cross-platform generated output filename alias: ${relative}`);
  }
  state.actualAliases.add(portableKey);
  state.actualFiles.add(relative);
}

async function visitGeneratedDirectory(
  state: FirstPartyScanState,
  current: OutputScanNode,
  absolute: string,
  relative: string,
  root: string,
  pending: OutputScanNode[],
): Promise<void> {
  if (!state.expectedDirectories.has(relative)) {
    state.reasons.push(`Undeclared generated directory: ${relative}`);
  }
  if (current.depth >= MAX_FIRST_PARTY_OUTPUT_DEPTH) {
    throw new Error(`Output tree scan exceeds depth ${MAX_FIRST_PARTY_OUTPUT_DEPTH}.`);
  }
  const realDirectory = await fs.realpath(absolute);
  if (realDirectory !== path.resolve(root, relative)) {
    throw new Error(`Generated directory has a noncanonical real path: ${relative}`);
  }
  pending.push({ dir: absolute, relative, depth: current.depth + 1 });
}

async function inspectGeneratedOutputEntry(
  state: FirstPartyScanState,
  current: OutputScanNode,
  name: string,
  root: string,
  manifestPath: string,
  pending: OutputScanNode[],
): Promise<void> {
  const relative = current.relative ? `${current.relative}/${name}` : name;
  const absolute = path.join(current.dir, name);
  const metadata = await fs.lstat(absolute);
  if (metadata.isSymbolicLink()) {
    state.reasons.push(`Symlink in generated output: ${relative}`);
  } else if (metadata.isDirectory()) {
    await visitGeneratedDirectory(state, current, absolute, relative, root, pending);
  } else if (!metadata.isFile()) {
    state.reasons.push(`Non-file entry in generated output: ${relative}`);
  } else if (absolute !== manifestPath) {
    recordGeneratedFile(state, relative);
  }
}

async function enumerateGeneratedFiles(
  state: FirstPartyScanState,
  directory: string,
  manifestPath: string,
): Promise<void> {
  const root = await fs.realpath(directory);
  const pending: OutputScanNode[] = [{ dir: directory, relative: "", depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;
    const iterator = await fs.opendir(current.dir);
    for await (const entry of iterator) {
      visited++;
      if (visited > MAX_FIRST_PARTY_OUTPUT_ENTRIES) {
        throw new Error(`Output tree scan exceeds ${MAX_FIRST_PARTY_OUTPUT_ENTRIES} entries.`);
      }
      // Serial traversal intentionally bounds I/O and avoids following untrusted links.
      await inspectGeneratedOutputEntry(state, current, entry.name, root, manifestPath, pending);
    }
  }
}

export async function checkFirstPartyOutputSet(
  directory: string,
  manifestPath: string,
  artifacts: readonly { path: string }[],
): Promise<string[]> {
  const state = expectedOutputState(manifestPath, artifacts);
  try {
    await enumerateGeneratedFiles(state, directory, manifestPath);
  } catch (error) {
    state.reasons.push(
      `Generated output enumeration failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const file of [...state.actualFiles].sort((a, b) => a.localeCompare(b))) {
    if (!state.declaredFiles.has(file)) state.reasons.push(`Undeclared generated artifact: ${file}`);
  }
  for (const file of [...state.declaredFiles].sort((a, b) => a.localeCompare(b))) {
    if (!state.actualFiles.has(file)) state.reasons.push(`Declared generated artifact missing from file set: ${file}`);
  }
  return state.reasons;
}

