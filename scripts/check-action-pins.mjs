import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import glob from "fast-glob";

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;

function actionUseReference(line) {
  let value = line.trim();
  if (value.startsWith("-")) value = value.slice(1).trimStart();
  if (!value.startsWith("uses:")) return undefined;
  value = value.slice("uses:".length).trimStart();
  const commentIndex = value.indexOf("#");
  const reference = (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
  const comment = commentIndex >= 0 ? value.slice(commentIndex + 1).trim() : "";
  const atIndex = reference.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === reference.length - 1) return undefined;
  return { revision: reference.slice(atIndex + 1), comment };
}

export function findUnpinnedActionUses(file, markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1, use: actionUseReference(line) }))
    .filter(({ use }) => use && (!RELEASE_SHA_PATTERN.test(use.revision) || !use.comment))
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
