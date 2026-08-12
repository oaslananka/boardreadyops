import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGeneratePlan,
  DEFAULT_GENERATE_RECIPE,
  type GenerateRecipe,
  type GenerateRunner,
  generateStepArgs,
  runGenerate,
  validateGenerateRecipe,
} from "../../../src/release/generate.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brops-generate-"));
  tempDirs.push(dir);
  return dir;
}

function writingRunner(failKinds: Set<string> = new Set()): GenerateRunner {
  return async (args) => {
    const outputIndex = args.indexOf("--output");
    const output = args[outputIndex + 1] ?? "";
    const subcommand = `${args[0]}-${args[2]}`;
    if (failKinds.has(subcommand)) {
      return { code: 1, stdout: "", stderr: "export error", timedOut: false };
    }
    if (path.extname(output)) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `content-of-${path.basename(output)}`);
    } else {
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, "F_Cu.gbr"), "gerber-1");
      await fs.writeFile(path.join(output, "B_Cu.gbr"), "gerber-2");
    }
    return { code: 0, stdout: "ok", stderr: "", timedOut: false };
  };
}

describe("buildGeneratePlan", () => {
  it("skips schematic outputs when no schematic is available", () => {
    const plan = buildGeneratePlan(DEFAULT_GENERATE_RECIPE, { board: true, schematic: false });
    const planned = plan.steps.map((step) => step.kind);
    expect(planned).toContain("gerbers");
    expect(planned).not.toContain("bom");
    expect(plan.skipped.map((entry) => entry.kind)).toContain("bom");
    expect(plan.skipped.find((entry) => entry.kind === "schematic-pdf")?.reason).toMatch(/schematic/);
  });

  it("honors disabled steps and emits in canonical order regardless of recipe order", () => {
    const recipe: GenerateRecipe = {
      steps: [{ kind: "bom" }, { kind: "gerbers", enabled: false }, { kind: "drill" }],
    };
    const plan = buildGeneratePlan(recipe, { board: true, schematic: true });
    expect(plan.steps.map((step) => step.kind)).toEqual(["drill", "bom"]);
    expect(plan.skipped.find((entry) => entry.kind === "gerbers")?.reason).toBe("disabled by recipe");
  });
});

function planStep(recipe: GenerateRecipe, available: { board: boolean; schematic: boolean }, kind: string) {
  const step = buildGeneratePlan(recipe, available).steps.find((entry) => entry.kind === kind);
  if (!step) {
    throw new Error(`expected plan step ${kind}`);
  }
  return step;
}

describe("generateStepArgs", () => {
  it("builds gerber export args from the board file", () => {
    const step = planStep({ steps: [{ kind: "gerbers" }] }, { board: true, schematic: false }, "gerbers");
    const args = generateStepArgs(step, { boardFile: "/tmp/board.kicad_pcb", outputPath: "/out/gerbers" });
    expect(args).toEqual(["pcb", "export", "gerbers", "--output", "/out/gerbers", "/tmp/board.kicad_pcb"]);
  });

  it("builds CSV position args and threads the variant define", () => {
    const step = planStep({ steps: [{ kind: "positions" }] }, { board: true, schematic: false }, "positions");
    const args = generateStepArgs(step, {
      boardFile: "/tmp/board.kicad_pcb",
      outputPath: "/out/pos.csv",
      variant: "production",
    });
    expect(args).toContain("pos");
    expect(args).toContain("csv");
    expect(args).toEqual(expect.arrayContaining(["--define-var", "BOARDREADYOPS_VARIANT=production"]));
  });

  it("throws when the required source file is missing", () => {
    const step = planStep({ steps: [{ kind: "bom" }] }, { board: false, schematic: true }, "bom");
    expect(() => generateStepArgs(step, { outputPath: "/out/bom.csv" })).toThrow(/sch input/);
  });
});

describe("validateGenerateRecipe", () => {
  it("accepts a valid recipe", () => {
    const validation = validateGenerateRecipe({ schemaVersion: 1, steps: [{ kind: "gerbers" }] });
    expect(validation.recipe).toBeDefined();
    expect(validation.errors).toEqual([]);
  });

  it("rejects unknown output kinds and unexpected properties", () => {
    expect(validateGenerateRecipe({ steps: [{ kind: "nope" }] }).recipe).toBeUndefined();
    expect(validateGenerateRecipe({ steps: [] }).errors.length).toBeGreaterThan(0);
    expect(validateGenerateRecipe({ steps: [{ kind: "bom", extra: true }] }).recipe).toBeUndefined();
  });
});

describe("generate source invariants", () => {
  it("keeps directory entry sorting immutable", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src/release/generate.ts"), "utf8");

    expect(source).toContain("entries.toSorted((left, right) => left.name.localeCompare(right.name))");
    expect(source).not.toContain("entries.sort((left, right) => left.name.localeCompare(right.name))");
  });
});

describe("runGenerate", () => {
  it("produces artifacts and a checksum manifest for the default recipe", async () => {
    const outputDir = await makeTempDir();
    const result = await runGenerate(DEFAULT_GENERATE_RECIPE, {
      outputDir,
      boardFile: "/project/board.kicad_pcb",
      schematicFile: "/project/board.kicad_sch",
      runner: writingRunner(),
      projectName: "board",
      generatedAt: "2026-06-21T00:00:00.000Z",
    });

    expect(result.failures).toBe(0);
    expect(result.steps.every((step) => step.status === "generated")).toBe(true);
    expect(result.artifacts.length).toBeGreaterThan(0);
    for (const artifact of result.artifacts) {
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.path).not.toContain("\\");
    }
    const gerbers = result.steps.find((step) => step.kind === "gerbers");
    expect(gerbers?.files).toBe(2);

    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")) as {
      generatedAt: string;
      project: { name?: string; board?: string };
      artifacts: unknown[];
    };
    expect(manifest.generatedAt).toBe("2026-06-21T00:00:00.000Z");
    expect(manifest.project.board).toBe("board.kicad_pcb");
    expect(manifest.artifacts.length).toBe(result.artifacts.length);
  });

  it("records a failed step without aborting the remaining outputs", async () => {
    const outputDir = await makeTempDir();
    const result = await runGenerate(
      { steps: [{ kind: "gerbers" }, { kind: "bom" }] },
      {
        outputDir,
        boardFile: "/project/board.kicad_pcb",
        schematicFile: "/project/board.kicad_sch",
        runner: writingRunner(new Set(["sch-bom"])),
      },
    );
    expect(result.failures).toBe(1);
    expect(result.steps.find((step) => step.kind === "bom")?.status).toBe("failed");
    expect(result.steps.find((step) => step.kind === "gerbers")?.status).toBe("generated");
  });

  it("marks schematic outputs skipped when no schematic file is provided", async () => {
    const outputDir = await makeTempDir();
    const result = await runGenerate(DEFAULT_GENERATE_RECIPE, {
      outputDir,
      boardFile: "/project/board.kicad_pcb",
      runner: writingRunner(),
    });
    expect(result.steps.find((step) => step.kind === "bom")?.status).toBe("skipped");
  });
});
