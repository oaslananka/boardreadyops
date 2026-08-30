import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateDocsDiscovery } from "./docs-discovery.mjs";
import { runWithMkDocsWarningSuppressed } from "./lib/run-command.mjs";

const markdownFiles = [];
await collect("docs");
for (const file of markdownFiles) {
  const text = await readFile(file, "utf8");
  if (/{{[#/^]?[A-Za-z0-9_.-]+}}/.test(text) && !file.includes("templates")) {
    throw new Error(`unresolved template token in ${file}`);
  }
}

const requestedSiteDir = parseSiteDir(process.argv.slice(2));
const temporarySiteDir = requestedSiteDir ? null : await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mkdocs-"));
const siteDir = requestedSiteDir ? path.resolve(requestedSiteDir) : temporarySiteDir;

try {
  await runWithMkDocsWarningSuppressed("python", [
    "-m",
    "mkdocs",
    "build",
    "--strict",
    "--quiet",
    "--site-dir",
    siteDir,
  ]);
  await generateDocsDiscovery({ repositoryRoot: process.cwd(), siteDir });
} finally {
  if (temporarySiteDir) await rm(temporarySiteDir, { recursive: true, force: true });
}

function parseSiteDir(args) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== "--site-dir" || !args[1]) {
    throw new Error("usage: node scripts/docs-build.mjs [--site-dir <path>]");
  }
  return args[1];
}

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full);
    } else if (entry.name.endsWith(".md")) {
      markdownFiles.push(full);
    }
  }
}
