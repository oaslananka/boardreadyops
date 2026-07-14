import { readFile } from "node:fs/promises";
import path from "node:path";
import { listFiles } from "./lib/files.mjs";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const files = (await listFiles(sourceRoot)).filter((file) => file.endsWith(".ts"));
const graph = new Map(files.map((file) => [relative(file), []]));
const violations = [];

const allowedLayers = new Map([
  ["action", new Set(["action", "core", "report", "util"])],
  ["bom", new Set(["bom", "util"])],
  ["cli", new Set(["cli", "core", "generated", "i18n", "kicad", "release", "report", "runner", "util", "vendor"])],
  ["core", new Set(["core", "generated", "notifiers", "rules", "util", "vendor"])],
  ["generated", new Set(["generated"])],
  ["firmware", new Set(["firmware", "util"])],
  ["i18n", new Set(["i18n"])],
  ["kicad", new Set(["bom", "kicad", "util"])],
  ["notifiers", new Set(["core", "notifiers", "util"])],
  ["pinmap", new Set(["bom", "pinmap", "util"])],
  ["release", new Set(["core", "generated", "release", "report", "util"])],
  ["report", new Set(["core", "i18n", "report", "util"])],
  ["runner", new Set(["runner"])],
  ["rules", new Set(["bom", "core", "firmware", "kicad", "pinmap", "rules", "util", "vendor"])],
  ["types", new Set(["types"])],
  ["util", new Set(["util"])],
  ["vendor", new Set(["vendor"])],
]);

for (const file of files) {
  const fileKey = relative(file);
  const imports = findImports(await readFile(file, "utf8"));
  for (const specifier of imports) {
    const resolved = resolveSourceImport(file, specifier);
    if (!resolved) {
      continue;
    }
    const targetKey = relative(resolved);
    graph.get(fileKey)?.push(targetKey);
    checkLayer(fileKey, targetKey);
  }
}

for (const cycle of findCycles(graph)) {
  violations.push(`circular dependency: ${cycle.join(" -> ")}`);
}

if (files.some((file) => path.basename(file) === "index.ts" && path.dirname(file) === sourceRoot)) {
  violations.push("src/index.ts is not part of the public surface for v1");
}

if (violations.length > 0) {
  throw new Error(`structure verification failed:\n${violations.map((entry) => `- ${entry}`).join("\n")}`);
}

function findImports(source) {
  const imports = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g,
    /export\s+(?:type\s+)?[^'"]+?\s+from\s+["']([^"']+)["']/g,
    /import\(["']([^"']+)["']\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
  }
  return imports;
}

function resolveSourceImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  return existingSource(base);
}

function existingSource(file) {
  if (files.includes(file)) {
    return file;
  }
  const indexFile = path.join(file, "index.ts");
  return files.includes(indexFile) ? indexFile : undefined;
}

function checkLayer(from, to) {
  const fromLayer = layerOf(from);
  const toLayer = layerOf(to);
  const allowed = allowedLayers.get(fromLayer);
  if (!allowed?.has(toLayer)) {
    violations.push(`layer violation: ${from} imports ${to}`);
  }
}

function layerOf(file) {
  const [src, segment] = file.split(/[\\/]/);
  if (src !== "src" || !segment) {
    throw new Error(`unexpected source path: ${file}`);
  }
  return segment;
}

function findCycles(inputGraph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      cycles.push(stack.slice(stack.indexOf(node)).concat(node));
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of inputGraph.get(node) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of inputGraph.keys()) {
    visit(node);
  }
  return cycles;
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}
