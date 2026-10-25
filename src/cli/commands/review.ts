import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { computeEvidenceDigest } from "@boardreadyops/cloud-core";
import type { SnapshotArtifact, UploadMode } from "@boardreadyops/contracts";
import type { PcbFootprintSummary } from "@boardreadyops/contracts/pcb-footprint-summary";
import { mapFindingsForCloud } from "../../core/cloud-findings.js";
import { loadConfig } from "../../core/config.js";
import { runPipeline } from "../../core/pipeline.js";
import { boardReadyVersion } from "../../generated/version.js";
import { gitPcbFootprintEvidence } from "../../kicad/git-footprint-evidence.js";
import { generateSnapshots } from "../../kicad/snapshots.js";
import { resolveGitExecutable } from "../../util/git-resolver.js";
import { summaryFromVerifiedFacts } from "./review-footprint-diff.js";
import type { CommonCliOptions } from "./run.js";

export interface ReviewPublishOptions extends CommonCliOptions {
  base?: string;
  head?: string;
  upload?: UploadMode;
  /** Informed opt-in to publishing source-derived PCB/schematic geometry. */
  nativeVisuals?: boolean;
  shareFootprintSummary?: boolean;
  pcb?: string;
  dryRun?: boolean;
  token?: string;
  server?: string;
  title?: string;
  repo?: string;
  pr?: number;
}

interface ReviewPublishResult {
  schemaVersion: 1;
  tool: { name: "boardreadyops"; version: string };
  success: true;
  dryRun: boolean;
  evidenceDigest: string;
  reviewUrl?: string;
  runId?: string;
}

type PublishedReview = { reviewUrl: string; runId?: string };

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolvePublishedReview(server: string, value: unknown): PublishedReview | undefined {
  if (!value || typeof value !== "object") return undefined;
  const response = value as { ok?: unknown; reviewUrl?: unknown; runId?: unknown };
  if (response.ok !== true) return undefined;

  const reviewUrl = nonEmptyString(response.reviewUrl);
  const runId = nonEmptyString(response.runId);

  if (!reviewUrl) {
    if (!runId) return undefined;
    return { reviewUrl: `${server}/runs/${encodeURIComponent(runId)}`, runId };
  }

  try {
    const serverUrl = new URL(`${server}/`);
    const resolved = new URL(reviewUrl, serverUrl);
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return undefined;
    if (resolved.origin !== serverUrl.origin) return undefined;
    return { reviewUrl: resolved.toString(), ...(runId ? { runId } : {}) };
  } catch {
    return undefined;
  }
}

function publishResult(evidenceDigest: string, dryRun: boolean, published?: PublishedReview): ReviewPublishResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    success: true,
    dryRun,
    evidenceDigest,
    ...(published ? { reviewUrl: published.reviewUrl } : {}),
    ...(published?.runId ? { runId: published.runId } : {}),
  };
}

