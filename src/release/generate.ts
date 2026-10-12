import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import generateRecipeSchema from "../../schemas/generate-recipe.schema.json" with { type: "json" };
import { computeSourceFingerprint, verifyExportProvenance } from "../core/provenance.js";
import { boardReadyVersion } from "../generated/version.js";
import { resolveGitExecutable } from "../util/git-resolver.js";
import { globFiles } from "../util/glob.js";
import { canonicalizeJson } from "../util/json.js";
import { isInside, resolveExistingPathAlias, toPosixPath } from "../util/path.js";
import { runProcess } from "../util/process.js";
import { redactControlCharacters } from "../util/strings.js";
import { assertSafeGenerateOutputCleanup } from "./output-cleanup.js";

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
  /** kicad-cli version string, as reported by `detectKicadCli()`. */
  kicadVersion?: string | undefined;
  /** Directory to read git provenance from; typically the project root. */
  gitRoot?: string | undefined;
  /**
   * Optional fail-closed, local source checkout precondition for a future
   * target-repository attested exporter. This is NOT a trusted attestation;
   * the caller must independently authenticate the reviewed source SHA.
   */
  reviewedSourceSha?: string | undefined;
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

interface GenerateGitState {
  sha?: string | undefined;
  dirty?: boolean | undefined;
}

interface GenerateManifest {
  kind: "boardreadyops.export-provenance";
  schemaVersion: 1;
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  project: { name?: string; board?: string; schematic?: string; variant?: string };
  recipe: { source: string; hash: string; steps: GenerateRecipeStep[] };
  kicadVersion?: string | undefined;
  git?: GenerateGitState | undefined;
  /** Self-reported source-byte consistency only; NOT authenticated export provenance. */
  sourceFingerprint?: string | undefined;
  sourceSnapshot?: "stable" | "changed" | undefined;
  environment: { platform: string; nodeVersion: string };
  steps: GenerateStepOutcome[];
  artifacts: GeneratedArtifact[];
}

// Git honors these over cwd-based repository discovery. A caller that invokes this from inside
// another git operation (a hook, a wrapper script) may have them set for its own repository --
// left alone, they would make git resolve `root`'s provenance from the WRONG repository instead
// of failing closed. Stripped so `root` is the sole authority on which repository is inspected.
const GIT_DISCOVERY_OVERRIDE_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
];

function gitDiscoveryEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_DISCOVERY_OVERRIDE_VARS) {
    delete env[key];
  }
  return env;
}

/**
 * Best-effort git provenance for the manifest: no sha/dirty state when the
 * directory isn't a git repository, git isn't installed, or the lookup
 * otherwise fails -- provenance is informational, not a hard requirement.
 */
async function gitState(root: string): Promise<GenerateGitState> {
  try {
    const gitExecutable = resolveGitExecutable();
    const env = gitDiscoveryEnv();
    const [sha, status] = await Promise.all([
      runProcess(gitExecutable, ["rev-parse", "HEAD"], { cwd: root, env, timeoutMs: 10_000 }),
      runProcess(gitExecutable, ["status", "--porcelain"], { cwd: root, env, timeoutMs: 10_000 }),
    ]);
    if (sha.code !== 0) {
      return {};
    }
    const trimmedSha = sha.stdout.trim();
    return trimmedSha ? { sha: trimmedSha, dirty: status.stdout.trim().length > 0 } : {};
  } catch {
    return {};
  }
}

const reviewedShaPattern = /^[0-9a-f]{40}$/u;
// Keep this aligned with SOURCE_PATTERNS in core/provenance.ts: each source
// fingerprint input must actually be tracked by the reviewed Git commit.
const reviewedSourcePatterns = [
  "**/*.kicad_pcb",
  "**/*.kicad_sch",
  "**/*.kicad_pro",
  "**/*.kicad_jobset",
  "**/*.kicad_dru",
  "**/*.kicad_wks",
];

