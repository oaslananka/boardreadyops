import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathExists } from "../util/fs.js";
import { runProcess } from "../util/process.js";
import { redactControlCharacters } from "../util/strings.js";
import { type KicadDiagnostic, parseKicadDiagnostics } from "./parsers/drc-report.js";
import { defaultKicadCliCandidates } from "./paths.js";
import { parseKicadMajor } from "./version.js";

export interface KicadCli {
  found: boolean;
  path?: string;
  version?: string;
}

export type KicadReportKind = "drc" | "erc";

export interface KicadReportOptions {
  variant?: string;
  version?: string;
  signal?: AbortSignal;
}

export interface KicadCliReportCapabilities {
  defineVariables: boolean;
  drcSchematicParity: boolean;
  drcRefillZones: boolean;
  severityAll: boolean;
  severityExclusions: boolean;
  exitCodeViolations: boolean;
}

export async function detectKicadCli(explicit?: string, signal?: AbortSignal): Promise<KicadCli> {
  const candidates = explicit && explicit.trim() !== "" ? [explicit] : defaultKicadCliCandidates();
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !(await pathExists(candidate))) {
      continue;
    }
    const version = await runProcess(candidate, ["version"], {
      timeoutMs: 10_000,
      maxStderrBytes: 64 * 1024,
      ...(signal ? { signal } : {}),
    });
    if (version.code === 0) {
      return {
        found: true,
        path: candidate,
        version: redactControlCharacters(version.stdout || version.stderr).trim(),
      };
    }
    const dashed = await runProcess(candidate, ["--version"], {
      timeoutMs: 10_000,
      maxStderrBytes: 64 * 1024,
      ...(signal ? { signal } : {}),
    });
    if (dashed.code === 0) {
      return { found: true, path: candidate, version: redactControlCharacters(dashed.stdout || dashed.stderr).trim() };
    }
  }
  return { found: false };
}

export async function runKicadReport(
  cliPath: string,
  kind: KicadReportKind,
  inputFile: string,
  options: KicadReportOptions = {},
): Promise<{ status: "passed" | "failed"; diagnostics: KicadDiagnostic[]; error?: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-"));
  const output = path.join(tempDir, `${kind}.json`);
  const args = kicadReportArgs(kind, output, inputFile, options);
  const result = await runProcess(cliPath, args, {
    timeoutMs: 120_000,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  let reportText = "";
  try {
    reportText = await fs.readFile(output, "utf8");
  } catch {
    reportText = "";
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
  try {
    const diagnostics = parseKicadDiagnostics(reportText, kind);
    if (result.code === 0) {
      return { status: diagnostics.length > 0 ? "failed" : "passed", diagnostics };
    }
    if (diagnostics.length > 0) {
      return { status: "failed", diagnostics };
    }
  } catch {
    // Fall through to textual error.
  }
  const outputText = redactControlCharacters(`${result.stdout}\n${result.stderr}\n${reportText}`).trim();
  return {
    status: result.code === 0 ? "passed" : "failed",
    diagnostics: [],
    error: result.timedOut ? `${kind.toUpperCase()} timed out` : outputText,
  };
}

export function kicadReportArgs(
  kind: KicadReportKind,
  output: string,
  inputFile: string,
  options: KicadReportOptions = {},
): string[] {
  const capabilities = kicadCliReportCapabilities(options.version);
  const args = kind === "drc" ? ["pcb", "drc"] : ["sch", "erc"];
  args.push("--format", "json", "--output", output);
  if (capabilities.defineVariables && options.variant?.trim()) {
    args.push("--define-var", `BOARDREADYOPS_VARIANT=${options.variant.trim()}`);
  }
  if (capabilities.severityAll) {
    args.push("--severity-all");
  }
  if (capabilities.severityExclusions) {
    args.push("--severity-exclusions");
  }
  if (capabilities.exitCodeViolations) {
    args.push("--exit-code-violations");
  }
  if (kind === "drc" && capabilities.drcSchematicParity) {
    args.push("--schematic-parity");
  }
  if (kind === "drc" && capabilities.drcRefillZones) {
    args.push("--refill-zones");
  }
  args.push(inputFile);
  return args;
}

export function kicadCliReportCapabilities(version?: string): KicadCliReportCapabilities {
  const major = version ? parseKicadMajor(version) : undefined;
  return {
    defineVariables: major === undefined || major >= 9,
    drcSchematicParity: major === undefined || major >= 9,
    drcRefillZones: major !== undefined && major >= 10,
    severityAll: major === undefined || major >= 9,
    severityExclusions: major === undefined || major >= 9,
    exitCodeViolations: major === undefined || major >= 9,
  };
}
