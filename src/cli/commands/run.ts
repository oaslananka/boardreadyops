import fs from "node:fs";
import path from "node:path";
import { type Command, InvalidArgumentError } from "commander";
import { type LoadedConfig, loadConfig } from "../../core/config.js";
import type { PipelineOptions } from "../../core/context.js";
import { createFinding, type FailOn, type Finding, summarizeFindings } from "../../core/findings.js";
import { createLogger, type LogFormat, type LogLevel, parseLogFormat, parseLogLevel } from "../../core/logger.js";
import { canonicalRoot, runPipeline } from "../../core/pipeline.js";
import type { RunResult } from "../../core/result.js";
import { boardReadyVersion } from "../../generated/version.js";
import { resolveLocale, t } from "../../i18n/t.js";
import { detectKicadCli } from "../../kicad/cli.js";
import { emitAnnotations } from "../../report/annotations.js";
import { formatMarkdown } from "../../report/markdown.js";
import { normalizePathInput, normalizeRelative } from "../../util/path.js";
import { type OutputOptions, writeReports } from "../output.js";

type CliOutputFormat = "text" | "json";

export interface CommonCliOptions {
  config?: string;
  project?: string;
  mode?: "warn" | "enforce";
  releaseMode?: "prototype" | "pilot" | "production";
  requireKicad?: boolean;
  kicadCli?: string;
  bom?: string;
  pinmap?: string;
  variant?: string;
  concurrency?: number;
  gate?: string;
  sarif?: string | boolean;
  json?: string | boolean;
  markdown?: string | boolean;
  failOn?: FailOn;
  rule?: string[];
  skip?: string[];
  annotations?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: "auto" | "always" | "never";
  logFormat?: LogFormat;
  logLevel?: LogLevel;
  logFile?: string;
  logFileMaxBytes?: number;
  logFileRetention?: number;
  format?: CliOutputFormat;
  watch?: boolean;
}

export async function loadConfigOrReportErrors(
  root: string,
  configPath: string | undefined,
  streams: { stderr: NodeJS.WritableStream },
  locale: ReturnType<typeof resolveLocale> = resolveLocale(),
): Promise<LoadedConfig | undefined> {
  const loaded = await loadConfig(root, configPath);
  if (loaded.errors.length > 0) {
    for (const error of loaded.errors) {
      streams.stderr.write(`${t("cli.error.configuration", { error }, locale)}\n`);
    }
    return undefined;
  }
  return loaded;
}

export function pipelineInputFromCli(
  root: string,
  options: CommonCliOptions,
  annotations: boolean,
): Partial<PipelineOptions> & { cwd: string; path: string } {
  return {
    cwd: process.cwd(),
    path: root,
    project: options.project,
    config: options.config,
    mode: options.mode ?? "warn",
    releaseMode: options.releaseMode,
    requireKicad: options.requireKicad ?? false,
    kicadCli: options.kicadCli,
    bom: options.bom,
    pinmap: options.pinmap,
    variant: options.variant,
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    gate: options.gate,
    failOn: options.failOn ?? "high",
    rules: options.rule ?? [],
    skips: options.skip ?? [],
    annotations,
    quiet: options.quiet ?? false,
    verbose: options.verbose ?? false,
    color: options.color ?? "auto",
  };
}