async function assertReviewedSource(options: GenerateOptions): Promise<void> {
  const expected = options.reviewedSourceSha;
  if (expected === undefined) return;
  if (!reviewedShaPattern.test(expected) || !options.gitRoot) {
    throw new Error("Reviewed export requires a full lowercase source SHA and explicit Git root.");
  }

  const root = await fs.realpath(options.gitRoot);
  const executable = resolveGitExecutable();
  const env = gitDiscoveryEnv();
  const [top, head, status] = await Promise.all([
    runProcess(executable, ["rev-parse", "--show-toplevel"], { cwd: root, env, timeoutMs: 10_000 }),
    runProcess(executable, ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: root, env, timeoutMs: 10_000 }),
    runProcess(executable, ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      env,
      timeoutMs: 10_000,
    }),
  ]);
  if (top.code !== 0 || head.code !== 0 || status.code !== 0 || top.timedOut || head.timedOut || status.timedOut) {
    throw new Error("Reviewed export could not verify its Git checkout and working-tree state.");
  }
  if (path.resolve(top.stdout.trim()) !== root) {
    throw new Error("Reviewed export Git root must match the checkout top-level directory.");
  }
  if (head.stdout.trim() !== expected) {
    throw new Error("Reviewed export source commit does not match the pinned SHA.");
  }
  if (status.stdout.trim() !== "") {
    throw new Error("Reviewed export requires a clean Git checkout, including untracked files.");
  }

  // Git status alone does not cover ignored/untracked source files. Ensure
  // every KiCad input in the source fingerprint belongs to the pinned commit.
  const sourcePaths = (await globFiles(root, reviewedSourcePatterns, { rejectMatchingSymlinks: true })).map(
    (absolute) => toPosixPath(path.relative(root, absolute)),
  );
  if (sourcePaths.length === 0 || sourcePaths.length > 4096) {
    throw new Error("Reviewed export has no KiCad inputs or exceeds the source inventory limit.");
  }
  const tracked = await runProcess(executable, ["ls-files", "--cached", "-z", "--", ...sourcePaths], {
    cwd: root,
    env,
    timeoutMs: 10_000,
    maxStdoutBytes: 1024 * 1024,
  });
  if (tracked.code !== 0 || tracked.timedOut) {
    throw new Error("Reviewed export could not verify its Git-tracked KiCad source inventory.");
  }
  const trackedPaths = new Set(tracked.stdout.split("\0").filter(Boolean));
  if (sourcePaths.some((sourcePath) => !trackedPaths.has(sourcePath))) {
    throw new Error("Reviewed export includes a KiCad source input not tracked by the pinned commit.");
  }
}

async function assertFreshReviewedOutput(outputDir: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(outputDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || (await fs.readdir(outputDir)).length !== 0) {
    throw new Error("Reviewed export requires a new or empty generated-output directory.");
  }
}

async function sourceInputFingerprint(options: GenerateOptions): Promise<string | undefined> {
  if (!options.gitRoot) return undefined;
  const inputs = [options.boardFile, options.schematicFile].filter((file): file is string => typeof file === "string");
  if (inputs.length === 0) return undefined;

  try {
    const root = await fs.realpath(options.gitRoot);
    for (const file of inputs) {
      const absolute = await fs.realpath(file);
      const relative = path.relative(root, absolute);
      if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return undefined;
      }
      if (!(await fs.stat(absolute)).isFile()) return undefined;
    }
    return await computeSourceFingerprint(options.gitRoot);
  } catch {
    return undefined;
  }
}

async function ensureGenerateStepOutputDirectory(absoluteOutput: string, step: GeneratePlanStep): Promise<void> {
  const directory = step.isDirectory ? absoluteOutput : path.dirname(absoluteOutput);
  await fs.mkdir(directory, { recursive: true });
}

