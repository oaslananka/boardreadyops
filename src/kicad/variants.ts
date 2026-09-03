import { HostileInputError } from "../util/errors.js";
import { MAX_KICAD_TEXT_BYTES } from "./project-model.js";
import { extractBlocks, sexprStringAfter } from "./sexpr.js";

export interface KicadVariant {
  name: string;
  dnpOverrides: string[];
}

interface RawVariant {
  name?: unknown;
  dnpOverrides?: unknown;
  dnp_overrides?: unknown;
  dnp?: unknown;
}

export function parseVariants(projectFileContent: string): KicadVariant[] {
  const byteLength = Buffer.byteLength(projectFileContent, "utf8");
  if (byteLength > MAX_KICAD_TEXT_BYTES) {
    throw new HostileInputError(
      `KiCad project/variant input exceeds maximum size of ${MAX_KICAD_TEXT_BYTES} bytes (received ${byteLength} bytes)`,
    );
  }
  const parsed = parseJson(projectFileContent);
  if (parsed) {
    return collectJsonVariants(parsed);
  }
  return collectSexprVariants(projectFileContent);
}

export function activeVariantDnpRefs(variant: KicadVariant, baseComponents: string[]): string[] {
  const known = new Set(baseComponents.map((reference) => reference.toUpperCase()));
  return variant.dnpOverrides.filter((reference) => known.has(reference.toUpperCase()));
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function collectJsonVariants(input: unknown): KicadVariant[] {
  const variants: KicadVariant[] = [];
  const stack = [input];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      if (item.every((entry) => isRawVariant(entry))) {
        variants.push(...item.map(normalizeRawVariant).filter((variant): variant is KicadVariant => Boolean(variant)));
      }
      stack.push(...item);
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const direct = record.variants ?? record.variant_definitions;
      if (Array.isArray(direct)) {
        variants.push(
          ...direct.map(normalizeRawVariant).filter((variant): variant is KicadVariant => Boolean(variant)),
        );
      }
      stack.push(...Object.values(record));
    }
  }
  return uniqueVariants(variants);
}

function collectSexprVariants(text: string): KicadVariant[] {
  const variants: KicadVariant[] = [];
  for (const body of extractBlocks(text, "variant")) {
    const name = sexprStringAfter(body, "variant");
    if (!name) {
      continue;
    }
    variants.push({
      name,
      dnpOverrides: [...body.matchAll(/\(dnp(?:_override)?\s+"([^"]+)"/g)]
        .map((entry) => entry[1] ?? "")
        .filter(Boolean),
    });
  }
  return uniqueVariants(variants.filter((variant) => variant.name !== ""));
}

function isRawVariant(input: unknown): input is RawVariant {
  return Boolean(input && typeof input === "object" && "name" in input);
}

function normalizeRawVariant(input: unknown): KicadVariant | undefined {
  if (!isRawVariant(input) || typeof input.name !== "string" || input.name.trim() === "") {
    return undefined;
  }
  const dnp = input.dnpOverrides ?? input.dnp_overrides ?? input.dnp;
  return {
    name: input.name.trim(),
    dnpOverrides: Array.isArray(dnp) ? dnp.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

function uniqueVariants(variants: KicadVariant[]): KicadVariant[] {
  const seen = new Set<string>();
  const output: KicadVariant[] = [];
  for (const variant of variants) {
    if (seen.has(variant.name)) {
      continue;
    }
    seen.add(variant.name);
    output.push(variant);
  }
  return output;
}
