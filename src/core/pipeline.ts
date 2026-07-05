import fs from "node:fs/promises";
import path from "node:path";
import { boardReadyVersion } from "../generated/version.js";
import { dispatchNotifications, notificationPayloadFromResult } from "../notifiers/dispatch.js";
import { registerBuiltInRules } from "../rules/_index.js";
import { captureFabricationSnapshot } from "../rules/fabrication-snapshot.js";
import { globFiles } from "../util/glob.js";
import { normalizePathInput } from "../util/path.js";
import { VENDOR_OUTPUT_KINDS, VENDOR_OUTPUT_PATTERNS } from "../vendor/outputs.js";
import { resolveVendorProfile } from "../vendor/profiles.js";
import { applyBaseline, readBaseline, resolveBaselinePath } from "./baseline.js";
import { bomRiskSummaryFromFindings } from "./bom-risk.js";
import { defaultConcurrency, mapLimit } from "./concurrency.js";
import {
  type BoardReadyOpsConfig,
  defaultConfig,
  type GateConfig,
  type LoadedConfig,
  loadConfig,
  type RuleConfig,
} from "./config.js";
import type { PipelineOptions, ProjectContext, RuleContext } from "./context.js";
import { discoverProjects } from "./discovery.js";
import { createFinding, type FailOn, type Finding, sortFindings, summarizeFindings } from "./findings.js";
import { gateRequirementFindings, requiredGateRules, requiredManufacturingOutputs } from "./gates/requirements.js";
import { createLogger, type Logger } from "./logger.js";
import { loadPlugins } from "./plugin-loader.js";
import { evaluatePolicy } from "./policy.js";
import { computeReadiness, type ReadinessScore } from "./readiness.js";
import type { RunResult } from "./result.js";
import { listRules } from "./rule-registry.js";
import { applySuppressions } from "./suppressions.js";
import { applyWaivers } from "./waivers.js";

interface PipelineContext {
  cwd: string;
  root: string;
  config: BoardReadyOpsConfig;
  options: PipelineOptions;
  logger: Logger;
  gate: GateConfig | undefined;
  missingExplicitGate: string | undefined;
  loaded: LoadedConfig;
}

export async function runPipeline(
  input: Partial<PipelineOptions> & { cwd?: string; path?: string } = {},
  logger?: Logger,
): Promise<RunResult> {
  registerPipelineRules();

  // 1. Initialization Phase
  const ctx = await initializePipelineContext(input, logger);
  const pipelineStart = performance.now();
  ctx.logger.debug("pipeline.start", {
    path: ctx.root,
    project_count: projectsLengthHint(input),
  });

  // 2. Discovery Phase
  const { pluginLoad, loadedWithPluginErrors, projects } = await discoverPhase(ctx);

  // 3. Validation Phase
  const findings = await validatePhase(ctx, loadedWithPluginErrors, projects);

  // 4. Post-processing Phase
  const { effectiveFindings, fabrication, readiness, summary, waiverResult, policy } = await postProcessPhase(
    ctx,
    findings,
    projects,
  );

  // 5. Dispatch Phase
  const result = assembleRunResult(
    ctx,
    effectiveFindings,
    fabrication,
    readiness,
    summary,
    waiverResult,
    policy,
    pluginLoad,
    projects,
  );
  const notificationResults = await dispatchNotificationsPhase(ctx, result);

  ctx.logger.debug("pipeline.finish", {
    latency_ms: Math.round(performance.now() - pipelineStart),
    findings: result.summary.total,
    notifications: notificationResults,
  });

  return result;
}

async function initializePipelineContext(
  input: Partial<PipelineOptions> & { cwd?: string; path?: string },
  logger?: Logger,
): Promise<PipelineContext> {
  const cwd = input.cwd ?? process.cwd();
  const root = await canonicalRoot(path.resolve(cwd, normalizePathInput(input.path ?? ".")));
  const loaded = await loadConfig(root, input.config);
  const loadedConfig = { ...defaultConfig(), ...loaded.config };

  const gate = input.gate ? loadedConfig.gates?.[input.gate] : undefined;
  const missingExplicitGate =
    input.gate && !gate && input.gateAutoDetected !== true
      ? `Gate "${input.gate}" not found in configuration.`
      : undefined;

  if (missingExplicitGate) {
    loaded.errors.push(missingExplicitGate);
  }

  const config = gate ? applyGateRequirements(loadedConfig, gate) : loadedConfig;
  const options = normalizeOptions(cwd, root, config, input, gate, missingExplicitGate ? "critical" : undefined);
  const activeLogger = logger ?? createLogger(options.quiet ? "silent" : options.verbose ? "debug" : "info");

  return {
    cwd,
    root,
    config,
    options,
    logger: activeLogger,
    gate,
    missingExplicitGate,
    loaded,
  };
}

