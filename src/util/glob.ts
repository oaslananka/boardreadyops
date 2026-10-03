import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import { toPosixPath } from "./path.js";

const ignoredDirectoryNames = new Set(["node_modules", ".git", "dist", "coverage"]);

async function collectFiles(root: string, directory: string, output: string[]): Promise<void> {
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
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absolute, output);
      continue;
    }

    // Do not follow filesystem symlinks while discovering review inputs. Besides avoiding cycles,
    // this prevents a repository-controlled link from making a glob escape the requested root.
    if (!entry.isFile()) continue;
    output.push(toPosixPath(path.relative(root, absolute)));
  }
}

export async function globFiles(root: string, patterns: string[]): Promise<string[]> {
  const absoluteRoot = path.resolve(root);
  const relativeFiles: string[] = [];
  await collectFiles(absoluteRoot, absoluteRoot, relativeFiles);

  const matches = picomatch(patterns, { dot: false });
  return relativeFiles
    .filter((relative) => matches(relative))
    .map((relative) => toPosixPath(path.resolve(absoluteRoot, relative)))
    .sort((a, b) => a.localeCompare(b));
}