export async function runCommand(
  pathInput: string | undefined,
  options: CommonCliOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
  commandName = "run",
): Promise<number> {
  const locale = resolveLocale();
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  const logger = createCliLogger(root, options, streams.stderr);
  const startedAt = performance.now();
  let exitCode = 4;
  const finish = (code: number) => {
    exitCode = code;
    return code;
  };
  logger.info("cli.command.start", {
    command: commandName,
    path: root,
  });
  try {
    const loaded = await loadConfig(root, options.config);
    if (loaded.errors.length > 0) {
      if (writesJsonToStdout(options)) {
        await writeDiagnosticReport(root, loaded, configErrorFindings(root, loaded), 2, streams, locale);
      } else {
        for (const error of loaded.errors) {
          streams.stderr.write(`${t("cli.error.configuration", { error }, locale)}\n`);
        }
      }
      return finish(2);
    }
    if (options.requireKicad) {
      const kicad = await detectKicadCli(options.kicadCli);
      if (!kicad.found) {
        if (writesJsonToStdout(options)) {
          await writeDiagnosticReport(root, loaded, [kicadMissingFinding()], 3, streams, locale);
        } else {
          streams.stderr.write(`${t("cli.error.environment.kicadMissing", {}, locale)}\n`);
        }
        return finish(3);
      }
    }
    const runOnce = async () => {
      let spinner: Spinner | undefined;
      if (options.quiet !== true) {
        spinner = new Spinner(streams.stderr, "Analyzing KiCad files...");
        spinner.start();
      }
      try {
        const result = await runPipeline(pipelineInputFromCli(root, options, options.annotations ?? true), logger);
        const resultExitCode = result.summary.failed ? 1 : 0;
        const cliResult = withCliStatus(result, resultExitCode);

        if (spinner) {
          spinner.stop(
            resultExitCode === 0 ? "✨ \x1b[32mPreflight Passed!\x1b[0m" : "❌ \x1b[31mPreflight Failed!\x1b[0m",
          );
        }

        await writeReports(cliResult, root, outputOptions(options), loaded, streams.stdout, locale);
        if (!hasExplicitReportOutput(options)) {
          streams.stdout.write(formatMarkdown(cliResult, [], undefined, locale));
        }
        if (options.annotations !== false) {
          emitAnnotations(cliResult.findings, streams.stderr);
        }
        return resultExitCode;
      } catch (err) {
        if (spinner) {
          spinner.stop("💥 \x1b[31mAnalysis Error!\x1b[0m");
        }
        throw err;
      }
    };

    if (options.watch) {
      if (options.quiet !== true) {
        streams.stdout.write(`\n👀 [Watch] Monitoring ${root} for changes... Press Ctrl+C to exit.\n\n`);
      }

      let isRunning = false;
      let pendingRun = false;
      let debounceTimer: NodeJS.Timeout | null = null;

      const executePipeline = async () => {
        if (isRunning) {
          pendingRun = true;
          return;
        }
        isRunning = true;
        try {
          await runOnce();
        } catch (err) {
          streams.stderr.write(`[Watch Error] ${err instanceof Error ? err.message : err}\n`);
        } finally {
          isRunning = false;
          if (pendingRun) {
            pendingRun = false;
            await executePipeline();
          }
        }
      };

      await executePipeline();

      const watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
        if (filename && isFileRelevant(filename)) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(executePipeline, 300);
        }
      });

      return new Promise<number>((resolve) => {
        const cleanup = () => {
          watcher.close();
          if (debounceTimer) clearTimeout(debounceTimer);
          resolve(0);
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
      });
    }

    return finish(await runOnce());
  } catch (error) {
    logger.error("cli.command.error", {
      command: commandName,
      path: root,
      latency_ms: Math.round(performance.now() - startedAt),
      error,
    });
    throw error;
  } finally {
    logger.info("cli.command.finish", {
      command: commandName,
      path: root,
      exit_code: exitCode,
      latency_ms: Math.round(performance.now() - startedAt),
    });
  }
}

class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private idx = 0;
  private isTTY: boolean;

  constructor(
    private stream: NodeJS.WritableStream,
    private text: string,
  ) {
    this.isTTY = "isTTY" in stream && (stream as { isTTY?: boolean }).isTTY === true;
  }

  start() {
    if (!this.isTTY) return;
    this.stream.write("\x1b[?25l"); // hide cursor
    this.timer = setInterval(() => {
      const frame = this.frames[this.idx % this.frames.length];
      this.idx++;
      this.stream.write(`\r\x1b[36m${frame}\x1b[0m ${this.text}`);
    }, 80);
  }

  stop(finalText: string) {
    if (!this.isTTY) {
      this.stream.write(`${finalText}\n`);
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream.write(`\r\x1b[K${finalText}\n`);
    this.stream.write("\x1b[?25h"); // show cursor
  }
}

