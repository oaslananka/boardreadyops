import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globFiles } from "../../../src/util/glob.js";

const roots: string[] = [];

async function fixture(files: readonly string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-glob-"));
  roots.push(root);
  for (const file of files) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file, "utf8");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("globFiles", () => {
  it("supports recursive wildcards and multiple patterns", async () => {
    const root = await fixture(["board.kicad_pro", "fab/top.gbr", "fab/drill/board.drl", "docs/readme.md"]);

    const files = await globFiles(root, ["**/*.gbr", "**/*.drl", "**/*.kicad_pro"]);
    expect(files.map((file) => path.relative(root, file).split(path.sep).join("/"))).toEqual([
      "board.kicad_pro",
      "fab/drill/board.drl",
      "fab/top.gbr",
    ]);
  });

  it("preserves brace and extglob pattern support", async () => {
    const root = await fixture(["fab/top.gbr", "fab/bottom.gbl", "fab/board.drl", "fab/notes.txt"]);

    const files = await globFiles(root, ["**/*.{gbr,gbl}", "**/board.@(drl|xln)"]);
    expect(files.map((file) => path.basename(file))).toEqual(["board.drl", "bottom.gbl", "top.gbr"]);
  });

  it("excludes hidden, dependency, build, and coverage trees", async () => {
    const root = await fixture([
      "visible/report.json",
      ".hidden/report.json",
      "node_modules/pkg/report.json",
      "dist/report.json",
      "coverage/report.json",
      ".git/report.json",
    ]);

    const files = await globFiles(root, ["**/*.json"]);
    expect(files.map((file) => path.relative(root, file).split(path.sep).join("/"))).toEqual(["visible/report.json"]);
  });

  it("returns no matches when the requested root does not exist", async () => {
    const root = path.join(os.tmpdir(), `boardreadyops-glob-missing-${Date.now()}`);
    await expect(globFiles(root, ["**/*.kicad_pro"])).resolves.toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "optionally rejects matching source symlinks without changing default glob behavior",
    async () => {
      const root = await fixture(["board.kicad_pcb"]);
      await fs.symlink("board.kicad_pcb", path.join(root, "copy.kicad_pcb"));
      const listed = await globFiles(root, ["**/*.kicad_pcb"]);
      expect(listed.map((file) => path.basename(file))).toEqual(["board.kicad_pcb"]);
      await expect(globFiles(root, ["**/*.kicad_pcb"], { rejectMatchingSymlinks: true })).rejects.toThrow(
        "Symlinked source input rejected",
      );
      await expect(globFiles(root, ["**/*.gbr"], { rejectMatchingSymlinks: true })).resolves.toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects hidden KiCad sources under symlinked directories only in strict mode",
    async () => {
      const root = await fixture(["board.kicad_pcb"]);
      const external = await fixture(["unreviewed.kicad_pcb"]);
      await fs.symlink(external, path.join(root, "linked-sources"), "dir");
      await fs.symlink(external, path.join(root, "node_modules"), "dir");

      const defaultFiles = await globFiles(root, ["**/*.kicad_pcb"]);
      expect(defaultFiles.map((file) => path.basename(file))).toEqual(["board.kicad_pcb"]);
      await expect(globFiles(root, ["**/*.kicad_pcb"], { rejectMatchingSymlinks: true })).rejects.toThrow(
        "Symlinked source input rejected",
      );
      // Dependency/build paths are ignored irrespective of whether they are real directories or symlinks.
      await fs.rm(path.join(root, "linked-sources"));
      await expect(globFiles(root, ["**/*.kicad_pcb"], { rejectMatchingSymlinks: true })).resolves.toHaveLength(1);
    },
  );

  it.skipIf(process.platform === "win32")(
    "turns broken nonmatching links into a typed strict-source failure rather than raw ENOENT",
    async () => {
      const root = await fixture(["board.kicad_pcb", "notes.txt"]);
      await fs.symlink("missing-inputs", path.join(root, "stale-design-link"), "dir");
      await fs.symlink("notes.txt", path.join(root, "notes-alias.txt"));
      await expect(globFiles(root, ["**/*.kicad_pcb"])).resolves.toHaveLength(1);
      await expect(globFiles(root, ["**/*.kicad_pcb"], { rejectMatchingSymlinks: true })).rejects.toThrow(
        "Symlinked source input rejected",
      );
      await fs.rm(path.join(root, "stale-design-link"));
      await expect(globFiles(root, ["**/*.kicad_pcb"], { rejectMatchingSymlinks: true })).resolves.toHaveLength(1);
    },
  );

  it("does not follow symlinks outside the requested root", async () => {
    const root = await fixture(["inside.txt"]);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-glob-outside-"));
    roots.push(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await fs.symlink(outside, path.join(root, "linked"), "dir");

    const files = await globFiles(root, ["**/*.txt"]);
    expect(files.map((file) => path.basename(file))).toEqual(["inside.txt"]);
  });
});
