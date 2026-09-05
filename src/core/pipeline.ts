import fs from "node:fs/promises";
import path from "node:path";
import { boardReadyVersion } from "../generated/version.js";
import { dispatchNotifications, notificationPayloadFromResult } from "../notifiers/dispatch.js";
import { registerBuiltInRules } from "../rules/_index.js";
import { loadBomContext } from "../rules/bom/shared.js";
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
import { type ProjectBom, projectBomComponent, type RunResult } from "./result.js";
import { categorizeFindings, checkRuleCapabilities, listRules } from "./rule-registry.js";
import { applySuppressions } from "./suppressions.js";
import { applyWaivers, type FalsePositiveSignal } from "./waivers.js";

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
  input.signal?.throwIfAborted();
  registerPipelineRules();

  // 1. Initialization Phase
  const ctx = await initializePipelineContext(input, logger);
  ctx.options.signal?.throwIfAborted();
  const pipelineStart = performance.now();
  ctx.logger.debug("pipeline.start", {
    path: ctx.root,
    project_count: projectsLengthHint(input),
  });

  // 2. Discovery Phase
  const { pluginLoad, loadedWithPluginErrors, projects } = await discoverPhase(ctx);
  ctx.options.signal?.throwIfAborted();

  // 3. Validation Phase
  const findings = await validatePhase(ctx, loadedWithPluginErrors, projects);
  ctx.options.signal?.throwIfAborted();

  // 4. Post-processing Phase
  const postProcessed = await postProcessPhase(ctx, findings, projects);
  ctx.options.signal?.throwIfAborted();

  // 5. Dispatch Phase
  const result = assembleRunResult({
    ctx,
    effectiveFindings: postProcessed.effectiveFindings,
    fabrication: postProcessed.fabrication,
    readiness: postProcessed.readiness,
    summary: postProcessed.summary,
    waiverResult: postProcessed.waiverResult,
    policy: postProcessed.policy,
    pluginLoad,
    projects,
    boms: postProcessed.boms,
  });
  const notificationResults = await dispatchNotificationsPhase(ctx, result);
  ctx.options.signal?.throwIfAborted();

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
  let logLevel: "silent" | "debug" | "info" = "info";
  if (options.quiet) {
    logLevel = "silent";
  } else if (options.verbose) {
    logLevel = "debug";
  }
  const activeLogger = logger ?? createLogger(logLevel);

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
  const pluginLoad =
    ctx.options.executionPolicy === "safe"
      ? { specifiers: [], plugins: [], errors: [] }
      : await loadPlugins(ctx.root, ctx.config);
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
  const findings: Finding[] = [
    ...configFindings(
      ctx.root,
      loadedWithPluginErrors,
      ctx.missingExplicitGate ? new Set([ctx.missingExplicitGate]) : undefined,
    ),
    ...projectShapeFindings(projects),
  ];

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
    ctx.options.signal?.throwIfAborted();
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
      ctx.options.signal?.throwIfAborted();
      const capCheck = checkRuleCapabilities(rule, project.capabilities);
      if (!capCheck.allowed) {
        output.push(
          createFinding({
            ruleId: rule.meta.id,
            severity: "info",
            project: project.projectFile,
            message: `Status: Unchecked · Reason: ${capCheck.reason}`,
            resource: {
              path: project.projectFile,
              kind: "project",
            },
            details: {
              status: "Unchecked",
              reason: capCheck.reason,
              skipped: true,
            },
          }),
        );
        continue;
      }

      const startedAt = performance.now();
      ctx.logger.debug("pipeline.rule.start", {
        rule: rule.meta.id,
        project: project.projectFile,
      });
      const ruleConf = projectConfig.rules?.[rule.meta.id] ?? ctx.config.rules?.[rule.meta.id];
      const ruleTimeout =
        typeof ruleConf === "object" &&
        ruleConf !== null &&
        typeof ruleConf.timeout === "number" &&
        ruleConf.timeout > 0
          ? ruleConf.timeout
          : undefined;

      try {
        let rulePromise = Promise.resolve(rule.run(context));
        if (ruleTimeout !== undefined) {
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Rule "${rule.meta.id}" timed out after ${ruleTimeout}ms.`));
            }, ruleTimeout);
            timeoutHandle.unref?.();
          });
          rulePromise = Promise.race([rulePromise, timeoutPromise]).finally(() => {
            if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
          });
        }
        output.push(...(await rulePromise));
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

/**
 * Emits one structured log event per finding waived with a "false positive"-worded reason,
 * enriched with the waiving rule's category/evidenceType (src/core/rule-registry.ts) so
 * false-positive rate becomes queryable per rule category/evidence-type from the logs.
 */
function logFalsePositiveSignals(ctx: PipelineContext, signals: FalsePositiveSignal[]): void {
  if (signals.length === 0) {
    return;
  }
  const metaById = new Map(listRules().map((rule) => [rule.meta.id, rule.meta]));
  for (const signal of signals) {
    const meta = metaById.get(signal.ruleId);
    ctx.logger.info("pipeline.waiver.false-positive", {
      rule: signal.ruleId,
      category: meta?.category,
      evidenceType: meta?.evidenceType,
      fingerprint: signal.findingFingerprint,
      reason: signal.reason,
    });
  }
}

async function postProcessPhase(ctx: PipelineContext, findings: Finding[], projects: ProjectContext[]) {
  const gatedFindings = sortFindings([
    ...findings,
    ...gateRequirementFindings(findings, ctx.gate?.require ?? [], projects),
  ]);
  const sorted = await controlledFindings(ctx.root, ctx.config, ctx.options, gatedFindings);
  const waiverResult = applyWaivers(sorted, ctx.config.waivers ?? []);
  logFalsePositiveSignals(ctx, waiverResult.falsePositiveSignals);
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
  const boms = await resolveProjectBoms(ctx, projects);

  const policy = ctx.config.policy
    ? evaluatePolicy(ctx.config.policy, {
        summary,
        readiness,
        ruleIds: [...new Set(effectiveFindings.map((finding) => finding.ruleId))],
        expiredWaivers: waiverResult.expired.length,
        staleWaivers: waiverResult.active.filter((waiver) => waiver.stale).length,
      })
    : undefined;

  return { effectiveFindings, fabrication, readiness, summary, waiverResult, policy, boms };
}

/**
 * Resolves the component rows for each discovered project.
 *
 * Reuses `loadBomContext` so the emitted rows are exactly the ones the BOM rules evaluated,
 * including their CSV-over-schematic precedence. A project with no resolvable BOM keeps an
 * empty entry rather than disappearing: absence of component data is itself a signal, and a
 * missing board would silently drop out of downstream supply tracking.
 */
/** The workspace-level `--bom` when the caller named a real path rather than leaving it automatic. */
function explicitWorkspaceBom(options: PipelineOptions): string | undefined {
  return options.bom && options.bom !== "auto" ? options.bom : undefined;
}

/**
 * Finds a BOM file inside a project's own directory.
 *
 * Board attribution may only use a BOM the project can claim. The rules' shared resolver
 * searches the whole workspace, which is correct for a single-board repository but would
 * hand one board's CSV to every other board in a hardware monorepo.
 */
async function bomWithinProject(root: string, project: ProjectContext): Promise<string | undefined> {
  const projectDirectory = project.projectFile.split("/").slice(0, -1).join("/");
  const prefix = projectDirectory.length > 0 ? `${projectDirectory}/` : "";
  const found = await globFiles(root, [
    `${prefix}**/bom*.csv`,
    `${prefix}**/*bom*.csv`,
    `${prefix}**/bom*.tsv`,
    `${prefix}**/*bom*.tsv`,
  ]);
  const first = found[0];
  if (!first) return undefined;
  const relative = path.relative(root, first).split(path.sep).join("/");
  return relative.startsWith("..") ? undefined : relative;
}

async function resolveProjectBoms(ctx: PipelineContext, projects: ProjectContext[]): Promise<ProjectBom[]> {
  const boms: ProjectBom[] = [];
  for (const project of projects) {
    // Resolve the same per-project config and BOM override the rules ran under, so a
    // workspace with project-local `bom:` entries attributes the right file to each board.
    const projectConfig = configForProject(ctx.root, ctx.config, project);
    const override = projectConfig.projects?.[0];
    const variantMatch = override?.variants?.find((variant) => variant.name === ctx.options.variant);
    const declaredBom = variantMatch?.bom ?? override?.bom ?? explicitWorkspaceBom(ctx.options);
    const attributableBom = declaredBom ?? (await bomWithinProject(ctx.root, project));
    const scoped: RuleContext = {
      root: ctx.root,
      projects: [project],
      config: projectConfig,
      options: { ...ctx.options, bom: attributableBom ?? ctx.options.bom },
      logger: ctx.logger,
    };
    try {
      const { bomRows, schematicRows } = await loadBomContext(scoped);
      // Without a BOM this project can claim, any rows discovered came from a workspace-wide
      // search and may belong to a different board. Attributing them here would report parts
      // this board does not contain, so fall back to its own schematic instead.
      const resolved = attributableBom && bomRows.length > 0 ? bomRows : schematicRows;
      boms.push({ project: project.projectFile, components: resolved.map(projectBomComponent) });
    } catch (error) {
      // Snapshot collection must never fail a run that is not about the BOM. An unreadable
      // or stale configured BOM path is reported by the BOM rules when they are enabled;
      // here it degrades to an empty component list.
      ctx.logger.debug("pipeline.bom.unresolved", {
        project: project.projectFile,
        reason: error instanceof Error ? error.message : String(error),
      });
      boms.push({ project: project.projectFile, components: [] });
    }
  }
  return boms;
}

interface AssembleRunResultOptions {
  ctx: PipelineContext;
  effectiveFindings: Finding[];
  fabrication: Awaited<ReturnType<typeof captureFabricationSnapshot>>;
  readiness: ReadinessScore;
  summary: ReturnType<typeof summarizeFindings>;
  waiverResult: ReturnType<typeof applyWaivers>;
  policy: ReturnType<typeof evaluatePolicy> | undefined;
  boms: ProjectBom[];
  pluginLoad: Awaited<ReturnType<typeof loadPlugins>>;
  projects: ProjectContext[];
}

function assembleRunResult({
  ctx,
  effectiveFindings,
  fabrication,
  readiness,
  summary,
  waiverResult,
  policy,
  pluginLoad,
  projects,
  boms,
}: AssembleRunResultOptions): RunResult {
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
    categoryBreakdown: categorizeFindings(effectiveFindings),
    readiness,
    ...(bomRisk ? { bomRisk } : {}),
    ...(policy ? { policy } : {}),
    ...(ctx.config.waivers && ctx.config.waivers.length > 0
      ? { waivers: { active: waiverResult.active, expired: waiverResult.expired } }
      : {}),
    projects,
    boms,
    findings: effectiveFindings,
    fabrication,
    plugins: pluginLoad.plugins,
    generatedAt: new Date().toISOString(),
  };
}

async function dispatchNotificationsPhase(ctx: PipelineContext, result: RunResult) {
  if (ctx.options.executionPolicy === "safe") {
    ctx.logger.info("pipeline.execution.restricted", {
      plugins: "disabled",
      notifications: "disabled",
    });
    return [];
  }
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
    executionPolicy: input.executionPolicy ?? "standard",
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
    ...(input.signal ? { signal: input.signal } : {}),
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

type RuleConfigInput = RuleConfig | boolean | undefined;

function enableRule(ruleConfig: RuleConfigInput): RuleConfig {
  return {
    ...ruleObjectConfig(ruleConfig),
    enabled: true,
  };
}

function ruleObjectConfig(ruleConfig: RuleConfigInput): RuleConfig {
  return typeof ruleConfig === "object" && ruleConfig !== null ? ruleConfig : emptyObj;
}

const emptyObj: Record<string, never> = Object.freeze({});

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
    const cf = config.firmware;
    const of = override.firmware;
    projectConfig.firmware = {
      ...(cf ?? emptyObj),
      ...of,
      platformio: {
        ...(cf?.platformio ?? emptyObj),
        ...(of.platformio ?? emptyObj),
      },
      arduino: {
        ...(cf?.arduino ?? emptyObj),
        ...(of.arduino ?? emptyObj),
      },
      zephyr: {
        ...(cf?.zephyr ?? emptyObj),
        ...(of.zephyr ?? emptyObj),
      },
      "esp-idf": {
        ...(cf?.["esp-idf"] ?? emptyObj),
        ...(of["esp-idf"] ?? emptyObj),
      },
      stm32cubemx: {
        ...(cf?.stm32cubemx ?? emptyObj),
        ...(of.stm32cubemx ?? emptyObj),
      },
    };
  }
  if (override.vendor) {
    const cv = config.vendor;
    const ov = override.vendor;
    projectConfig.vendor = {
      ...(cv || undefined),
      ...ov,
      board: cv?.board || ov.board ? { ...cv?.board, ...ov.board } : undefined,
      assembly: cv?.assembly || ov.assembly ? { ...cv?.assembly, ...ov.assembly } : undefined,
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
  const merged = { ...(rules ?? emptyObj) };
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
        path: loaded.path ? path.relative(root, loaded.path).replaceAll("\\", "/") : "boardreadyops.yml",
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