function isFileRelevant(filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/");
  if (
    normalized.includes("/node_modules/") ||
    normalized.includes("/.git/") ||
    normalized.includes("/build/") ||
    normalized.includes("/dist/") ||
    normalized.includes("/coverage/") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith("build/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith("coverage/")
  ) {
    return false;
  }
  return (
    normalized.endsWith(".kicad_pro") ||
    normalized.endsWith(".kicad_sch") ||
    normalized.endsWith(".kicad_pcb") ||
    normalized.endsWith("boardreadyops.yml") ||
    normalized.endsWith("boardreadyops.yaml") ||
    normalized.endsWith(".csv") ||
    normalized.endsWith(".json")
  );
}

export function addCommonOptions(command: Command): Command {
  return command
    .option("--config <path>", "boardreadyops.yml location")
    .option("--watch", "watch files for changes and re-run checks")
    .option("--project <path>", "specific .kicad_pro")
    .option("--mode <mode>", "warn or enforce", "warn")
    .option("--release-mode <mode>", "prototype|pilot|production release context")
    .option("--require-kicad", "exit non-zero if kicad-cli missing")
    .option("--kicad-cli <path>", "explicit kicad-cli path")
    .option("--bom <path>", "BOM source path or auto")
    .option("--pinmap <path>", "pinmap file path")
    .option("--variant <name>", "KiCad variant name")
    .option("--concurrency <count>", "max projects to check in parallel", positiveInteger)
    .option("--gate <name>", "gate from boardreadyops.yml")
    .option("--sarif [path]", "write SARIF report")
    .option("--json [path]", "write JSON report")
    .option("--markdown [path]", "write Markdown report")
    .option("--fail-on <level>", "critical|high|medium|low|never", "high")
    .option("--rule <id>", "restrict to rule", collect, [])
    .option("--skip <id>", "skip rule", collect, [])
    .option("--no-annotations", "disable GitHub annotations")
    .option("--quiet", "suppress informational output")
    .option("--verbose", "verbose output")
    .option("--color <mode>", "auto|always|never", "auto")
    .option("--format <format>", "output format: text or json", outputFormatInput)
    .option("--log-format <format>", "text or json", logFormatInput)
    .option("--log-level <level>", "debug|info|warn|error|critical|silent", logLevelInput)
    .option("--log-file <path>", "write structured logs to a file")
    .option("--log-file-max-bytes <bytes>", "rotate log file after this many bytes", positiveInteger)
    .option("--log-file-retention <count>", "number of rotated log files to keep", nonNegativeInteger);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError(t("cli.error.concurrencyPositiveInteger"));
  }
  return Number.parseInt(value, 10);
}

function nonNegativeInteger(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new InvalidArgumentError("Value must be a non-negative integer.");
  }
  return Number.parseInt(value, 10);
}

function logFormatInput(value: string): LogFormat {
  try {
    return parseLogFormat(value, "log-format");
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "Invalid log-format.");
  }
}

function outputFormatInput(value: string): CliOutputFormat {
  if (value === "text" || value === "json") {
    return value;
  }
  throw new InvalidArgumentError("Output format must be text or json.");
}

function logLevelInput(value: string): LogLevel {
  try {
    return parseLogLevel(value, "log-level");
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "Invalid log-level.");
  }
}

function createCliLogger(root: string, options: CommonCliOptions, stream: NodeJS.WritableStream) {
  return createLogger({
    level: effectiveLogLevel(options),
    format: options.logFormat ?? envLogFormat(),
    stream,
    projectRoot: root,
    logFile: resolveOptionalPath(root, options.logFile ?? process.env.BOARDREADY_LOG_FILE),
    maxFileBytes: options.logFileMaxBytes ?? envPositiveInteger("BOARDREADY_LOG_FILE_MAX_BYTES") ?? undefined,
    retention: options.logFileRetention ?? envNonNegativeInteger("BOARDREADY_LOG_FILE_RETENTION") ?? undefined,
  });
}

