import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";
import type { RunResult } from "../core/result.js";
import type { RunnerExecutionArtifact, RunnerExecutionOutput } from "../runner/worker.js";
import { runCommand } from "./commands/run.js";

export async function executeRunnerPipeline(
  workspace: string,
  job: RunnerClaimedJob,
  options: { requireKicad: boolean },
): Promise<RunnerExecutionOutput> {
  const relativeOutputDirectory = path.join(".boardreadyops-runner", job.executionAttemptId);
  const outputDirectory = path.join(workspace, relativeOutputDirectory);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const targets = [
    {
      kind: "report/json",
      name: "boardreadyops-result.json",
      role: "primary",
      relative: path.join(relativeOutputDirectory, "result.json"),
    },
    {
      kind: "report/sarif",
      name: "boardreadyops-result.sarif",
      role: "sarif",
      relative: path.join(relativeOutputDirectory, "result.sarif"),
    },
    {
      kind: "report/markdown",
      name: "boardreadyops-result.md",
      role: "summary",
      relative: path.join(relativeOutputDirectory, "result.md"),
    },
  ] as const;
  const output = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const exitCode = await runCommand(
    workspace,
    {
      mode: "enforce",
      requireKicad: options.requireKicad,
      failOn: "high",
      json: targets[0].relative,
      sarif: targets[1].relative,
      markdown: targets[2].relative,
      annotations: false,
      quiet: true,
      color: "never",
      logLevel: "silent",
    },
    { stdout: output, stderr: output },
    "runner",
  );
  const report = await readRunReport(path.join(workspace, targets[0].relative));
  const runnerReport = report
    ? {
        summary: {
          total: report.summary.total,
          critical: report.summary.critical,
          high: report.summary.high,
          medium: report.summary.medium,
          low: report.summary.low,
          info: report.summary.info,
        },
        findings: report.findings.map((finding) => ({
          ruleId: finding.ruleId,
          severity: finding.severity,
          message: finding.message,
          resource: {
            ...(finding.resource.path === undefined ? {} : { path: finding.resource.path }),
          },
        })),
      }
    : undefined;
  const artifacts: RunnerExecutionArtifact[] = [];
  for (const target of targets) {
    const filePath = path.join(workspace, target.relative);
    const artifact = await runnerArtifact(filePath, target.kind, target.name, target.role).catch(() => undefined);
    if (artifact) artifacts.push(artifact);
  }
  return {
    exitCode,
    ...(runnerReport === undefined ? {} : { report: runnerReport }),
    artifacts,
  };
}

async function runnerArtifact(
  filePath: string,
  kind: string,
  name: string,
  role: string,
): Promise<RunnerExecutionArtifact> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size > 2_147_483_647) throw new Error(`runner artifact is invalid: ${filePath}`);
  const content = await readFile(filePath);
  return {
    kind,
    name,
    role,
    filePath,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function readRunReport(filePath: string): Promise<RunResult | undefined> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as RunResult;
    return value.schemaVersion === 1 && value.tool?.name === "boardreadyops" && Array.isArray(value.findings)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
