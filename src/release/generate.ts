import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import generateRecipeSchema from "../../schemas/generate-recipe.schema.json" with { type: "json" };
import { boardReadyVersion } from "../generated/version.js";
import { runProcess } from "../util/process.js";
import { redactControlCharacters } from "../util/strings.js";

type GenerateOutputKind = "gerbers" | "drill" | "bom" | "positions" | "schematic-pdf" | "board-pdf";
type GenerateSource = "pcb" | "sch";
type GeneratedArtifactKind = "gerber" | "drill" | "bom" | "cpl" | "pdf";

interface GenerateRecipeStep {
  kind: GenerateOutputKind;
  enabled?: boolean;
  output?: string;
}

export interface GenerateRecipe {
  schemaVersion?: 1;
  outputDir?: string;
  steps: GenerateRecipeStep[];
}

interface OutputKindSpec {
  source: GenerateSource;
  artifactKind: GeneratedArtifactKind;
  isDirectory: boolean;
  defaultOutput: string;
}

const OUTPUT_KINDS: Record<GenerateOutputKind, OutputKindSpec> = {
  gerbers: { source: "pcb", artifactKind: "gerber", isDirectory: true, defaultOutput: "gerbers" },
  drill: { source: "pcb", artifactKind: "drill", isDirectory: true, defaultOutput: "drill" },
  bom: { source: "sch", artifactKind: "bom", isDirectory: false, defaultOutput: "assembly/bom.csv" },
  positions: { source: "pcb", artifactKind: "cpl", isDirectory: false, defaultOutput: "assembly/positions.csv" },
  "schematic-pdf": {
    source: "sch",
    artifactKind: "pdf",
    isDirectory: false,
    defaultOutput: "documentation/schematic.pdf",
  },
  "board-pdf": { source: "pcb", artifactKind: "pdf", isDirectory: false, defaultOutput: "documentation/board.pdf" },
};

// Canonical emit order keeps generated manifests deterministic regardless of recipe ordering.
const KIND_ORDER: GenerateOutputKind[] = ["gerbers", "drill", "bom", "positions", "schematic-pdf", "board-pdf"];

export const DEFAULT_GENERATE_OUTPUT_DIR = "build/boardreadyops-generate";

export const DEFAULT_GENERATE_RECIPE: GenerateRecipe = {
  schemaVersion: 1,
  steps: [{ kind: "gerbers" }, { kind: "drill" }, { kind: "bom" }, { kind: "positions" }, { kind: "schematic-pdf" }],
};

export interface GeneratePlanStep {
  kind: GenerateOutputKind;
  source: GenerateSource;
  artifactKind: GeneratedArtifactKind;
  isDirectory: boolean;
  output: string;
}

interface SkippedGenerateStep {
  kind: GenerateOutputKind;
  reason: string;
}

export interface GeneratePlan {
  steps: GeneratePlanStep[];
  skipped: SkippedGenerateStep[];
}

export interface GenerateAvailability {
  board: boolean;
  schematic: boolean;
}

export function buildGeneratePlan(recipe: GenerateRecipe, available: GenerateAvailability): GeneratePlan {
  const byKind = new Map<GenerateOutputKind, GenerateRecipeStep>();
  for (const step of recipe.steps) {
    byKind.set(step.kind, step);
  }
  const steps: GeneratePlanStep[] = [];
  const skipped: SkippedGenerateStep[] = [];
  for (const kind of KIND_ORDER) {
    const step = byKind.get(kind);
    if (!step) {
      continue;
    }
    const spec = OUTPUT_KINDS[kind];
    if (step.enabled === false) {
      skipped.push({ kind, reason: "disabled by recipe" });
      continue;
    }
    if (spec.source === "pcb" && !available.board) {
      skipped.push({ kind, reason: "project has no .kicad_pcb board file" });
      continue;
    }
    if (spec.source === "sch" && !available.schematic) {
      skipped.push({ kind, reason: "project has no .kicad_sch schematic file" });
      continue;
    }
    steps.push({
      kind,
      source: spec.source,
      artifactKind: spec.artifactKind,
      isDirectory: spec.isDirectory,
      output: toPosix(step.output ?? spec.defaultOutput),
    });
  }
  return { steps, skipped };
}

export interface GenerateStepArgsContext {
  boardFile?: string | undefined;
  schematicFile?: string | undefined;
  outputPath: string;
  variant?: string | undefined;
}

export function generateStepArgs(step: GeneratePlanStep, context: GenerateStepArgsContext): string[] {
  const input = step.source === "pcb" ? context.boardFile : context.schematicFile;
  if (!input) {
    throw new Error(`generate step ${step.kind} requires a ${step.source} input file`);
  }
  const variantArgs = context.variant ? ["--define-var", `BOARDREADYOPS_VARIANT=${context.variant}`] : [];
  switch (step.kind) {
    case "gerbers":
      return ["pcb", "export", "gerbers", "--output", context.outputPath, ...variantArgs, input];
    case "drill":
      return ["pcb", "export", "drill", "--output", context.outputPath, ...variantArgs, input];
    case "bom":
      return ["sch", "export", "bom", "--output", context.outputPath, ...variantArgs, input];
    case "positions":
      return [
        "pcb",
        "export",
        "pos",
        "--output",
        context.outputPath,
        "--format",
        "csv",
        "--units",
        "mm",
        "--side",
        "both",
        ...variantArgs,
        input,
      ];
    case "schematic-pdf":
      return ["sch", "export", "pdf", "--output", context.outputPath, ...variantArgs, input];
    case "board-pdf":
      return ["pcb", "export", "pdf", "--output", context.outputPath, ...variantArgs, input];
  }
}

