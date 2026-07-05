import path from "node:path";
import * as core from "@actions/core";
import type { PipelineOptions } from "../core/context.js";
import type { FailOn } from "../core/findings.js";
import { type LogFormat, type LogLevel, parseLogFormat, parseLogLevel } from "../core/logger.js";
import { isInside } from "../util/path.js";

export interface ActionInputs extends Partial<PipelineOptions> {
  outputs: {
    sarif?: string | undefined;
    json?: string | undefined;
    markdown?: string | undefined;
    hbom?: string | undefined;
  };
  uploadSarif: boolean;
  uploadArtifacts: boolean;
  commentPr: boolean;
  commentFormat: "report" | "review";
  artifactName: string;
  logLevel: LogLevel;
  logFormat: LogFormat;
  logFile?: string | undefined;
  logFileMaxBytes?: number | undefined;
  logFileRetention?: number | undefined;
}

export function readActionInputs(workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()): ActionInputs {
  const root = path.resolve(workspace);
  const gate = empty(core.getInput("gate"));
  return {
    cwd: root,
    path: workspacePath(root, core.getInput("path") || "."),
    project: optionalPath(root, core.getInput("project")),
    config: optionalPath(root, core.getInput("config") || "boardreadyops.yml"),
    mode: modeInput(core.getInput("mode") || "warn"),
    releaseMode: releaseModeInput(core.getInput("release-mode")),
    requireKicad: boolInput("require-kicad", false),
    kicadCli: empty(core.getInput("kicad-cli")),
    bom: bomInput(root, core.getInput("bom") || "auto"),
    pinmap: optionalPath(root, core.getInput("pinmap")),
    variant: empty(core.getInput("variant")),
    gate: gate ?? detectActionGate(process.env.GITHUB_EVENT_NAME ?? "", process.env.GITHUB_REF ?? ""),
    gateAutoDetected: !gate,
    failOn: failOnInput(core.getInput("fail-on") || "high"),
    annotations: boolInput("annotations", true),
    quiet: false,
    verbose: false,
    color: "never",
    rules: [],
    skips: [],
    outputs: {
      sarif: optionalPath(root, core.getInput("sarif")),
      json: optionalPath(root, core.getInput("json")),
      markdown: optionalPath(root, core.getInput("markdown")),
      hbom: optionalPath(root, core.getInput("hbom")),
    },
    uploadSarif: boolInput("upload-sarif", true),
    uploadArtifacts: boolInput("upload-artifacts", true),
    commentPr: boolInput("comment-pr", true),
    commentFormat: commentFormatInput(core.getInput("comment-format") || "report"),
    artifactName: artifactName(core.getInput("artifact-name") || "boardreadyops"),
    logLevel: logLevelInput(core.getInput("log-level") || process.env.BOARDREADY_LOG_LEVEL || "info"),
    logFormat: logFormatInput(core.getInput("log-format") || process.env.BOARDREADY_LOG_FORMAT || "text"),
    logFile: optionalPath(root, core.getInput("log-file") || process.env.BOARDREADY_LOG_FILE || ""),
    logFileMaxBytes: optionalPositiveInteger(
      core.getInput("log-file-max-bytes") || process.env.BOARDREADY_LOG_FILE_MAX_BYTES || "",
      "log-file-max-bytes",
    ),
    logFileRetention: optionalNonNegativeInteger(
      core.getInput("log-file-retention") || process.env.BOARDREADY_LOG_FILE_RETENTION || "",
      "log-file-retention",
    ),
  };
}

export function detectActionGate(event: string, ref: string): string {
  if (event === "pull_request" || event === "pull_request_target") {
    return "pull_request";
  }
  if (ref.startsWith("refs/tags/")) {
    return "release";
  }
  if (ref === "refs/heads/main") {
    return "main";
  }
  return "main";
}

function boolInput(name: string, fallback: boolean): boolean {
  const value = core.getInput(name);
  if (value.trim() === "") {
    return fallback;
  }
  if (/^(true|1|yes)$/i.test(value)) {
    return true;
  }
  if (/^(false|0|no)$/i.test(value)) {
    return false;
  }
  throw new Error(`Input ${name} must be true or false.`);
}

function modeInput(value: string): "warn" | "enforce" {
  if (value === "warn" || value === "enforce") {
    return value;
  }
  throw new Error("Input mode must be warn or enforce.");
}

function releaseModeInput(value: string): "prototype" | "pilot" | "production" | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (trimmed === "prototype" || trimmed === "pilot" || trimmed === "production") {
    return trimmed;
  }
  throw new Error("Input release-mode must be prototype, pilot, or production.");
}

function commentFormatInput(value: string): "report" | "review" {
  if (value === "report" || value === "review") {
    return value;
  }
  throw new Error("Input comment-format must be report or review.");
}

function failOnInput(value: string): FailOn {
  if (value === "critical" || value === "high" || value === "medium" || value === "low" || value === "never") {
    return value;
  }
  throw new Error("Input fail-on must be critical, high, medium, low, or never.");
}

function logLevelInput(value: string): LogLevel {
  return parseLogLevel(value, "log-level");
}

function logFormatInput(value: string): LogFormat {
  return parseLogFormat(value, "log-format");
}

function optionalPositiveInteger(value: string, name: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Input ${name} must be a positive integer.`);
  }
  return Number.parseInt(trimmed, 10);
}

function optionalNonNegativeInteger(value: string, name: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new Error(`Input ${name} must be a non-negative integer.`);
  }
  return Number.parseInt(trimmed, 10);
}

function workspacePath(workspace: string, value: string): string {
  const resolved = path.resolve(workspace, value);
  if (!isInside(workspace, resolved)) {
    throw new Error(`Input path must stay inside GITHUB_WORKSPACE: ${value}`);
  }
  return resolved;
}

function optionalPath(workspace: string, value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : workspacePath(workspace, trimmed);
}

function bomInput(workspace: string, value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "auto" ? trimmed || "auto" : workspacePath(workspace, trimmed);
}

function empty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function artifactName(value: string): string {
  if (value.trim() === "" || /[\\/]/.test(value)) {
    throw new Error("artifact-name must be a non-empty artifact name.");
  }
  return value.trim();
}
