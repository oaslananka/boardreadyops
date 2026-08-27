import { createHash } from "node:crypto";
import { computeEvidenceDigest } from "@boardreadyops/cloud-core";
import { mapFindingsForCloud } from "../core/cloud-findings.js";
import type { Logger } from "../core/logger.js";
import type { RunResult } from "../core/result.js";
import type { ActionInputs } from "./inputs.js";

export interface CloudPublishResult {
  reviewUrl?: string;
  cloudRunId?: string;
  evidencePackId?: string;
}

export async function publishActionRunToCloud(
  result: RunResult,
  inputs: ActionInputs,
  _workspace: string,
  logger: Logger,
): Promise<CloudPublishResult> {
  const token = process.env.BOARDREADYOPS_TOKEN;
  const isRequested = Boolean(inputs.cloudUpload || token);
  if (!isRequested) {
    return {};
  }

  const server = (
    inputs.cloudServer ??
    process.env.BOARDREADYOPS_SERVER_URL ??
    "https://app.boardreadyops.com"
  ).replace(/\/$/, "");
  const repositoryId = process.env.GITHUB_REPOSITORY ?? "github-repo";
  const commitSha = process.env.GITHUB_SHA ?? "0".repeat(40);
  const ref = process.env.GITHUB_REF ?? "refs/heads/main";
  const prMatch = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)/);
  const pullRequestNumber = prMatch?.[1] ? Number(prMatch[1]) : undefined;

  const findings = mapFindingsForCloud(result.findings);

  const rulePackDigest = createHash("sha256").update("boardreadyops-v1").digest("hex");
  const configDigest = createHash("sha256")
    .update(JSON.stringify(inputs.config ?? {}))
    .digest("hex");

  const evidenceDigest = computeEvidenceDigest({
    toolVersion: "1.34.0",
    rulePackDigest,
    configDigest,
    headCommitSha: commitSha,
    findingFingerprints: findings.map((f) => f.fingerprint),
  });

  if (!token) {
    logger.info("action.cloud.skip", { reason: "cloud-upload requested but BOARDREADYOPS_TOKEN is not set" });
    return { evidencePackId: evidenceDigest };
  }

  try {
    const response = await fetch(`${server}/api/v1/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": `action-${commitSha}-${evidenceDigest.slice(0, 16)}`,
      },
      body: JSON.stringify({
        repositoryId,
        commitSha,
        ref,
        ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
        triggerKind: process.env.GITHUB_EVENT_NAME === "pull_request" ? "pr" : "push",
        findings,
        artifacts: [],
        evidenceDigest,
        title: `Action review for ${commitSha.slice(0, 8)}`,
      }),
    });

    if (!response.ok) {
      logger.warn("action.cloud.error", { status: response.status });
      return { evidencePackId: evidenceDigest };
    }

    const data = (await response.json()) as { ok: boolean; reviewUrl?: string; runId?: string };
    const fullReviewUrl = data.reviewUrl ? `${server}${data.reviewUrl}` : `${server}/runs/${data.runId}`;
    logger.info("action.cloud.published", { reviewUrl: fullReviewUrl, evidenceDigest });
    return {
      reviewUrl: fullReviewUrl,
      ...(data.runId ? { cloudRunId: data.runId } : {}),
      evidencePackId: evidenceDigest,
    };
  } catch (error) {
    logger.warn("action.cloud.network_error", { error: String(error) });
    return { evidencePackId: evidenceDigest };
  }
}
