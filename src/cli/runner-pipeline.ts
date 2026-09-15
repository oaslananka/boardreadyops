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
  options: { requireKicad: boolean; signal?: AbortSignal },
): Promise<RunnerExecutionOutput> {
  options.signal?.throwIfAborted();
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
      executionPolicy: job.safeMode.enabled ? "safe" : "standard",
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
    options.signal ? { signal: options.signal } : {},
  );
  options.signal?.throwIfAborted();
  const report = await readRunReport(path.join(workspace, targets[0].relative));
  const runnerReport = report ? runnerReportFromResult(report) : undefined;
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

/**
 * Maps a parsed run report onto the runner's terminal-result payload.
 *
 * Exported so the mapping has a test seam. It previously lived inline as an object literal and
 * silently omitted `result.boms`: the data was produced, written to disk and read back, and then
 * dropped here, so `board_bom_snapshots` was never written and `resolveAffectedBoards` had no
 * input even though the contract, the route and the migration were all in place. A field-by-field
 * literal with no test is how that survives. See #800.
 */
export function runnerReportFromResult(report: RunResult): NonNullable<RunnerExecutionOutput["report"]> {
  return {
    summary: {
      total: report.summary.total,
      critical: report.summary.critical,
      high: report.summary.high,
      medium: report.summary.medium,
      low: report.summary.low,
      info: report.summary.info,
    },
    ...(report.readiness
      ? {
          readiness: {
            score: report.readiness.score,
            status: report.readiness.status,
            blocking: report.readiness.blocking,
            nonBlocking: report.readiness.nonBlocking,
            missingRequired: report.readiness.missingRequired,
            missingRecommended: report.readiness.missingRecommended,
            warnings: report.readiness.warnings,
          },
        }
      : {}),
    ...(report.waivers ? { waivers: report.waivers } : {}),
    // Both of these were available on the parsed report and simply not copied, so the
    // runner never sent them: board_bom_snapshots stayed empty and resolveAffectedBoards
    // had no input, despite the contract, the route and the migration all being in place.
    // Neither key is part of normalizedResultForDigest, so sending them does not change a
    // terminal result digest or affect replay detection. See #800.
    ...(report.boms?.length ? { boms: report.boms } : {}),
    ...(report.firmware?.dependencies.length ? { firmware: report.firmware } : {}),
    findings: report.findings.map((finding) => {
      const startLine = finding.location?.region?.startLine ?? finding.location?.line;
      const endLine = finding.location?.region?.endLine ?? startLine;
      return {
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        resource: {
          ...(finding.resource.path === undefined ? {} : { path: finding.resource.path }),
        },
        fingerprint: finding.fingerprint,
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
        ...(finding.location?.region?.startColumn !== undefined
          ? { startColumn: finding.location.region.startColumn }
          : {}),
        ...(finding.location?.region?.endColumn !== undefined ? { endColumn: finding.location.region.endColumn } : {}),
      };
    }),
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
