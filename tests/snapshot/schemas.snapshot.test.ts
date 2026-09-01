import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schemasDir = path.resolve("schemas");

describe("public schema shape snapshots", () => {
  it("keeps the public contract shape of every schemas/*.schema.json stable", async () => {
    const files = (await fs.readdir(schemasDir)).filter((file) => file.endsWith(".schema.json")).sort();
    expect(files.length).toBeGreaterThan(0);

    const shapes: Record<string, unknown> = {};
    for (const file of files) {
      const schema = JSON.parse(await fs.readFile(path.join(schemasDir, file), "utf8"));
      shapes[file] = extractShape(schema, schema.$defs ?? schema.definitions ?? {});
    }

    expect(shapes).toMatchSnapshot();
  });
});

/**
 * Reduces a JSON Schema node to the parts of its shape that matter for backward
 * compatibility: required fields, additionalProperties strictness, enum/const value
 * sets, and property/type structure. Resolving $ref against $defs means a change
 * inside a shared definition shows up everywhere it is used.
 *
 * When this snapshot fails, decide deliberately: is the shape change additive
 * (new optional field, widened enum) or breaking (removed/renamed field, narrowed
 * type, added required field)? See docs/architecture/contract-versioning.md before
 * updating the snapshot -- a breaking change requires a schemaVersion bump.
 */
function extractShape(node: unknown, defs: Record<string, unknown>, seen: readonly string[] = []): unknown {
  if (node === null || typeof node !== "object") {
    return node;
  }
  const record = node as Record<string, unknown>;

  if (typeof record.$ref === "string") {
    if (seen.includes(record.$ref)) {
      return { $ref: record.$ref };
    }
    const defName = record.$ref.replace(/^#\/(\$defs|definitions)\//, "");
    const target = defs[defName];
    if (target === undefined) {
      return { $ref: record.$ref };
    }
    return extractShape(target, defs, [...seen, record.$ref]);
  }

  const shape: Record<string, unknown> = {};
  if (record.type !== undefined) shape.type = record.type;
  if (record.const !== undefined) shape.const = record.const;
  if (Array.isArray(record.enum)) shape.enum = [...record.enum].sort();
  if (Array.isArray(record.required)) shape.required = [...record.required].sort();
  if (record.additionalProperties !== undefined) {
    shape.additionalProperties =
      typeof record.additionalProperties === "object"
        ? extractShape(record.additionalProperties, defs, seen)
        : record.additionalProperties;
  }
  if (record.properties && typeof record.properties === "object") {
    const properties: Record<string, unknown> = {};
    for (const key of Object.keys(record.properties as Record<string, unknown>).sort()) {
      properties[key] = extractShape((record.properties as Record<string, unknown>)[key], defs, seen);
    }
    shape.properties = properties;
  }
  if (record.items !== undefined) shape.items = extractShape(record.items, defs, seen);
  for (const combinator of ["oneOf", "anyOf", "allOf"] as const) {
    const value = record[combinator];
    if (Array.isArray(value)) {
      shape[combinator] = value.map((entry) => extractShape(entry, defs, seen));
    }
  }
  return shape;
}
