import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { computeEvidenceDigest } from "@boardreadyops/cloud-core";
import type { SnapshotArtifact } from "@boardreadyops/contracts";
import { mapFindingsForCloud } from "../core/cloud-findings.js";
import type { Logger } from "../core/logger.js";
import type { RunResult } from "../core/result.js";
import { generateSnapshots } from "../kicad/snapshots.js";
import { isInside } from "../util/path.js";
import type { ActionInputs } from "./inputs.js";

export interface CloudPublishResult {
  reviewUrl?: string;
  cloudRunId?: string;
  evidencePackId?: string;
}

/**
 * KiCad board geometry is sensitive source evidence, never a default Action
 * upload. Only export native images after BOTH explicit inputs and a token.
 * Symlinks escaping the selected scan directory are not eligible sources.
 */
async function nativeEvidenceForAction(
  result: RunResult,
  inputs: ActionInputs,
  workspace: string,
  logger: Logger,
): Promise<{ snapshots: SnapshotArtifact[]; sourceSha: string } | undefined> {
  if (inputs.cloudUpload !== "snapshots" || inputs.nativeVisuals !== true) return undefined;
  if (inputs.executionPolicy === "safe") {
    logger.info("action.cloud.native_skip", { reason: "safe-mode prevents native image upload" });
    return undefined;
  }

  try {
    const realWorkspace = await fs.realpath(workspace);
    const scanRoot = await fs.realpath(path.resolve(workspace, inputs.path ?? "."));
    if (!isInside(realWorkspace, scanRoot)) throw new Error("Scan directory must stay in the checked-out workspace");
    const sourceSha = execFileSync("git", ["-C", realWorkspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[0-9a-f]{40}$/u.test(sourceSha)) throw new Error("Exact source commit is unavailable");

    const files = async (key: "schematicFiles" | "boardFiles"): Promise<string[]> => {
      const items = result.projects.flatMap((project) => project[key]);
      const accepted: string[] = [];
      for (const file of items) {
        const absolute = await fs.realpath(path.resolve(scanRoot, file));
        if (!isInside(scanRoot, absolute)) throw new Error("Source file escapes selected scan directory");
        accepted.push(absolute);
      }
      return accepted;
    };
    const [schematicFiles, pcbFiles] = await Promise.all([files("schematicFiles"), files("boardFiles")]);
    if (!schematicFiles.length && !pcbFiles.length) return undefined;

    const rendered = await generateSnapshots({
      schematicFiles,
      pcbFiles,
      ...(inputs.kicadCli ? { nativeCli: inputs.kicadCli } : {}),
      findings: result.findings.map((finding) => ({
        fingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        ...(finding.details ? { details: finding.details } : {}),
      })),
    });
    const snapshots = rendered.filter((snapshot) => snapshot.name.startsWith("kicad_native_"));
    if (!snapshots.length) {
      logger.info("action.cloud.native_skip", { reason: "No native KiCad SVGs were produced" });
      return undefined;
    }
    return { sourceSha, snapshots };
  } catch (error) {
    logger.warn("action.cloud.native_skip", {
      reason: "Native image source validation or rendering failed",
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return undefined;
  }
}

export async function publishActionRunToCloud(
  result: RunResult,
  inputs: ActionInputs,
  workspace: string,
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

  const native = await nativeEvidenceForAction(result, inputs, workspace, logger);
  // In workflow_dispatch, GITHUB_SHA names the default branch even when a
  // different exact target commit was checked out. Bind native images to HEAD.
  const publishedCommitSha = native?.sourceSha ?? commitSha;
  // Native images bind to checked-out source SHA and exact rendered bytes.
  // Legacy non-opt-in metadata digests remain unchanged.
  const publishedEvidenceDigest = native
    ? computeEvidenceDigest({
        toolVersion: "1.34.0",
        rulePackDigest,
        configDigest,
        headCommitSha: native.sourceSha,
        findingFingerprints: findings.map((finding) => finding.fingerprint),
        artifactDigests: native.snapshots.map((snapshot) => ({
          name: snapshot.name,
          sha256: snapshot.sha256,
        })),
      })
    : evidenceDigest;
  const snapshotKey = native
    ? "-native-" +
      createHash("sha256")
        .update(JSON.stringify(native.snapshots.map((snapshot) => [snapshot.name, snapshot.sha256])))
        .digest("hex")
        .slice(0, 16)
    : "";

  try {
    const response = await fetch(`${server}/api/v1/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": `action-${publishedCommitSha}-${publishedEvidenceDigest.slice(0, 16)}${snapshotKey}`,
      },
      body: JSON.stringify({
        repositoryId,
        commitSha: publishedCommitSha,
        ref,
        ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
        triggerKind: process.env.GITHUB_EVENT_NAME === "pull_request" ? "pr" : "push",
        findings,
        artifacts: [],
        ...(native ? { snapshots: native.snapshots } : {}),
        evidenceDigest: publishedEvidenceDigest,
        title: `Action review for ${publishedCommitSha.slice(0, 8)}`,
      }),
    });

    if (!response.ok) {
      logger.warn("action.cloud.error", { status: response.status });
      return { evidencePackId: evidenceDigest };
    }

    const data = (await response.json()) as { ok: boolean; reviewUrl?: string; runId?: string };
    const fullReviewUrl = data.reviewUrl ? `${server}${data.reviewUrl}` : `${server}/runs/${data.runId}`;
    logger.info("action.cloud.published", { reviewUrl: fullReviewUrl, evidenceDigest: publishedEvidenceDigest });
    return {
      reviewUrl: fullReviewUrl,
      ...(data.runId ? { cloudRunId: data.runId } : {}),
      evidencePackId: publishedEvidenceDigest,
    };
  } catch (error) {
    logger.warn("action.cloud.network_error", { error: String(error) });
    return { evidencePackId: publishedEvidenceDigest };
  }
}
