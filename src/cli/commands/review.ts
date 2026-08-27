import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { computeEvidenceDigest } from "@boardreadyops/cloud-core";
import type { UploadMode } from "@boardreadyops/contracts";
import { loadConfig } from "../../core/config.js";
import { runPipeline } from "../../core/pipeline.js";
import type { CommonCliOptions } from "./run.js";

export interface ReviewPublishOptions extends CommonCliOptions {
  base?: string;
  head?: string;
  upload?: UploadMode;
  dryRun?: boolean;
  token?: string;
  server?: string;
  title?: string;
  repo?: string;
  pr?: number;
}

function getGitCommitSha(ref = "HEAD"): string {
  try {
    return execFileSync("git", ["rev-parse", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "0".repeat(40);
  }
}

function getGitOriginRepo(): string | undefined {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export async function reviewPublishCommand(
  target: string | undefined,
  options: ReviewPublishOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = target ?? process.cwd();
  const loaded = await loadConfig(root, options.config);
  const config = loaded.config;
  const headSha = options.head ?? getGitCommitSha("HEAD");
  const baseSha = options.base ? getGitCommitSha(options.base) : undefined;
  const repositoryId = options.repo ?? getGitOriginRepo() ?? "local-repo";
  const uploadMode: UploadMode = options.upload ?? "metadata";
  const server = (options.server ?? process.env.BOARDREADYOPS_SERVER_URL ?? "https://app.boardreadyops.com").replace(
    /\/$/,
    "",
  );
  const token = options.token ?? process.env.BOARDREADYOPS_TOKEN;

  streams.stdout.write(`\n🔍 Analyzing hardware preflight evidence in ${root}...\n`);

  const result = await runPipeline({
    cwd: root,
    path: root,
    ...(options.config ? { config: options.config } : {}),
    rules: options.rule ?? [],
    skips: options.skip ?? [],
    executionPolicy: options.executionPolicy ?? "safe",
    failOn: "never",
  });

  const findings = result.findings.map((f) => ({
    ruleId: f.ruleId,
    severity: f.severity === "critical" ? ("error" as const) : f.severity,
    message: f.message,
    path: f.resource.path,
    project: f.project,
    fingerprint: f.fingerprint,
  }));

  const rulePackDigest = createHash("sha256").update("boardreadyops-v1").digest("hex");
  const configDigest = createHash("sha256").update(JSON.stringify(config)).digest("hex");

  const evidenceDigest = computeEvidenceDigest({
    toolVersion: "1.34.0",
    rulePackDigest,
    configDigest,
    headCommitSha: headSha,
    ...(baseSha ? { baseCommitSha: baseSha } : {}),
    findingFingerprints: findings.map((f) => f.fingerprint),
    artifactDigests: [],
  });

  streams.stdout.write(`📊 Found ${findings.length} findings (Evidence Digest: ${evidenceDigest.slice(0, 16)}...)\n`);

  if (options.dryRun) {
    streams.stdout.write(`\n[DRY RUN] Review publish simulation:\n`);
    streams.stdout.write(`  Repository: ${repositoryId}\n`);
    streams.stdout.write(`  Commit:     ${headSha.slice(0, 8)}\n`);
    if (baseSha) streams.stdout.write(`  Base:       ${baseSha.slice(0, 8)}\n`);
    streams.stdout.write(`  Upload Mode: ${uploadMode}\n`);
    streams.stdout.write(`  Findings:   ${findings.length}\n`);
    streams.stdout.write(`  Digest:     ${evidenceDigest}\n`);
    streams.stdout.write(`✔ Dry run completed successfully without network transmission.\n`);
    return 0;
  }

  if (!token) {
    streams.stderr.write(
      `❌ Error: BOARDREADYOPS_TOKEN is required for review publish. Pass --token or set env var.\n`,
    );
    return 1;
  }

  streams.stdout.write(`🚀 Publishing review to ${server}...\n`);

  try {
    const response = await fetch(`${server}/api/v1/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": `publish-${headSha}-${evidenceDigest.slice(0, 16)}`,
      },
      body: JSON.stringify({
        repositoryId,
        commitSha: headSha,
        ref: "refs/heads/main",
        pullRequestNumber: options.pr,
        triggerKind: "manual",
        findings,
        artifacts: [],
        evidenceDigest,
        title: options.title ?? `Review for ${headSha.slice(0, 8)}`,
        ...(baseSha ? { baseCommitSha: baseSha } : {}),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      streams.stderr.write(`❌ Server error (${response.status}): ${errText}\n`);
      return 1;
    }

    const data = (await response.json()) as { ok: boolean; reviewUrl?: string; runId?: string };
    if (data.ok) {
      const url = data.reviewUrl ? `${server}${data.reviewUrl}` : `${server}/runs/${data.runId}`;
      streams.stdout.write(`\n✔ Hardware review published successfully!\n`);
      streams.stdout.write(`🔗 Review URL: ${url}\n`);
      streams.stdout.write(`🔒 Evidence Digest: ${evidenceDigest}\n\n`);
      return 0;
    }

    streams.stderr.write(`❌ Unexpected server response.\n`);
    return 1;
  } catch (error) {
    streams.stderr.write(`❌ Network error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
