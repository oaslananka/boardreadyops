import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFixture } from "./helpers.js";

const fixtureRoot = path.resolve("tests/fixtures/projects");
const fixtureNames = ["package-completeness-missing", "package-completeness-pass"] as const;

async function fixtureFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await fixtureFiles(root, next)));
    else if (entry.isFile()) files.push(next);
  }
  return files.sort();
}

async function snapshotFixture(name: string): Promise<Record<string, string>> {
  const root = path.join(fixtureRoot, name);
  const files = await fixtureFiles(root);
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => {
        const content = await fs.readFile(path.join(root, file));
        return [file, createHash("sha256").update(content).digest("hex")] as const;
      }),
    ),
  );
}

describe("rule fixture isolation", () => {
  it("does not create or modify files in tracked package-completeness fixtures", async () => {
    const before = Object.fromEntries(
      await Promise.all(fixtureNames.map(async (name) => [name, await snapshotFixture(name)] as const)),
    );

    await runFixture("package-completeness-missing");
    await runFixture("package-completeness-pass");

    const after = Object.fromEntries(
      await Promise.all(fixtureNames.map(async (name) => [name, await snapshotFixture(name)] as const)),
    );
    expect(after).toEqual(before);
    expect(Object.keys(after["package-completeness-missing"] ?? {})).not.toContain(
      "package-completeness-missing.kicad_prl",
    );
    expect(Object.keys(after["package-completeness-pass"] ?? {})).not.toContain("package-completeness-pass.kicad_prl");
  }, 60_000);
});
