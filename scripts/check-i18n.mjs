import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import glob from "fast-glob";
import ts from "typescript";

const defaultCatalogs = [{ file: "src/i18n/en.ts", exportName: "en", source: true }];

export async function findI18nProblems(root = process.cwd(), options = {}) {
  const sourceGlobs = options.sourceGlobs ?? ["src/**/*.ts", "tests/**/*.ts"];
  const targetCatalogs = options.catalogs ?? defaultCatalogs;
  const catalogs = [];
  const problems = [];
  for (const catalog of targetCatalogs) {
    const file = path.join(root, catalog.file);
    const keys = extractCatalogKeys(catalog.file, await readFile(file, "utf8"), catalog.exportName, problems);
    catalogs.push({ ...catalog, keys });
  }

  const sourceCatalog = catalogs.find((catalog) => catalog.source);
  if (!sourceCatalog) {
    return ["src/i18n/en.ts: source catalog not found"];
  }
  for (const catalog of catalogs.filter((entry) => !entry.source)) {
    for (const key of [...sourceCatalog.keys].sort((a, b) => a.localeCompare(b))) {
      if (!catalog.keys.has(key)) {
        problems.push(`${catalog.file}: missing key "${key}"`);
      }
    }
    for (const key of [...catalog.keys].sort((a, b) => a.localeCompare(b))) {
      if (!sourceCatalog.keys.has(key)) {
        problems.push(`${catalog.file}: unexpected key "${key}"`);
      }
    }
  }

  const files = await glob(sourceGlobs, {
    cwd: root,
    ignore: ["dist/**", "coverage/**", "node_modules/**", ".stryker-tmp/**"],
    onlyFiles: true,
  });
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const call of extractLiteralTCalls(file, source)) {
      if (!sourceCatalog.keys.has(call.key)) {
        problems.push(`${file}:${call.line}: unknown i18n key "${call.key}"`);
      }
    }
  }
  return problems;
}

export async function main(root = process.cwd()) {
  const problems = await findI18nProblems(root);
  if (problems.length > 0) {
    const formatted = problems.map((problem) => `- ${problem}`).join("\n");
    throw new Error(`i18n catalog check failed:\n${formatted}`);
  }
}

function extractCatalogKeys(file, source, exportName, problems) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Set();
  visit(tree);
  return keys;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === exportName &&
      node.initializer
    ) {
      const expression = unwrapExpression(node.initializer);
      if (!ts.isObjectLiteralExpression(expression)) {
        problems.push(`${file}: ${exportName} catalog must be an object literal`);
        return;
      }
      for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property)) {
          problems.push(`${file}:${lineOf(tree, property)}: catalog entries must be property assignments`);
          continue;
        }
        const key = propertyName(property.name);
        if (!key) {
          problems.push(`${file}:${lineOf(tree, property)}: catalog key must be a string literal or identifier`);
          continue;
        }
        keys.add(key);
      }
    }
    ts.forEachChild(node, visit);
  }
}

function extractLiteralTCalls(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls = [];
  visit(tree);
  return calls;

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isStringLiteral(firstArg)) {
        calls.push({ key: firstArg.text, line: lineOf(tree, firstArg) });
      }
    }
    ts.forEachChild(node, visit);
  }
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    (typeof ts.isSatisfiesExpression === "function" && ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name) {
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return undefined;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
