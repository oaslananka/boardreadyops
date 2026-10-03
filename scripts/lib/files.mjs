import { access, readdir } from "node:fs/promises";
import path from "node:path";
export async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

export async function firstAccessiblePath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