interface GenerateRunnerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type GenerateRunner = (args: string[]) => Promise<GenerateRunnerResult>;

/** Build a {@link GenerateRunner} that invokes a kicad-cli executable for each export step. */
export function createKicadCliRunner(cliPath: string): GenerateRunner {
  return async (args) => {
    const result = await runProcess(cliPath, args, {
      timeoutMs: 180_000,
      maxStdoutBytes: 256 * 1024,
      maxStderrBytes: 256 * 1024,
    });
    return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut };
  };
}

export interface GenerateOptions {
  outputDir: string;
  boardFile?: string | undefined;
  schematicFile?: string | undefined;
  variant?: string | undefined;
  runner: GenerateRunner;
  generatedAt?: string | undefined;
  projectName?: string | undefined;
  recipeSource?: string | undefined;
}

interface GenerateStepOutcome {
  kind: GenerateOutputKind;
  status: "generated" | "failed" | "skipped";
  output?: string | undefined;
  files?: number | undefined;
  error?: string | undefined;
  reason?: string | undefined;
}

interface GeneratedArtifact {
  path: string;
  kind: GeneratedArtifactKind;
  sha256: string;
  bytes: number;
}

export interface GenerateResult {
  outputDir: string;
  manifestPath: string;
  steps: GenerateStepOutcome[];
  artifacts: GeneratedArtifact[];
  failures: number;
}

interface GenerateManifest {
  schemaVersion: 1;
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  project: { name?: string; board?: string; schematic?: string; variant?: string };
  recipe: { source: string; steps: GenerateRecipeStep[] };
  steps: GenerateStepOutcome[];
  artifacts: GeneratedArtifact[];
}

export async function runGenerate(recipe: GenerateRecipe, options: GenerateOptions): Promise<GenerateResult> {
  const outputDir = path.resolve(options.outputDir);
  const available: GenerateAvailability = {
    board: Boolean(options.boardFile),
    schematic: Boolean(options.schematicFile),
  };
  const plan = buildGeneratePlan(recipe, available);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const outcomes: GenerateStepOutcome[] = plan.skipped.map((entry) => ({
    kind: entry.kind,
    status: "skipped",
    reason: entry.reason,
  }));
  const artifacts: GeneratedArtifact[] = [];

  for (const step of plan.steps) {
    const absoluteOutput = path.join(outputDir, step.output);
    if (step.isDirectory) {
      await fs.mkdir(absoluteOutput, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
    }
    const args = generateStepArgs(step, {
      boardFile: options.boardFile,
      schematicFile: options.schematicFile,
      outputPath: absoluteOutput,
      variant: options.variant,
    });
    const result = await options.runner(args);
    if (result.code !== 0) {
      outcomes.push({
        kind: step.kind,
        status: "failed",
        output: step.output,
        error: result.timedOut
          ? `${step.kind} export timed out`
          : redactControlCharacters(`${result.stdout}\n${result.stderr}`).trim() || `${step.kind} export failed`,
      });
      continue;
    }
    const produced = await collectStepArtifacts(outputDir, absoluteOutput, step);
    artifacts.push(...produced);
    outcomes.push({ kind: step.kind, status: "generated", output: step.output, files: produced.length });
  }

  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  outcomes.sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind));

  const manifest: GenerateManifest = {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    project: {
      ...(options.projectName ? { name: options.projectName } : {}),
      ...(options.boardFile ? { board: path.basename(options.boardFile) } : {}),
      ...(options.schematicFile ? { schematic: path.basename(options.schematicFile) } : {}),
      ...(options.variant ? { variant: options.variant } : {}),
    },
    recipe: { source: options.recipeSource ?? "default", steps: recipe.steps },
    steps: outcomes,
    artifacts,
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    outputDir,
    manifestPath,
    steps: outcomes,
    artifacts,
    failures: outcomes.filter((outcome) => outcome.status === "failed").length,
  };
}

export interface GenerateRecipeValidation {
  recipe?: GenerateRecipe;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true });
const validateRecipe = ajv.compile<GenerateRecipe>(generateRecipeSchema);

export function validateGenerateRecipe(value: unknown): GenerateRecipeValidation {
  if (validateRecipe(value)) {
    return { recipe: value, errors: [] };
  }
  const errors = (validateRecipe.errors ?? []).map((error) => {
    const location = error.instancePath || "(root)";
    return `${location} ${error.message ?? "is invalid"}`.trim();
  });
  return { errors: errors.length > 0 ? errors : ["recipe is invalid"] };
}

async function collectStepArtifacts(
  outputDir: string,
  absoluteOutput: string,
  step: GeneratePlanStep,
): Promise<GeneratedArtifact[]> {
  let files: string[];
  if (step.isDirectory) {
    files = await walkFiles(absoluteOutput);
  } else if (await fileExists(absoluteOutput)) {
    files = [absoluteOutput];
  } else {
    files = [];
  }
  const artifacts: GeneratedArtifact[] = [];
  for (const file of files) {
    const relativePath = toPosix(path.relative(outputDir, file));
    const digest = await fileDigest(file);
    artifacts.push({ path: relativePath, kind: step.artifactKind, ...digest });
  }
  return artifacts;
}

async function walkFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(target)));
    } else if (entry.isFile()) {
      output.push(target);
    }
  }
  return output;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function fileDigest(file: string): Promise<{ sha256: string; bytes: number }> {
  const content = await fs.readFile(file);
  return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength };
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/").replaceAll("\\", "/");
}