function effectiveLogLevel(options: CommonCliOptions): LogLevel {
  if (options.logLevel) {
    return options.logLevel;
  }
  const envLevel = process.env.BOARDREADY_LOG_LEVEL?.trim();
  if (envLevel) {
    return parseLogLevel(envLevel, "BOARDREADY_LOG_LEVEL");
  }
  if (options.quiet) {
    return "silent";
  }
  if (options.verbose) {
    return "debug";
  }
  return "info";
}

function envLogFormat(): LogFormat {
  const value = process.env.BOARDREADY_LOG_FORMAT?.trim();
  return value ? parseLogFormat(value, "BOARDREADY_LOG_FORMAT") : "text";
}

function envPositiveInteger(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number.parseInt(value, 10);
}

function envNonNegativeInteger(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number.parseInt(value, 10);
}

function resolveOptionalPath(root: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(root, normalizePathInput(trimmed)) : undefined;
}

function outputOptions(options: CommonCliOptions): OutputOptions {
  return {
    json: writesJsonToStdout(options) ? "-" : optionPath(options.json, "boardreadyops.findings.json"),
    sarif: optionPath(options.sarif, "boardreadyops.sarif.json"),
    markdown: optionPath(options.markdown, "boardreadyops.report.md"),
  };
}

function optionPath(value: string | boolean | undefined, fallback: string): string | undefined {
  if (value === true) {
    return fallback;
  }
  return typeof value === "string" ? value : undefined;
}

function hasExplicitReportOutput(options: CommonCliOptions): boolean {
  return Boolean(writesJsonToStdout(options) || options.json || options.sarif || options.markdown);
}

function writesJsonToStdout(options: CommonCliOptions): boolean {
  return options.format === "json";
}

async function writeDiagnosticReport(
  root: string,
  loaded: LoadedConfig,
  findings: Finding[],
  exitCode: number,
  streams: { stdout: NodeJS.WritableStream },
  locale: ReturnType<typeof resolveLocale>,
): Promise<void> {
  await writeReports(diagnosticResult(findings, exitCode), root, { json: "-" }, loaded, streams.stdout, locale);
}

function diagnosticResult(findings: Finding[], exitCode: number): RunResult {
  return withCliStatus(
    {
      schemaVersion: 1,
      tool: { name: "boardreadyops", version: boardReadyVersion },
      summary: summarizeFindings(findings, "low"),
      projects: [],
      findings,
      fabrication: { bom: [], outputs: [] },
      generatedAt: new Date().toISOString(),
    },
    exitCode,
  );
}

function withCliStatus(result: RunResult, exitCode: number): RunResult {
  return {
    ...result,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
  };
}

function configErrorFindings(root: string, loaded: LoadedConfig): Finding[] {
  return loaded.errors.map((error) =>
    createFinding({
      ruleId: "config.invalid",
      severity: "high",
      message: `Configuration is invalid: ${error}`,
      resource: { path: loaded.path ? normalizeRelative(root, loaded.path) : "boardreadyops.yml", kind: "manifest" },
      location: { line: 1, column: 1 },
      confidence: "definite",
    }),
  );
}

function kicadMissingFinding(): Finding {
  return createFinding({
    ruleId: "environment.kicad-missing",
    severity: "high",
    message: "KiCad CLI is required but was not found.",
    resource: { path: ".", kind: "manifest" },
    confidence: "definite",
    fix: {
      description: "Install KiCad CLI or pass --kicad-cli with a supported executable path.",
      steps: ["Install KiCad.", "Confirm kicad-cli is on PATH.", "Run BoardReadyOps again."],
    },
  });
}
