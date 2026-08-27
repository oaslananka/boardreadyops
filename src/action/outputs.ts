import * as core from "@actions/core";
import type { RunResult } from "../core/result.js";

export function setActionOutputs(
  result: RunResult,
  paths: {
    sarif?: string;
    json?: string;
    markdown?: string;
    hbom?: string;
    reviewUrl?: string;
    cloudRunId?: string;
    evidencePackId?: string;
  },
): void {
  core.setOutput("findings", String(result.summary.total));
  core.setOutput("critical", String(result.summary.critical));
  core.setOutput("high", String(result.summary.high));
  core.setOutput("medium", String(result.summary.medium));
  core.setOutput("low", String(result.summary.low));
  core.setOutput("sarif-path", paths.sarif ?? "");
  core.setOutput("json-path", paths.json ?? "");
  core.setOutput("markdown-path", paths.markdown ?? "");
  core.setOutput("hbom-path", paths.hbom ?? "");
  core.setOutput("review-url", paths.reviewUrl ?? "");
  core.setOutput("cloud-run-id", paths.cloudRunId ?? "");
  core.setOutput("evidence-pack-id", paths.evidencePackId ?? "");
}
