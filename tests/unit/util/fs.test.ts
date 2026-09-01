import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTextFile } from "../../../src/util/fs.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function withTempFile(bytes: Buffer): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-readtextfile-"));
  roots.push(root);
  const file = path.join(root, "input.txt");
  await writeFile(file, bytes);
  return file;
}

describe("readTextFile", () => {
  it("returns file content unchanged when there is no BOM", async () => {
    const file = await withTempFile(Buffer.from("Reference,Value\nR1,10k\n", "utf8"));
    expect(await readTextFile(file)).toBe("Reference,Value\nR1,10k\n");
  });

  it("strips a leading UTF-8 BOM so the first header cell is not corrupted", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const file = await withTempFile(Buffer.concat([bom, Buffer.from("Reference,Value\nR1,10k\n", "utf8")]));
    const text = await readTextFile(file);
    expect(text).toBe("Reference,Value\nR1,10k\n");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("does not strip a U+FEFF that is not the first character", async () => {
    const file = await withTempFile(Buffer.from("a﻿b", "utf8"));
    expect(await readTextFile(file)).toBe("a﻿b");
  });
});
