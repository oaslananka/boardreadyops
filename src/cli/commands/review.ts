import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { computeEvidenceDigest } from "@boardreadyops/cloud-core";
import type { UploadMode } from "@boardreadyops/contracts";
import { mapFindingsForCloud } from "../../core/cloud-findings.js";
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

  const findings = mapFindingsForCloud(result.findings);

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

export interface ReviewVerifyOptions extends CommonCliOptions {
  ledger?: string;
  digest?: string;
  repo?: string;
  artifacts?: string;
}

export async function reviewVerifyCommand(
  target: string | undefined,
  options: ReviewVerifyOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = target ?? process.cwd();
  const ledgerPath =
    options.ledger ??
    (target?.endsWith(".json")
      ? target
      : ([
          `${root}/evidence-ledger.json`,
          `${root}/artifacts/evidence-ledger.json`,
          `${root}/.boardreadyops/evidence-ledger.json`,
        ].find((p) => {
          try {
            return require("node:fs").existsSync(p);
          } catch {
            return false;
          }
        }) ?? `${root}/evidence-ledger.json`));

  streams.stdout.write(`\n🔒 Verifying Hardware Review Evidence Ledger...\n`);
  streams.stdout.write(`  Ledger File: ${ledgerPath}\n`);

  try {
    const { verifyReviewEvidenceOffline } = await import("../../release/evidence.js");
    const result = await verifyReviewEvidenceOffline(ledgerPath, options.artifacts ?? root);

    if (options.digest && options.digest.toLowerCase() !== result.expectedDigest.toLowerCase()) {
      result.errors.push(`Expected digest ${options.digest} does not match ledger digest ${result.expectedDigest}`);
      result.verified = false;
    }

    streams.stdout.write(`\n--- Verification Summary ---\n`);
    streams.stdout.write(`  Calculated Digest: ${result.calculatedDigest}\n`);
    streams.stdout.write(`  Expected Digest:   ${result.expectedDigest}\n`);
    streams.stdout.write(`  Manifest Check:    ${result.manifestCheckPassed ? "PASS" : "FAIL"}\n`);

    if (result.tamperedItems.length > 0) {
      streams.stderr.write(`\n❌ Tampered Artifacts Detected:\n`);
      for (const item of result.tamperedItems) {
        streams.stderr.write(`  - ${item}\n`);
      }
    }

    if (result.missingItems.length > 0) {
      streams.stderr.write(`\n⚠️ Missing Artifacts:\n`);
      for (const item of result.missingItems) {
        streams.stderr.write(`  - ${item}\n`);
      }
    }

    if (result.errors.length > 0) {
      streams.stderr.write(`\n❌ Integrity Errors:\n`);
      for (const err of result.errors) {
        streams.stderr.write(`  - ${err}\n`);
      }
    }

    if (result.verified) {
      streams.stdout.write(`\n✔ Hardware Review Evidence Cryptographically Verified (PASS)!\n\n`);
      return 0;
    }

    streams.stderr.write(`\n❌ Evidence Verification Failed (TAMPERED / INVALID)\n\n`);
    return 1;
  } catch (error) {
    streams.stderr.write(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
