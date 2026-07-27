#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import {
  readSyntheticCanaryOptions,
  runSyntheticCanary,
  SyntheticCanaryError,
} from "./synthetic-target-repository-canary.mjs";

function safeFailure(error, options, startedAt) {
  const details = error instanceof SyntheticCanaryError ? error.details : {};
  return {
    ok: false,
    reason: error instanceof SyntheticCanaryError ? error.reason : "canary_github_api_unavailable",
    repository: options?.repository,
    visibility: options?.visibility,
    expectedSha: details.expectedSha,
    elapsedMs: typeof details.elapsedMs === "number" ? details.elapsedMs : Date.now() - startedAt,
    checkRunUrl: details.checkRunUrl,
    workflowUrl: details.workflowUrl,
  };
}

async function writeSummary(result) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = [
    "## BoardReadyOps synthetic target canary",
    "",
    `- Status: ${result.ok ? "passed" : "failed"}`,
    `- Repository: ${result.repository ?? "unknown"}`,
    `- Visibility: ${result.visibility ?? "unknown"}`,
    `- Expected SHA: ${result.expectedSha ?? "unknown"}`,
    `- Elapsed: ${result.elapsedMs} ms`,
  ];
  if (!result.ok) lines.push(`- Reason: ${result.reason}`);
  if (result.checkRunUrl) lines.push(`- Check Run: ${result.checkRunUrl}`);
  if (result.workflowUrl) lines.push(`- Workflow run: ${result.workflowUrl}`);
  await appendFile(path, `${lines.join("\n")}\n`, "utf8");
}

const startedAt = Date.now();
let options;
try {
  options = readSyntheticCanaryOptions(process.env);
  const result = await runSyntheticCanary(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await writeSummary(result);
} catch (error) {
  const result = safeFailure(error, options, startedAt);
  process.stderr.write(`${JSON.stringify(result)}\n`);
  await writeSummary(result);
  process.exitCode = 1;
}