function writePublishResult(result: ReviewPublishResult, streams: { stdout: NodeJS.WritableStream }): void {
  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function getGitCommitSha(root: string, ref = "HEAD"): string {
  try {
    const gitExec = resolveGitExecutable();
    return execFileSync(gitExec, ["-C", root, "rev-parse", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "0".repeat(40);
  }
}

/** A branch is only provenance for the checked-out commit; never fabricate `main`. */
export function resolveReviewPublishRef(sourceRoot: string, headSha: string): string {
  try {
    const gitExec = resolveGitExecutable();
    const run = (args: string[]) =>
      execFileSync(gitExec, ["-C", sourceRoot, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const actualSha = run(["rev-parse", "HEAD"]);
    if (actualSha !== headSha) return headSha;
    const branch = run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return branch && !branch.startsWith("-") ? `refs/heads/${branch}` : headSha;
  } catch {
    return headSha;
  }
}

function getGitOriginRepo(): string | undefined {
  try {
    const gitExec = resolveGitExecutable();
    const url = execFileSync(gitExec, ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = /[:/]([^/:]+\/[^/:]+?)(?:\.git)?$/.exec(url);
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
  const jsonOutput = options.format === "json";
  const loaded = await loadConfig(root, options.config);
  const config = loaded.config;
  let headSha = options.head ?? getGitCommitSha(root, "HEAD");
  let baseSha = options.base ? getGitCommitSha(root, options.base) : undefined;
  let pcbFootprintSummary: PcbFootprintSummary | undefined;
  if (options.shareFootprintSummary) {
    if (!options.base || !options.pcb) {
      streams.stderr.write("PCB summary opt-in requires --base and --pcb; nothing uploaded.\n");
      return 2;
    }
    const evidence = gitPcbFootprintEvidence({
      repositoryRoot: root,
      sourcePath: options.pcb,
      baseRef: options.base,
      headRef: options.head ?? "HEAD",
    });
    if (evidence.status !== "complete") {
      streams.stderr.write("PCB summary unavailable; nothing uploaded.\n");
      return 1;
    }
    // runPipeline and snapshot generation read the working directory, while
    // the summary itself comes from immutable Git blobs. Never combine facts
    // and rendered findings from different revisions under one review SHA.
    if (getGitCommitSha(root, "HEAD") !== evidence.headCommitSha) {
      streams.stderr.write("PCB summary publishing requires --head to match checked-out HEAD; nothing uploaded.\n");
      return 2;
    }
    try {
      const dirty = execFileSync(
        resolveGitExecutable(),
        ["-C", root, "status", "--porcelain", "--untracked-files=all"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
      );
      if (dirty.length > 0) {
        streams.stderr.write("PCB summary publishing requires a clean committed working tree; nothing uploaded.\n");
        return 2;
      }
    } catch {
      streams.stderr.write("Could not verify the PCB summary working-tree provenance; nothing uploaded.\n");
      return 2;
    }
    pcbFootprintSummary = summaryFromVerifiedFacts(evidence);
    headSha = evidence.headCommitSha;
    baseSha = evidence.baseCommitSha;
  } else if (options.pcb) {
    streams.stderr.write("--pcb requires --share-footprint-summary; nothing uploaded.\n");
    return 2;
  }
  const repositoryId = options.repo ?? getGitOriginRepo() ?? "local-repo";
  // Native artwork contains source-derived design IP even though it is SVG, not
  // a KiCad source file. Never send it under the default metadata-only mode.
  const uploadMode: UploadMode =
    options.nativeVisuals && (!options.upload || options.upload === "metadata")
      ? "snapshots"
      : (options.upload ?? "metadata");
  const server = (options.server ?? process.env.BOARDREADYOPS_SERVER_URL ?? "https://app.boardreadyops.com").replace(
    /\/$/,
    "",
  );
  const token = options.token ?? process.env.BOARDREADYOPS_TOKEN;

  if (!jsonOutput) streams.stdout.write(`\n🔍 Analyzing hardware preflight evidence in ${root}...\n`);

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
    toolVersion: boardReadyVersion,
    rulePackDigest,
    configDigest,
    headCommitSha: headSha,
    ...(baseSha ? { baseCommitSha: baseSha } : {}),
    findingFingerprints: findings.map((f) => f.fingerprint),
    artifactDigests: pcbFootprintSummary
      ? [
          {
            name: "pcb-footprint-summary.v1.json",
            sha256: createHash("sha256").update(JSON.stringify(pcbFootprintSummary)).digest("hex"),
          },
        ]
      : [],
  });

  if (!jsonOutput) {
    streams.stdout.write(`📊 Found ${findings.length} findings (Evidence Digest: ${evidenceDigest.slice(0, 16)}...)\n`);
  }

  if (options.dryRun) {
    if (jsonOutput) {
      writePublishResult(publishResult(evidenceDigest, true), streams);
      return 0;
    }
    streams.stdout.write(`\n[DRY RUN] Review publish simulation:\n`);
    streams.stdout.write(`  Repository: ${repositoryId}\n`);
    streams.stdout.write(`  Commit:     ${headSha.slice(0, 8)}\n`);
    if (baseSha) streams.stdout.write(`  Base:       ${baseSha.slice(0, 8)}\n`);
    streams.stdout.write(`  Upload Mode: ${uploadMode}\n`);
    streams.stdout.write(`  Findings:   ${findings.length}\n`);
    streams.stdout.write(`  Digest:     ${evidenceDigest}\n`);
    if (pcbFootprintSummary) streams.stdout.write("  PCB summary: explicit opt-in (counts and source hashes)\n");
    streams.stdout.write(`✔ Dry run completed successfully without network transmission.\n`);
    return 0;
  }

  if (!token) {
    streams.stderr.write(
      `❌ Error: BOARDREADYOPS_TOKEN is required for review publish. Pass --token or set env var.\n`,
    );
    return 1;
  }

  const snapshots: SnapshotArtifact[] = await generateSnapshots({
    ...(options.nativeVisuals ? {} : { nativeCli: false }),
    schematicFiles: result.projects.flatMap((p) => p.schematicFiles.map((f) => path.resolve(root, f))),
    pcbFiles: result.projects.flatMap((p) => p.boardFiles.map((f) => path.resolve(root, f))),
    // The Cloud wire format intentionally omits native KiCad diagnostic details.
    // Snapshot linking needs the original trusted run findings before that projection.
    findings: result.findings.map((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      ...(f.details ? { details: f.details } : {}),
    })),
  });

  if (!jsonOutput) streams.stdout.write(`🚀 Publishing review to ${server}...\n`);

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
        ref: resolveReviewPublishRef(root, headSha),
        pullRequestNumber: options.pr,
        triggerKind: "manual",
        findings,
        artifacts: [],
        snapshots,
        evidenceDigest,
        title: options.title ?? `Review for ${headSha.slice(0, 8)}`,
        ...(baseSha ? { baseCommitSha: baseSha } : {}),
        ...(pcbFootprintSummary ? { pcbFootprintSummary, pcbFootprintSummaryConsent: true } : {}),
      }),
    });

    if (!response.ok) {
      streams.stderr.write(`❌ Server error (${response.status}).\n`);
      return 1;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      streams.stderr.write(`❌ Unexpected server response.\n`);
      return 1;
    }

    if (
      pcbFootprintSummary &&
      (!data ||
        typeof data !== "object" ||
        (data as { acceptedFootprintSummary?: unknown }).acceptedFootprintSummary !== true)
    ) {
      streams.stderr.write("Server did not acknowledge PCB summary evidence.\n");
      return 1;
    }
    const published = resolvePublishedReview(server, data);
    if (!published) {
      streams.stderr.write(`❌ Unexpected server response.\n`);
      return 1;
    }

    if (jsonOutput) {
      writePublishResult(publishResult(evidenceDigest, false, published), streams);
      return 0;
    }

    streams.stdout.write(`\n✔ Hardware review published successfully!\n`);
    streams.stdout.write(`🔗 Review URL: ${published.reviewUrl}\n`);
    streams.stdout.write(`🔒 Evidence Digest: ${evidenceDigest}\n\n`);
    return 0;
  } catch {
    streams.stderr.write(`❌ Network error while publishing review. Check connectivity and try again.\n`);
    return 1;
  }
}

