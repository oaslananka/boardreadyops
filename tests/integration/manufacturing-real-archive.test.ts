import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { releaseArchiveCommand } from "../../src/cli/commands/manufacturing-archive.js";
import { detectKicadCli } from "../../src/kicad/cli.js";
import { createKicadCliRunner, type GenerateResult, runGenerate } from "../../src/release/generate.js";
import { createVerifiedManufacturingZip } from "../../src/release/manufacturing-archive.js";

async function verifyRejectedArchiveCases(root: string, generated: GenerateResult, sourceCommitSha: string) {
  await expect(
    createVerifiedManufacturingZip({
      root,
      generated,
      sourceCommitSha: "f".repeat(40),
      destination: path.join(root, "build", "wrong-sha.zip"),
    }),
  ).rejects.toThrow(/proof|source|commit/u);

  const gerbers = generated.artifacts.filter((item) => item.kind === "gerber");
  const first = gerbers[0];
  const second = gerbers[1];
  if (!first || !second) throw new Error("Real output did not generate multiple Gerber layers");
  const duplicatedOutput = {
    ...generated,
    artifacts: generated.artifacts.map((item) => (item.path === second.path ? first : item)),
  };
  await expect(
    createVerifiedManufacturingZip({
      root,
      generated: duplicatedOutput,
      sourceCommitSha,
      destination: path.join(root, "build", "duplicated-output.zip"),
    }),
  ).rejects.toThrow("inventory differs from verified proof");

  const missingDrill = {
    ...generated,
    artifacts: generated.artifacts.filter((artifact) => artifact.kind !== "drill"),
  };
  await expect(
    createVerifiedManufacturingZip({
      root,
      generated: missingDrill,
      sourceCommitSha,
      destination: path.join(root, "build", "missing-drill.zip"),
    }),
  ).rejects.toThrow("requires generated Gerber and Excellon drill files");

  const drill = generated.artifacts.find((artifact) => artifact.kind === "drill");
  if (!drill) throw new Error("Real Excellon output was not generated");
  const drillFile = path.join(generated.outputDir, drill.path);
  const drillContents = await fs.readFile(drillFile);
  await fs.rm(drillFile);
  await expect(
    createVerifiedManufacturingZip({
      root,
      generated,
      sourceCommitSha,
      destination: path.join(root, "build", "removed-drill.zip"),
    }),
  ).rejects.toThrow("Manufacturing export proof");
  await fs.writeFile(drillFile, drillContents);

  const original = generated.artifacts.find((artifact) => artifact.kind === "gerber");
  if (!original) throw new Error("Real Gerber export was not generated");
  await fs.appendFile(path.join(generated.outputDir, original.path), "\nG04 CHANGED*\n");
  await expect(
    createVerifiedManufacturingZip({
      root,
      generated,
      sourceCommitSha,
      destination: path.join(root, "build", "tampered.zip"),
    }),
  ).rejects.toThrow(/proof|byte|inventory/u);
}

describe("real KiCad manufacturing ZIP (local proof; not a signed release)", () => {
  it("packages actual Gerber/Excellon bytes bound to one source commit, rejecting modified exports", async (context) => {
    const cli = await detectKicadCli();
    if (!process.env.CI) context.skip(!cli.found || !/^10[.]0[.]/u.test(cli.version ?? ""), "Requires KiCad 10");
    if (!cli.path) throw new Error("KiCad 10 is unavailable");

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-manufacturing-zip-"));
    try {
      await fs.cp(path.resolve("tests/fixtures/projects/safe-basic"), root, { recursive: true });
      await fs.writeFile(path.join(root, ".gitignore"), "build/\n");
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync(
        "git",
        ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"],
        { cwd: root },
      );
      const sourceCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      const generated = await runGenerate(
        { schemaVersion: 1, steps: [{ kind: "gerbers" }, { kind: "drill" }] },
        {
          outputDir: path.join(root, "build", "real-outputs"),
          boardFile: path.join(root, "safe-basic.kicad_pcb"),
          runner: createKicadCliRunner(cli.path),
          gitRoot: root,
          reviewedSourceSha: sourceCommitSha,
          kicadVersion: cli.version,
        },
      );
      expect(generated.failures).toBe(0);
      const destination = path.join(root, "build", "manufacturing.zip");
      const result = await createVerifiedManufacturingZip({ root, generated, sourceCommitSha, destination });
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.files).toBeGreaterThanOrEqual(3);
      const contents = await fs.readFile(destination);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(result.sha256);
      expect(contents.subarray(0, 2).toString()).toBe("PK");
      // ZIP's central directory lists the manifest and real KiCad files, not fabricated metadata.
      expect(contents.includes(Buffer.from("export-provenance.json"))).toBe(true);
      expect(contents.includes(Buffer.from("outputs/gerbers/"))).toBe(true);
      expect(contents.includes(Buffer.from("outputs/drill/"))).toBe(true);

      const messages: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          messages.push(String(chunk));
          callback();
        },
      });
      const cliStatus = await releaseArchiveCommand(
        root,
        {
          reviewedSourceSha: sourceCommitSha,
          generated: "build/cli-generated",
          output: "build/cli-manufacturing.zip",
        },
        { stdout: stream, stderr: stream },
      );
      expect(cliStatus).toBe(0);
      expect(messages.join("")).toContain("unsigned; no release approval");
      const cliZip = await fs.readFile(path.join(root, "build", "cli-manufacturing.zip"));
      expect(cliZip.subarray(0, 2).toString()).toBe("PK");

      await verifyRejectedArchiveCases(root, generated, sourceCommitSha);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
