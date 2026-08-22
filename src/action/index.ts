import fs from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { createLogger, type Logger } from "../core/logger.js";
import { runPipeline } from "../core/pipeline.js";
import type { RunResult } from "../core/result.js";
import { emitAnnotations } from "../report/annotations.js";
import { formatHbom } from "../report/hbom.js";
import { formatJson } from "../report/json.js";
import { formatMarkdown } from "../report/markdown.js";
import { formatSarif } from "../report/sarif.js";
import { writeTextFile } from "../util/fs.js";
import { upsertPullRequestComment } from "./comment.js";
import { buildActionHardwareImpact } from "./hardware-impact.js";
import { readActionInputs } from "./inputs.js";
import { setActionOutputs } from "./outputs.js";
import { uploadArtifacts, uploadSarif } from "./upload.js";

export async function runAction(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  await ensureRunnerFile(process.env.GITHUB_OUTPUT);
  await ensureRunnerFile(process.env.GITHUB_STEP_SUMMARY);
  const inputs = readActionInputs(workspace);
  const logger = createLogger({
    level: inputs.logLevel,
    format: inputs.logFormat,
    stream: process.stderr,
    projectRoot: workspace,
    logFile: inputs.logFile,
    maxFileBytes: inputs.logFileMaxBytes,
    retention: inputs.logFileRetention,
  });
  const startedAt = performance.now();
  logger.info("action.start", {
    path: inputs.path,
    gate: inputs.gate,
  });
  const pipelineResult = await runPipeline(
    {
      ...inputs,
      notificationLinks: {
        runUrl: githubRunUrl(),
      },
    },
    logger,
  );
  const result = await attachHardwareImpact(pipelineResult, workspace, inputs.artifactName, logger);
  const written: { sarif?: string; json?: string; markdown?: string; hbom?: string } = {};
  if (inputs.outputs.json) {
    written.json = inputs.outputs.json;
    await writeTextFile(written.json, formatJson(result));
  }
  if (inputs.outputs.sarif) {
    written.sarif = inputs.outputs.sarif;
    await writeTextFile(written.sarif, formatSarif(result));
  }
  if (inputs.outputs.markdown) {
    written.markdown = inputs.outputs.markdown;
    await writeTextFile(written.markdown, formatMarkdown(result));
  }
  if (inputs.outputs.hbom) {
    written.hbom = inputs.outputs.hbom;
    await writeTextFile(written.hbom, formatHbom(result));
  }
  if (inputs.annotations) {
    emitAnnotations(result.findings);
  }
  setActionOutputs(result, written);
  await core.summary.addRaw(formatMarkdown(result)).write();
  const trustedWritesAllowed = inputs.executionPolicy !== "safe";
  if (trustedWritesAllowed && inputs.uploadArtifacts) {
    await uploadArtifacts(
      inputs.artifactName,
      Object.values(written).filter((entry): entry is string => Boolean(entry)),
      workspace,
    );
  }
  if (trustedWritesAllowed && inputs.uploadSarif && written.sarif) {
    await uploadSarif(written.sarif);
  }
  if (trustedWritesAllowed && inputs.commentPr) {
    await upsertPullRequestComment(result, inputs.artifactName, inputs.commentFormat);
  }
  logger.info("action.finish", {
    findings: result.summary.total,
    failed: result.summary.failed,
    latency_ms: Math.round(performance.now() - startedAt),
  });
  if (result.summary.failed) {
    throw new Error(
      `BoardReadyOps found ${result.summary.total} finding(s) at or above the configured fail-on threshold.`,
    );
  }
}

runAction().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : "BoardReadyOps failed.");
});

async function attachHardwareImpact(
  pipelineResult: RunResult,
  workspace: string,
  artifactName: string,
  logger: Logger,
): Promise<RunResult> {
  try {
    const hardwareImpact = await buildActionHardwareImpact(pipelineResult, { workspace, artifactName });
    return hardwareImpact ? { ...pipelineResult, hardwareImpact } : pipelineResult;
  } catch (error) {
    logger.warn("action.hardware_impact.unavailable", {
      errorClass: error instanceof Error ? error.name || "Error" : "UnknownError",
    });
    return pipelineResult;
  }
}

async function ensureRunnerFile(file: string | undefined): Promise<void> {
  if (!file) {
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, "", "utf8");
}

function githubRunUrl(): string | undefined {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  return server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : undefined;
}