export interface ReviewVerifyOptions extends CommonCliOptions {
  ledger?: string;
  digest?: string;
  repo?: string;
  artifacts?: string;
}

function resolveLedgerPath(target: string | undefined, root: string, explicitLedger?: string): string {
  if (explicitLedger) return explicitLedger;
  if (target?.endsWith(".json")) return target;
  const candidates = [
    `${root}/evidence-ledger.json`,
    `${root}/artifacts/evidence-ledger.json`,
    `${root}/.boardreadyops/evidence-ledger.json`,
  ];
  for (const candidate of candidates) {
    try {
      if (require("node:fs").existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return `${root}/evidence-ledger.json`;
}

function writeVerificationResults(
  result: {
    calculatedDigest: string;
    expectedDigest: string;
    manifestCheckPassed: boolean;
    tamperedItems: string[];
    missingItems: string[];
    errors: string[];
    verified: boolean;
  },
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
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
}

export async function reviewVerifyCommand(
  target: string | undefined,
  options: ReviewVerifyOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = target ?? process.cwd();
  const ledgerPath = resolveLedgerPath(target, root, options.ledger);

  streams.stdout.write(`\n🔒 Verifying Hardware Review Evidence Ledger...\n`);
  streams.stdout.write(`  Ledger File: ${ledgerPath}\n`);

  try {
    const { verifyReviewEvidenceOffline } = await import("../../release/evidence.js");
    const result = await verifyReviewEvidenceOffline(ledgerPath, options.artifacts ?? root);

    if (options.digest && options.digest.toLowerCase() !== result.expectedDigest.toLowerCase()) {
      result.errors.push(`Expected digest ${options.digest} does not match ledger digest ${result.expectedDigest}`);
      result.verified = false;
    }

    return writeVerificationResults(result, streams);
  } catch (error) {
    streams.stderr.write(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
