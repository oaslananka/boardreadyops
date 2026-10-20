import path from "node:path";
import { discoverProjects } from "../../core/discovery.js";
import { canonicalRoot } from "../../core/pipeline.js";
import { detectKicadCli } from "../../kicad/cli.js";
import { createKicadCliRunner, runGenerate } from "../../release/generate.js";
import { createVerifiedManufacturingZip } from "../../release/manufacturing-archive.js";
import { normalizePathInput } from "../../util/path.js";

export interface ReleaseArchiveOptions {
  reviewedSourceSha: string;
  generated?: string;
  output?: string;
}

/**
 * Create a real local fabrication ZIP from a clean, commit-pinned KiCad checkout.
 * The resulting archive contains source-consistent Gerber/Excellon bytes, NOT an
 * authenticated signature, vendor approval, or hosted delivery authorization.
 */
export async function releaseArchiveCommand(
  pathInput: string | undefined,
  options: ReleaseArchiveOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  try {
    if (!/^[0-9a-f]{40}$/u.test(options.reviewedSourceSha)) {
      streams.stderr.write("A full lowercase reviewed source commit SHA is required.\n");
      return 2;
    }
    const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
    const projects = await discoverProjects(root);
    if (projects.length !== 1 || !projects[0]?.boardFiles[0]) {
      streams.stderr.write("Exactly one KiCad project with a PCB is required for this local fabrication ZIP.\n");
      return 2;
    }
    const cli = await detectKicadCli();
    if (!cli.found || !cli.path || !/^10[.]0[.]/u.test(cli.version ?? "")) {
      streams.stderr.write("KiCad CLI version 10.0.x is required for this manufacturing export.\n");
      return 3;
    }
    const generated = await runGenerate(
      { schemaVersion: 1, steps: [{ kind: "gerbers" }, { kind: "drill" }] },
      {
        outputDir: path.resolve(
          root,
          normalizePathInput(options.generated ?? "build/boardreadyops-manufacturing/outputs"),
        ),
        boardFile: path.resolve(root, projects[0].boardFiles[0]),
        gitRoot: root,
        reviewedSourceSha: options.reviewedSourceSha,
        kicadVersion: cli.version,
        runner: createKicadCliRunner(cli.path),
      },
    );
    if (generated.failures !== 0) {
      streams.stderr.write("KiCad fabrication output generation failed; no manufacturing ZIP was created.\n");
      return 1;
    }
    const result = await createVerifiedManufacturingZip({
      root,
      generated,
      sourceCommitSha: options.reviewedSourceSha,
      destination: path.resolve(root, normalizePathInput(options.output ?? "build/boardreadyops-manufacturing.zip")),
    });
    streams.stdout.write("Locally verified manufacturing ZIP created (unsigned; no release approval).\n");
    streams.stdout.write(`Archive: ${result.path}\n`);
    streams.stdout.write(`SHA-256: ${result.sha256}\n`);
    streams.stdout.write(`Bytes: ${result.bytes}; generated files: ${result.files}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`Manufacturing ZIP not created: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