export async function runGenerate(recipe: GenerateRecipe, options: GenerateOptions): Promise<GenerateResult> {
  const outputDir = path.resolve(options.outputDir);
  const available: GenerateAvailability = {
    board: Boolean(options.boardFile),
    schematic: Boolean(options.schematicFile),
  };
  const plan = buildGeneratePlan(recipe, available);
  if (options.reviewedSourceSha !== undefined) {
    // A missing board/drill set cannot be elevated to source-bound fabrication proof.
    if (!options.boardFile || !["gerbers", "drill"].every((kind) => plan.steps.some((step) => step.kind === kind))) {
      throw new Error("Reviewed manufacturing export requires both Gerber and drill steps.");
    }
    await assertReviewedSource(options);
    // The existing local verifier deliberately rejects a manifest outside
    // the source root; enforce that boundary *before* creating any files.
    const canonicalRoot = await fs.realpath(options.gitRoot!);
    const canonicalOutput = await resolveExistingPathAlias(outputDir);
    if (canonicalOutput === canonicalRoot || !isInside(canonicalRoot, canonicalOutput)) {
      throw new Error("Reviewed export output must be an in-root, separate generated directory.");
    }
  }
  const sourceFingerprintBefore = await sourceInputFingerprint(options);
  if (options.reviewedSourceSha !== undefined && !sourceFingerprintBefore) {
    throw new Error("Reviewed manufacturing export requires in-root, readable KiCad source inputs.");
  }

  await assertSafeGenerateOutputCleanup(outputDir, options);
  if (options.reviewedSourceSha !== undefined) await assertFreshReviewedOutput(outputDir);
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
    await ensureGenerateStepOutputDirectory(absoluteOutput, step);
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

  const sourceFingerprintAfter = sourceFingerprintBefore ? await sourceInputFingerprint(options) : undefined;
  const sourceSnapshot =
    sourceFingerprintBefore === undefined
      ? undefined
      : sourceFingerprintBefore === sourceFingerprintAfter
        ? "stable"
        : "changed";
  const recipeHash = createHash("sha256").update(canonicalizeJson(recipe)).digest("hex");
  if (options.reviewedSourceSha !== undefined) {
    const missingManufacturingOutput = ["gerbers", "drill"].some(
      (kind) =>
        !outcomes.some(
          (outcome) => outcome.kind === kind && outcome.status === "generated" && (outcome.files ?? 0) > 0,
        ),
    );
    if (
      sourceSnapshot !== "stable" ||
      outcomes.some((outcome) => outcome.status === "failed") ||
      missingManufacturingOutput ||
      artifacts.length === 0
    ) {
      throw new Error(
        "Reviewed manufacturing export requires successful Gerber/drill generation from an unchanged source snapshot.",
      );
    }
    await assertReviewedSource(options);
  }
  const git = options.gitRoot ? await gitState(options.gitRoot) : {};

  const manifest: GenerateManifest = {
    kind: "boardreadyops.export-provenance",
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    project: {
      ...(options.projectName ? { name: options.projectName } : {}),
      ...(options.boardFile ? { board: path.basename(options.boardFile) } : {}),
      ...(options.schematicFile ? { schematic: path.basename(options.schematicFile) } : {}),
      ...(options.variant ? { variant: options.variant } : {}),
    },
    recipe: { source: options.recipeSource ?? "default", hash: recipeHash, steps: recipe.steps },
    ...(options.kicadVersion ? { kicadVersion: options.kicadVersion } : {}),
    ...(git.sha ? { git } : {}),
    ...(sourceSnapshot ? { sourceSnapshot } : {}),
    ...(sourceSnapshot === "stable" && sourceFingerprintBefore ? { sourceFingerprint: sourceFingerprintBefore } : {}),
    environment: { platform: process.platform, nodeVersion: process.version },
    steps: outcomes,
    artifacts,
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.reviewedSourceSha !== undefined) {
    const verification = await verifyExportProvenance(options.gitRoot!, manifestPath, {
      currentGitSha: options.reviewedSourceSha,
    });
    if (verification.status !== "verified" || verification.gitShaMatch !== true) {
      throw new Error("Reviewed manufacturing export failed local source and output byte-consistency checks.");
    }
  }

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
