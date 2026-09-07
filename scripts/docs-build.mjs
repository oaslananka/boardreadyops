import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateDocsDiscovery } from "./docs-discovery.mjs";
import { runWithMkDocsWarningSuppressed } from "./lib/run-command.mjs";
import { resolveToolchainPaths } from "./toolchain.mjs";

const toolchainPaths = resolveToolchainPaths(process.cwd());
const pythonExecutable = existsSync(toolchainPaths.python) ? toolchainPaths.python : "python";

// Catches a placeholder that was never rendered, which would otherwise ship to the docs site as
// literal `{{ ... }}`. Note this also matches Go template syntax, so a `docker --format` or
// `kubectl -o go-template` example has to be written without one -- the plain command output is
// usually what the reader wants anyway.
const templateTokenPattern = /{{[#/^]?[A-Za-z0-9_.-]+}}/g;
const markdownFiles = [];
await collect("docs");
for (const file of markdownFiles) {
  if (file.includes("templates")) continue;
  const text = await readFile(file, "utf8");
  const tokens = [...new Set(text.match(templateTokenPattern) ?? [])];
  if (tokens.length > 0) {
    // Naming the tokens turns this from "something in this file" into a one-line fix; the file
    // can be hundreds of lines and the pattern is not obvious from the message alone.
    throw new Error(`unresolved template token in ${file}: ${tokens.join(", ")}`);
  }
}

const requestedSiteDir = parseSiteDir(process.argv.slice(2));
const temporarySiteDir = requestedSiteDir ? null : await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mkdocs-"));
const siteDir = requestedSiteDir ? path.resolve(requestedSiteDir) : temporarySiteDir;

try {
  await runWithMkDocsWarningSuppressed(pythonExecutable, [
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