async function discoverPhase(ctx: PipelineContext) {
  const pluginLoad = await loadPlugins(ctx.root, ctx.config);
  const loadedWithPluginErrors = appendConfigErrors(ctx.loaded, pluginLoad.errors);
  const projects = await discoverConfiguredProjects(ctx.root, ctx.options);

  return {
    pluginLoad,
    loadedWithPluginErrors,
    projects,
  };
}

async function validatePhase(
  ctx: PipelineContext,
  loadedWithPluginErrors: LoadedConfig,
  projects: ProjectContext[],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  findings.push(
    ...configFindings(
      ctx.root,
      loadedWithPluginErrors,
      ctx.missingExplicitGate ? new Set([ctx.missingExplicitGate]) : undefined,
    ),
  );
  findings.push(...projectShapeFindings(projects));

  const activeRules = listRules().filter((rule) => {
    if (ctx.options.rules.length > 0 && !ctx.options.rules.includes(rule.meta.id)) {
      return false;
    }
    if (ctx.options.skips.includes(rule.meta.id)) {
      return false;
    }
    return true;
  });

  const projectFindings = await mapLimit(projects, ctx.options.concurrency, async (project) => {
    const projectConfig = configForProject(ctx.root, ctx.config, project);
    const override = projectConfig.projects?.[0];
    const variantMatch = override?.variants?.find((variant) => variant.name === ctx.options.variant);
    const context: RuleContext = {
      root: ctx.root,
      projects: [project],
      config: projectConfig,
      options: {
        ...ctx.options,
        mode: projectConfig.mode ?? ctx.options.mode,
        releaseMode: projectConfig.releaseMode ?? ctx.options.releaseMode,
        bom: variantMatch?.bom ?? override?.bom ?? ctx.options.bom,
        pinmap: override?.pinmap ?? ctx.options.pinmap,
      },
      logger: ctx.logger,
    };
    const output: Finding[] = [];
    for (const rule of activeRules) {
      const startedAt = performance.now();
      ctx.logger.debug("pipeline.rule.start", {
        rule: rule.meta.id,
        project: project.projectFile,
      });
      try {
        output.push(...(await rule.run(context)));
        ctx.logger.debug("pipeline.rule.finish", {
          rule: rule.meta.id,
          project: project.projectFile,
          latency_ms: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        ctx.logger.error("pipeline.rule.error", {
          rule: rule.meta.id,
          project: project.projectFile,
          latency_ms: Math.round(performance.now() - startedAt),
          error,
        });
        throw error;
      }
    }
    return output;
  });

  for (const group of projectFindings) {
    findings.push(...group);
  }

  return findings;
}

async function postProcessPhase(ctx: PipelineContext, findings: Finding[], projects: ProjectContext[]) {
  const gatedFindings = sortFindings([
    ...findings,
    ...gateRequirementFindings(findings, ctx.gate?.require ?? [], projects),
  ]);
  const sorted = await controlledFindings(ctx.root, ctx.config, ctx.options, gatedFindings);
  const waiverResult = applyWaivers(sorted, ctx.config.waivers ?? []);
  const effectiveFindings = waiverResult.findings;
  const fabrication = await captureFabricationSnapshot(ctx.root, projects, ctx.options, ctx.config);
  const readiness = await computeRunReadiness(
    ctx.root,
    ctx.config,
    ctx.options.failOn,
    effectiveFindings,
    ctx.options.releaseMode,
    waiverResult.expired.length,
  );
  const summary = summarizeFindings(effectiveFindings, ctx.options.failOn);

  const policy = ctx.config.policy
    ? evaluatePolicy(ctx.config.policy, {
        summary,
        readiness,
        ruleIds: [...new Set(effectiveFindings.map((finding) => finding.ruleId))],
        expiredWaivers: waiverResult.expired.length,
        staleWaivers: waiverResult.active.filter((waiver) => waiver.stale).length,
      })
    : undefined;

  return {
    effectiveFindings,
    fabrication,
    readiness,
    summary,
    waiverResult,
    policy,
  };
}

function assembleRunResult(
  ctx: PipelineContext,
  effectiveFindings: Finding[],
  fabrication: Awaited<ReturnType<typeof captureFabricationSnapshot>>,
  readiness: ReadinessScore,
  summary: ReturnType<typeof summarizeFindings>,
  waiverResult: ReturnType<typeof applyWaivers>,
  policy: ReturnType<typeof evaluatePolicy> | undefined,
  pluginLoad: Awaited<ReturnType<typeof loadPlugins>>,
  projects: ProjectContext[],
): RunResult {
  const bomRisk = bomRiskSummaryFromFindings(effectiveFindings);
  const releaseMode = ctx.options.releaseMode;
  return {
    schemaVersion: 1,
    tool: {
      name: "boardreadyops",
      version: boardReadyVersion,
    },
    ...(releaseMode ? { releaseMode } : {}),
    summary,
    readiness,
    ...(bomRisk ? { bomRisk } : {}),
    ...(policy ? { policy } : {}),
    ...(ctx.config.waivers && ctx.config.waivers.length > 0
      ? { waivers: { active: waiverResult.active, expired: waiverResult.expired } }
      : {}),
    projects,
    findings: effectiveFindings,
    fabrication,
    plugins: pluginLoad.plugins,
    generatedAt: new Date().toISOString(),
  };
}

async function dispatchNotificationsPhase(ctx: PipelineContext, result: RunResult) {
  return dispatchNotifications(
    ctx.config.notifiers,
    notificationPayloadFromResult(result, ctx.options.notificationLinks ?? {}),
    { logger: ctx.logger },
  );
}

function projectsLengthHint(input: Partial<PipelineOptions>): number | undefined {
  return input.project ? 1 : undefined;
}

export function registerPipelineRules(): void {
  registerBuiltInRules();
}

async function computeRunReadiness(
  root: string,
  config: BoardReadyOpsConfig,
  failOn: FailOn,
  findings: Finding[],
  releaseMode?: import("./config.types.js").ReleaseMode,
  expiredWaivers?: number,
): Promise<ReadinessScore> {
  const resolved = resolveVendorProfile(config.vendor);
  const presentOutputs = new Set<string>();
  for (const kind of VENDOR_OUTPUT_KINDS) {
    const files = await globFiles(root, VENDOR_OUTPUT_PATTERNS[kind]);
    if (files.length > 0) {
      presentOutputs.add(kind);
    }
  }
  return computeReadiness({
    ...(resolved
      ? { profile: { id: resolved.profile.id, name: resolved.profile.name, service: resolved.profile.service } }
      : {}),
    requiredOutputs: resolved?.requiredOutputs ?? [],
    recommendedOutputs: resolved?.recommendedOutputs ?? [],
    presentOutputs,
    findings,
    failOn,
    ...(releaseMode ? { releaseMode } : {}),
    ...(expiredWaivers !== undefined ? { expiredWaivers } : {}),
  });
}

async function controlledFindings(
  root: string,
  config: BoardReadyOpsConfig,
  options: PipelineOptions,
  findings: Finding[],
): Promise<Finding[]> {
  const suppressed = applySuppressions(findings, config.suppressions);
  if (options.ignoreBaseline || !config.baseline || config.baseline.mode === "all") {
    return suppressed;
  }
  const baseline = await readBaseline(resolveBaselinePath(root, config.baseline));
  return baseline ? applyBaseline(suppressed, baseline, config.baseline.mode) : suppressed;
}

export async function canonicalRoot(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return input;
  }
}

function normalizeOptions(
  cwd: string,
  root: string,
  config: BoardReadyOpsConfig,
  input: Partial<PipelineOptions>,
  gate?: GateConfig,
  forceFailOn?: FailOn,
): PipelineOptions {
  const gateRules = requiredGateRules(gate?.require ?? []);
  const inputRules = input.rules ?? [];
  return {
    cwd,
    path: root,
    project: input.project,
    config: input.config,
    mode: gate ? "enforce" : (input.mode ?? config.mode ?? "warn"),
    releaseMode: input.releaseMode ?? config.releaseMode,
    requireKicad: input.requireKicad ?? false,
    kicadCli: input.kicadCli,
    bom: input.bom,
    pinmap: input.pinmap,
    variant: input.variant,
    concurrency: input.concurrency ?? defaultConcurrency(),
    failOn: forceFailOn ?? gate?.["fail-on"] ?? input.failOn ?? config["fail-on"] ?? "high",
    gate: input.gate,
    gateAutoDetected: input.gateAutoDetected ?? false,
    rules: inputRules.length > 0 ? [...new Set([...inputRules, ...gateRules])] : [],
    skips: (input.skips ?? []).filter((ruleId) => !gateRules.includes(ruleId)),
    ignoreBaseline: input.ignoreBaseline ?? false,
    annotations: input.annotations ?? true,
    quiet: input.quiet ?? false,
    verbose: input.verbose ?? false,
    color: input.color ?? "auto",
    ...(input.notificationLinks ? { notificationLinks: input.notificationLinks } : {}),
  };
}

async function discoverConfiguredProjects(root: string, options: PipelineOptions) {
  if (options.project) {
    return discoverProjects(root, options.project);
  }
  return discoverProjects(root);
}

function applyGateRequirements(config: BoardReadyOpsConfig, gate: GateConfig): BoardReadyOpsConfig {
  const requiredRules = requiredGateRules(gate.require ?? []);
  const requiredOutputs = requiredManufacturingOutputs(gate.require ?? []);
  if (requiredRules.length === 0) {
    return config;
  }
  const rules = { ...config.rules };
  for (const ruleId of requiredRules) {
    rules[ruleId] = enableRule(rules[ruleId]);
  }
  const outputConfig = ruleObjectConfig(rules["manufacturing.outputs-present"]);
  const existingRequired = Array.isArray(outputConfig.required)
    ? outputConfig.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (requiredOutputs.length > 0) {
    rules["manufacturing.outputs-present"] = {
      ...outputConfig,
      enabled: true,
      required: [...new Set([...existingRequired, ...requiredOutputs])],
    };
  }
  return {
    ...config,
    rules,
  };
}

function appendConfigErrors(loaded: LoadedConfig, errors: string[]): LoadedConfig {
  if (errors.length === 0) {
    return loaded;
  }
  return {
    ...loaded,
    errors: [...loaded.errors, ...errors],
  };
}

function enableRule(ruleConfig: RuleConfig | boolean | undefined): RuleConfig {
  return {
    ...ruleObjectConfig(ruleConfig),
    enabled: true,
  };
}

function ruleObjectConfig(ruleConfig: RuleConfig | boolean | undefined): RuleConfig {
  return typeof ruleConfig === "object" && ruleConfig !== null ? ruleConfig : {};
}

function configForProject(root: string, config: BoardReadyOpsConfig, project: ProjectContext): BoardReadyOpsConfig {
  const override = config.projects?.find((candidate) => {
    const target = path.resolve(root, normalizePathInput(candidate.path));
    return target === path.resolve(root, project.root) || target === path.resolve(root, project.projectFile);
  });
  if (!override) {
    return {
      ...config,
      projects: [],
    };
  }
  const projectConfig: BoardReadyOpsConfig = {
    ...config,
    projects: [override],
  };
  if (override.mode) {
    projectConfig.mode = override.mode;
  }
  if (override.releaseMode) {
    projectConfig.releaseMode = override.releaseMode;
  }
  if (override.firmware) {
    projectConfig.firmware = {
      ...(config.firmware ?? {}),
      ...override.firmware,
      platformio: {
        ...(config.firmware?.platformio ?? {}),
        ...(override.firmware.platformio ?? {}),
      },
      arduino: {
        ...(config.firmware?.arduino ?? {}),
        ...(override.firmware.arduino ?? {}),
      },
      zephyr: {
        ...(config.firmware?.zephyr ?? {}),
        ...(override.firmware.zephyr ?? {}),
      },
      "esp-idf": {
        ...(config.firmware?.["esp-idf"] ?? {}),
        ...(override.firmware["esp-idf"] ?? {}),
      },
      stm32cubemx: {
        ...(config.firmware?.stm32cubemx ?? {}),
        ...(override.firmware.stm32cubemx ?? {}),
      },
    };
  }
  if (override.vendor) {
    projectConfig.vendor = {
      ...(config.vendor ?? {}),
      ...override.vendor,
      board: {
        ...(config.vendor?.board ?? {}),
        ...(override.vendor.board ?? {}),
      },
      assembly: {
        ...(config.vendor?.assembly ?? {}),
        ...(override.vendor.assembly ?? {}),
      },
    };
  }
  if (override.rules) {
    projectConfig.rules = mergeRules(config.rules, override.rules);
  }
  return projectConfig;
}

function mergeRules(
  rules: BoardReadyOpsConfig["rules"],
  overrides: NonNullable<NonNullable<BoardReadyOpsConfig["projects"]>[number]["rules"]>,
): NonNullable<BoardReadyOpsConfig["rules"]> {
  const merged = { ...(rules ?? {}) };
  for (const [id, override] of Object.entries(overrides)) {
    const current = merged[id];
    merged[id] =
      isRuleConfig(current) && isRuleConfig(override)
        ? {
            ...current,
            ...override,
          }
        : override;
  }
  return merged;
}

function isRuleConfig(value: RuleConfig | boolean | undefined): value is RuleConfig {
  return typeof value === "object" && value !== null;
}

function configFindings(root: string, loaded: LoadedConfig, criticalErrors = new Set<string>()): Finding[] {
  return loaded.errors.map((error) =>
    createFinding({
      ruleId: "config.invalid",
      severity: criticalErrors.has(error) ? "critical" : "high",
      message: `Configuration is invalid: ${error}`,
      resource: {
        path: loaded.path ? path.relative(root, loaded.path).replace(/\\/g, "/") : "boardreadyops.yml",
        kind: "manifest",
      },
      location: { line: 1, column: 1 },
      fix: {
        description: "Correct the BoardReadyOps configuration before checking the repository again.",
        steps: [
          "Review the reported configuration error.",
          "Update the configuration file.",
          "Run BoardReadyOps again.",
        ],
      },
      confidence: "definite",
    }),
  );
}

function projectShapeFindings(projects: Awaited<ReturnType<typeof discoverProjects>>): Finding[] {
  if (projects.length === 0) {
    return [
      createFinding({
        ruleId: "manifest.project-discovery",
        severity: "high",
        message: "No .kicad_pro project was found.",
        resource: { path: ".", kind: "manifest" },
        fix: {
          description: "Add a KiCad project file or point BoardReadyOps at the project to review.",
          steps: ["Confirm the repository contains a .kicad_pro file.", "Run BoardReadyOps with the project path."],
        },
        confidence: "definite",
      }),
    ];
  }
  const findings: Finding[] = [];
  for (const project of projects) {
    if (project.schematicFiles.length === 0) {
      findings.push(
        createFinding({
          ruleId: "manifest.project-discovery",
          severity: "high",
          message: `${project.projectFile} has no matching schematic file.`,
          project: project.projectFile,
          resource: { path: project.projectFile, kind: "project" },
          fix: {
            description: "Restore the schematic that belongs to this KiCad project.",
            steps: ["Check the project schematic path.", "Add or rename the matching .kicad_sch file."],
          },
          confidence: "definite",
        }),
      );
    }
    if (project.boardFiles.length === 0) {
      findings.push(
        createFinding({
          ruleId: "manifest.project-discovery",
          severity: "high",
          message: `${project.projectFile} has no matching board file.`,
          project: project.projectFile,
          resource: { path: project.projectFile, kind: "project" },
          fix: {
            description: "Restore the board file that belongs to this KiCad project.",
            steps: ["Check the project board path.", "Add or rename the matching .kicad_pcb file."],
          },
          confidence: "definite",
        }),
      );
    }
  }
  return findings;
}
