import path from "node:path";
import { discoverProjects } from "../../core/discovery.js";
import { canonicalRoot } from "../../core/pipeline.js";
import { resolveLocale, t } from "../../i18n/t.js";
import { detectKicadCli } from "../../kicad/cli.js";
import {
  createKicadCliRunner,
  DEFAULT_GENERATE_OUTPUT_DIR,
  DEFAULT_GENERATE_RECIPE,
  type GenerateRecipe,
  runGenerate,
  validateGenerateRecipe,
} from "../../release/generate.js";
import { readTextFile } from "../../util/fs.js";
import { parseJsonValue } from "../../util/json.js";
import { normalizePathInput } from "../../util/path.js";
import { loadConfigOrReportErrors } from "./run.js";

export interface GenerateCliOptions {
  config?: string | undefined;
  project?: string | undefined;
  variant?: string | undefined;
  recipe?: string | undefined;
  output?: string | undefined;
  kicadCli?: string | undefined;
  format?: string | undefined;
}

export async function generateCommand(
  pathInput: string | undefined,
  options: GenerateCliOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const locale = resolveLocale();
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));

  if (!(await loadConfigOrReportErrors(root, options.config, streams, locale))) {
    return 2;
  }

  const projects = await discoverProjects(root, options.project);
  const project = projects[0];
  if (!project) {
    streams.stderr.write(`No KiCad project found in ${root}.\n`);
    return 2;
  }

  const recipe = await resolveRecipe(root, options.recipe, streams.stderr);
  if (!recipe) {
    return 2;
  }

  const cli = await detectKicadCli(options.kicadCli);
  if (!cli.found || !cli.path) {
    streams.stderr.write(`${t("cli.error.environment.kicadMissing", {}, locale)}\n`);
    return 3;
  }

  const boardFile = project.boardFiles[0] ? path.resolve(root, project.boardFiles[0]) : undefined;
  const schematicFile = project.schematicFiles[0] ? path.resolve(root, project.schematicFiles[0]) : undefined;
  const outputDir = path.resolve(
    root,
    normalizePathInput(options.output ?? recipe.outputDir ?? DEFAULT_GENERATE_OUTPUT_DIR),
  );

  const result = await runGenerate(recipe, {
    outputDir,
    boardFile,
    schematicFile,
    variant: options.variant,
    runner: createKicadCliRunner(cli.path),
    projectName: path.basename(project.projectFile, ".kicad_pro"),
    recipeSource: options.recipe ? normalizePathInput(options.recipe) : "default",
    ...(cli.version ? { kicadVersion: cli.version } : {}),
    gitRoot: root,
  });

  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    writeSummary(result.outputDir, result, streams.stdout);
  }

  return result.failures > 0 ? 1 : 0;
}

async function resolveRecipe(
  root: string,
  recipeOption: string | undefined,
  stderr: NodeJS.WritableStream,
): Promise<GenerateRecipe | undefined> {
  if (!recipeOption) {
    return DEFAULT_GENERATE_RECIPE;
  }
  const recipePath = path.resolve(root, normalizePathInput(recipeOption));
  let text: string;
  try {
    text = await readTextFile(recipePath);
  } catch {
    stderr.write(`Generation recipe not found: ${recipeOption}\n`);
    return undefined;
  }
  const parsed = parseJsonValue(text);
  if (parsed === undefined) {
    stderr.write(`Generation recipe is not valid JSON: ${recipeOption}\n`);
    return undefined;
  }
  const validation = validateGenerateRecipe(parsed);
  if (!validation.recipe) {
    stderr.write(`Invalid generation recipe: ${validation.errors.join("; ")}\n`);
    return undefined;
  }
  return validation.recipe;
}

function writeSummary(
  outputDir: string,
  result: Awaited<ReturnType<typeof runGenerate>>,
  stdout: NodeJS.WritableStream,
): void {
  for (const step of result.steps) {
    if (step.status === "generated") {
      stdout.write(`generated ${step.kind} -> ${step.output} (${step.files ?? 0} files)\n`);
    } else if (step.status === "skipped") {
      stdout.write(`skipped ${step.kind}: ${step.reason ?? "skipped"}\n`);
    } else {
      stdout.write(`failed ${step.kind}: ${step.error ?? "failed"}\n`);
    }
  }
  stdout.write(`Wrote ${result.artifacts.length} artifact(s) and manifest to ${outputDir}.\n`);
}
