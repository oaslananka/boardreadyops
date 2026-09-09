import path from "node:path";
import { defaultConfig, loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { canonicalRoot, registerPipelineRules, runPipeline } from "../../core/pipeline.js";
import type { RuleExplanation } from "../../core/rule-registry.js";
import { listRules } from "../../core/rule-registry.js";
import { resolveLocale, t } from "../../i18n/t.js";

export async function explainCommand(
  ruleId: string,
  pathInput: string | undefined,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const locale = resolveLocale();
  const root = await canonicalRoot(path.resolve(pathInput ?? "."));
  const loaded = await loadConfig(root);
  if (loaded.errors.length > 0) {
    for (const error of loaded.errors) {
      streams.stderr.write(`${t("cli.error.configuration", { error }, locale)}\n`);
    }
    return 2;
  }
  registerPipelineRules();
  const selected = listRules().find((candidate) => candidate.meta.id === ruleId);
  if (!selected) {
    streams.stderr.write(`${t("cli.explain.error.unknownRule", { ruleId }, locale)}\n`);
    return 2;
  }
  if (!selected.explain) {
    streams.stderr.write(`${t("cli.explain.error.unsupportedRule", { ruleId }, locale)}\n`);
    return 2;
  }
  const result = await runPipeline({
    cwd: process.cwd(),
    path: root,
    rules: [ruleId],
    annotations: false,
    failOn: "never",
    quiet: true,
  });
  const config = { ...defaultConfig(), ...loaded.config };
  const explanation = await selected.explain({
    root,
    projects: result.projects,
    config,
    options: {
      cwd: process.cwd(),
      path: root,
      project: undefined,
      config: undefined,
      mode: config.mode ?? "warn",
      requireKicad: false,
      kicadCli: undefined,
      bom: undefined,
      pinmap: undefined,
      variant: undefined,
      concurrency: 1,
      failOn: "never",
      gate: undefined,
      rules: [ruleId],
      skips: [],
      ignoreBaseline: false,
      annotations: false,
      quiet: true,
      verbose: false,
      color: "auto",
    },
    logger: createLogger("silent"),
  });
  streams.stdout.write(formatExplanation(explanation));
  return 0;
}

function formatExplanation(explanation: RuleExplanation): string {
  const lines = [explanation.ruleId, "", explanation.summary];
  for (const section of explanation.sections) {
    lines.push(
      "",
      section.title,
      ...(section.lines.length > 0 ? section.lines.map((line) => `- ${line}`) : ["- none"]),
    );
  }
  return `${lines.join("\n")}\n`;
}
