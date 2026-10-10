import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type GenerateRunner, runGenerate } from "../../../src/release/generate.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function fixture(): Promise<{ root: string; boardFile: string; outputDir: string; sha: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brops-reviewed-export-"));
  roots.push(root);
  const boardFile = path.join(root, "board.kicad_pcb");
  const outputDir = path.join(root, "build", "generated");
  await fs.writeFile(boardFile, "(kicad_pcb reviewed)\n");
  await fs.writeFile(path.join(root, ".gitignore"), "build/\n");
  git(root, "init", "--quiet");
  git(root, "add", "--", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture");
  return { root, boardFile, outputDir, sha: git(root, "rev-parse", "HEAD") };
}

const manufacturing = { steps: [{ kind: "gerbers" as const }, { kind: "drill" as const }] };

function runner(): GenerateRunner {
  return async (args) => {
    const output = args[args.indexOf("--output") + 1];
    if (!output) throw new Error("Missing output path");
    await fs.mkdir(output, { recursive: true });
    const filename = args[2] === "drill" ? "board.drl" : "board.gtl";
    await fs.writeFile(path.join(output, filename), `actual-${filename}`);
    return { code: 0, timedOut: false, stdout: "", stderr: "" };
  };
}

describe("opt-in reviewed manufacturing source preflight (NOT cryptographic attestation)", () => {
  it("checks exact Git SHA, clean root, Gerber/drill outputs and local inventory on an untouched source", async () => {
    const f = await fixture();
    const result = await runGenerate(manufacturing, {
      ...f,
      gitRoot: f.root,
      reviewedSourceSha: f.sha,
      runner: runner(),
    });
    expect(result.failures).toBe(0);
    expect(result.artifacts.map((a) => a.path)).toEqual(["drill/board.drl", "gerbers/board.gtl"]);
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")) as {
      git: { sha: string; dirty: boolean };
      sourceSnapshot: string;
    };
    expect(manifest.git).toEqual({ sha: f.sha, dirty: false });
    expect(manifest.sourceSnapshot).toBe("stable");
  });

  it("rejects mismatched expected SHA before any exporter call or output mutation", async () => {
    const f = await fixture();
    const execute = vi.fn(runner());
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha: "f".repeat(40), runner: execute }),
    ).rejects.toThrow(/source commit does not match/);
    expect(execute).not.toHaveBeenCalled();
    await expect(fs.stat(f.outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects abbreviated, uppercase and absent reviewed SHA/Git root before invoking KiCad", async () => {
    const f = await fixture();
    const execute = vi.fn(runner());
    for (const reviewedSourceSha of ["a".repeat(39), f.sha.toUpperCase(), ""]) {
      await expect(
        runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha, runner: execute }),
      ).rejects.toThrow(/full lowercase source SHA/);
    }
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: undefined, reviewedSourceSha: f.sha, runner: execute }),
    ).rejects.toThrow(/explicit Git root/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects tracked source modifications and newly untracked files", async () => {
    const tracked = await fixture();
    await fs.appendFile(tracked.boardFile, "(dirty)\n");
    await expect(
      runGenerate(manufacturing, {
        ...tracked,
        gitRoot: tracked.root,
        reviewedSourceSha: tracked.sha,
        runner: runner(),
      }),
    ).rejects.toThrow(/clean Git checkout/);
    const untracked = await fixture();
    await fs.writeFile(path.join(untracked.root, "untracked.txt"), "unreviewed");
    await expect(
      runGenerate(manufacturing, {
        ...untracked,
        gitRoot: untracked.root,
        reviewedSourceSha: untracked.sha,
        runner: runner(),
      }),
    ).rejects.toThrow(/clean Git checkout/);
  });

  it("refuses an ignored untracked KiCad file even though git status claims a clean tree", async () => {
    const f = await fixture();
    git(f.root, "rm", "--cached", "--", "board.kicad_pcb");
    await fs.appendFile(path.join(f.root, ".gitignore"), "board.kicad_pcb\n");
    git(f.root, "add", "--", ".gitignore");
    git(
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "ignore board",
    );
    const revisedSha = git(f.root, "rev-parse", "HEAD");
    expect(git(f.root, "status", "--porcelain")).toBe("");
    await expect(
      runGenerate(manufacturing, {
        ...f,
        gitRoot: f.root,
        reviewedSourceSha: revisedSha,
        runner: runner(),
      }),
    ).rejects.toThrow(/not tracked by the pinned commit/);
  });

  it("refuses any additional ignored KiCad source file missing from the reviewed tree", async () => {
    const f = await fixture();
    await fs.appendFile(path.join(f.root, ".gitignore"), "*.kicad_sch\n");
    git(f.root, "add", "--", ".gitignore");
    git(
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "ignore schematic",
    );
    const revisedSha = git(f.root, "rev-parse", "HEAD");
    await fs.writeFile(path.join(f.root, "shadow.kicad_sch"), "(ignored and unreviewed)\n");
    expect(git(f.root, "status", "--porcelain")).toBe("");
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha: revisedSha, runner: runner() }),
    ).rejects.toThrow(/not tracked by the pinned commit/);
  });

  it("refuses to borrow HEAD from an ancestor repository", async () => {
    const f = await fixture();
    const nested = path.join(f.root, "subdirectory");
    await fs.mkdir(nested);
    const outputDir = path.join(nested, "generated");
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: nested, outputDir, reviewedSourceSha: f.sha, runner: runner() }),
    ).rejects.toThrow(/checkout top-level/);
  });

  it("preserves preexisting output files instead of replacing a previous manufacturing export", async () => {
    const f = await fixture();
    await fs.mkdir(f.outputDir, { recursive: true });
    await fs.writeFile(path.join(f.outputDir, "preserve.gbr"), "older fab artwork");
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha: f.sha, runner: runner() }),
    ).rejects.toThrow(/fresh|identifiable|new or empty|managed output|recognizable/i);
    expect(await fs.readFile(path.join(f.outputDir, "preserve.gbr"), "utf8")).toBe("older fab artwork");
  });

  it("rejects an out-of-root output location before writing export files", async () => {
    const f = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "brops-reviewed-outside-"));
    roots.push(outside);
    const outputDir = path.join(outside, "generated");
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, outputDir, reviewedSourceSha: f.sha, runner: runner() }),
    ).rejects.toThrow(/in-root, separate generated directory/);
    await expect(fs.stat(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not accept Gerber-only or drill-only plans as a reviewed manufacturing set", async () => {
    const f = await fixture();
    for (const kind of ["gerbers", "drill"] as const) {
      await expect(
        runGenerate({ steps: [{ kind }] }, { ...f, gitRoot: f.root, reviewedSourceSha: f.sha, runner: runner() }),
      ).rejects.toThrow(/both Gerber and drill/);
    }
  });

  it("rejects an exporter that exits zero but emits no drill file", async () => {
    const f = await fixture();
    const successful = runner();
    const incomplete: GenerateRunner = async (args) =>
      args[2] === "drill" ? { code: 0, timedOut: false, stdout: "", stderr: "" } : successful(args);
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha: f.sha, runner: incomplete }),
    ).rejects.toThrow(/successful Gerber\/drill generation/);
    await expect(fs.stat(path.join(f.outputDir, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a source mutation mid-run without emitting a successful manifest", async () => {
    const f = await fixture();
    const successful = runner();
    let changed = false;
    const altering: GenerateRunner = async (args) => {
      const result = await successful(args);
      if (!changed) {
        await fs.appendFile(f.boardFile, "(modified during export)\n");
        changed = true;
      }
      return result;
    };
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha: f.sha, runner: altering }),
    ).rejects.toThrow(/unchanged source snapshot/);
    await expect(fs.stat(path.join(f.outputDir, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects new untracked source-side artifacts even when KiCad file fingerprints remain stable", async () => {
    const f = await fixture();
    const successful = runner();
    const untracked: GenerateRunner = async (args) => {
      const result = await successful(args);
      await fs.writeFile(path.join(f.root, "untracked-rogue.txt"), "not from reviewed commit");
      return result;
    };
    await expect(
      runGenerate(manufacturing, { ...f, gitRoot: f.root, reviewedSourceSha: f.sha, runner: untracked }),
    ).rejects.toThrow(/clean Git checkout/);
  });
});
