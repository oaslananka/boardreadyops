import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import { toPosixPath } from "./path.js";

const ignoredDirectoryNames = new Set(["node_modules", ".git", "dist", "coverage"]);

export class SymlinkedGlobInputError extends Error {
  constructor() {
    super("Symlinked source input rejected.");
    this.name = "SymlinkedGlobInputError";
  }
}

async function collectFiles(
  root: string,
  directory: string,
  output: string[],
  strictSourceMatcher?: ((relativePath: string) => boolean) | undefined,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    // fast-glob's previous `dot: false` contract excluded hidden paths. Preserve that behavior
    // while also pruning the build/dependency directories BoardReadyOps has always ignored.
    if (entry.name.startsWith(".")) continue;
    if ((entry.isDirectory() || entry.isSymbolicLink()) && ignoredDirectoryNames.has(entry.name)) continue;

    const absolute = path.join(directory, entry.name);
    const relative = toPosixPath(path.relative(root, absolute));
    // Default globs still skip symlinks. Provenance callers fail closed on
    // matching source-file symlinks AND visible symlinked directories: hidden
    // sources below a linked directory cannot be ruled out without following it.
    if (entry.isSymbolicLink()) {
      if (strictSourceMatcher) {
        if (strictSourceMatcher(relative)) throw new SymlinkedGlobInputError();
        let targetIsDirectory: boolean;
        try {
          targetIsDirectory = (await fs.stat(absolute)).isDirectory();
        } catch {
          // An unresolved/unreadable link could become a source directory between
          // discovery and export. Keep strict provenance fail-closed and typed.
          throw new SymlinkedGlobInputError();
        }
        if (targetIsDirectory) throw new SymlinkedGlobInputError();
      }
      continue;
    }
    if (entry.isDirectory()) {
      await collectFiles(root, absolute, output, strictSourceMatcher);
      continue;
    }

    if (!entry.isFile()) continue;
    output.push(relative);
  }
}

export async function globFiles(
  root: string,
  patterns: string[],
  options: { rejectMatchingSymlinks?: boolean } = {},
): Promise<string[]> {
  const absoluteRoot = path.resolve(root);
  const relativeFiles: string[] = [];
  const matches = picomatch(patterns, { dot: false });
  await collectFiles(absoluteRoot, absoluteRoot, relativeFiles, options.rejectMatchingSymlinks ? matches : undefined);

  return relativeFiles
    .filter((relative) => matches(relative))
    .map((relative) => toPosixPath(path.resolve(absoluteRoot, relative)))
    .sort((a, b) => a.localeCompare(b));
}
