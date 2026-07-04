import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import glob from "fast-glob";

const ACTION_USE_PATTERN = /^\s*(?:-\s*)?uses:\s+[^\s#]+@([^\s#]+)(?:\s*#\s*(\S.*))?\s*$/;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;

export function findUnpinnedActionUses(file, markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1, match: line.match(ACTION_USE_PATTERN) }))
    .filter(({ match }) => match && (!RELEASE_SHA_PATTERN.test(match[1]) || !match[2]))
    .map(({ line, lineNumber }) => `${file}:${lineNumber}: ${line}`);
}

export async function main(root = process.cwd()) {
  const markdownFiles = await glob("**/*.md", {
    cwd: root,
    ignore: ["**/node_modules/**", "coverage/**", "dist/**", "site/**", ".stryker-tmp/**"],
    onlyFiles: true,
  });
  const failures = [];
  for (const file of markdownFiles.sort()) {
    failures.push(...findUnpinnedActionUses(file, await readFile(path.join(root, file), "utf8")));
  }
  if (failures.length > 0) {
    throw new Error(`Markdown GitHub Action examples must use SHA pins with source comments:\n${failures.join("\n")}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
