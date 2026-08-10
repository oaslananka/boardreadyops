import fs from "node:fs/promises";
import { parseJsonValue } from "../../util/json.js";
import { type KicadVariant, parseVariants } from "../variants.js";

export async function readDesignFile(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

export interface KicadProjectMetadata {
  variants: KicadVariant[];
  jobsets: string[];
  differentialPairPrefixes: string[];
}

export function parseProjectMetadata(projectFileContent: string): KicadProjectMetadata {
  const variants = parseVariants(projectFileContent);
  const parsed = parseJsonValue(projectFileContent);
  if (parsed && typeof parsed === "object") {
    return {
      variants,
      jobsets: collectStrings(parsed, ["jobset", "jobsets", "jobs_file", "jobset_file"]),
      differentialPairPrefixes: collectStrings(parsed, [
        "diff_pair_prefix",
        "differential_pair_prefix",
        "diff_pair_prefixes",
      ]),
    };
  }
  return {
    variants,
    jobsets: [...projectFileContent.matchAll(/\(jobset\s+"([^"]+)"/g)].map((match) => match[1] ?? ""),
    differentialPairPrefixes: [...projectFileContent.matchAll(/\(diff(?:erential)?_pair_prefix\s+"([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushArrayChildren(stack: unknown[], entries: unknown[]): void {
  for (const entry of entries) {
    if (typeof entry !== "string") stack.push(entry);
  }
}

function collectConfiguredValue(found: Set<string>, value: unknown): void {
  if (typeof value === "string") {
    found.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") found.add(entry);
    }
  }
}

function inspectObject(
  item: Record<string, unknown>,
  configuredKeys: Set<string>,
  found: Set<string>,
  stack: unknown[],
): void {
  for (const [key, value] of Object.entries(item)) {
    if (configuredKeys.has(key)) collectConfiguredValue(found, value);
    stack.push(value);
  }
}

function collectStrings(input: unknown, keys: string[]): string[] {
  const found = new Set<string>();
  const configuredKeys = new Set(keys);
  const stack = [input];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      pushArrayChildren(stack, item);
      continue;
    }
    if (!isRecord(item)) continue;
    inspectObject(item, configuredKeys, found, stack);
  }
  return [...found];
}
