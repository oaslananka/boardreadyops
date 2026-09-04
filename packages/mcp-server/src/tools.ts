import type { CliRunner, CliRunResult } from "./cli-runner.ts";

type FailOn = "critical" | "high" | "medium" | "low" | "never";

export interface CheckToolInput {
  path?: string | undefined;
  config?: string | undefined;
  failOn?: FailOn | undefined;
}

export interface PlanToolInput {
  path?: string | undefined;
  config?: string | undefined;
  failOn?: FailOn | undefined;
}

export interface VerifyBundleToolInput {
  bundleDir: string;
  trustedKey?: string | undefined;
}

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string; exitCode: number };

function parseCliJsonOutput(run: CliRunResult, commandLabel: string): ToolResult {
  const trimmed = run.stdout.trim();
  if (trimmed) {
    try {
      return { ok: true, result: JSON.parse(trimmed) };
    } catch {
      // Fall through to the error path below -- stdout was not valid JSON.
    }
  }
  const stderrMessage = run.stderr.trim();
  return {
    ok: false,
    error: stderrMessage || `${commandLabel} exited with code ${run.exitCode} and no parseable output`,
    exitCode: run.exitCode,
  };
}

/** Runs the full hardware validation pipeline and returns structured findings. Read-only. */
export async function runCheckTool(input: CheckToolInput, runCli: CliRunner): Promise<ToolResult> {
  const args = ["check", "--format", "json"];
  if (input.config) args.push("--config", input.config);
  if (input.failOn) args.push("--fail-on", input.failOn);
  args.push(input.path ?? ".");
  const run = await runCli(args);
  return parseCliJsonOutput(run, "boardreadyops check");
}

/**
 * Returns an ordered remediation plan with fix strategies, safeAutoFixPossible flags, and
 * verification commands. Read-only -- `boardreadyops plan` never modifies the project.
 */
export async function runPlanTool(input: PlanToolInput, runCli: CliRunner): Promise<ToolResult> {
  const args = ["plan"];
  if (input.config) args.push("--config", input.config);
  if (input.failOn) args.push("--fail-on", input.failOn);
  args.push(input.path ?? ".");
  const run = await runCli(args);
  return parseCliJsonOutput(run, "boardreadyops plan");
}

/**
 * Verifies the cryptographic integrity (SHA-256 checksums, and an Ed25519 signature when a
 * trusted public key is supplied) of an offline evidence bundle. Read-only.
 */
export async function runVerifyBundleTool(input: VerifyBundleToolInput, runCli: CliRunner): Promise<ToolResult> {
  const args = ["release", "verify", "--format", "json"];
  if (input.trustedKey) args.push("--public-key", input.trustedKey);
  args.push(input.bundleDir);
  const run = await runCli(args);
  return parseCliJsonOutput(run, "boardreadyops release verify");
}
