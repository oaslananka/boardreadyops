import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { verifyExportProvenance } from "../core/provenance.js";
import { type ProcessResult, runProcess } from "../util/process.js";

const shaPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u;
const slsaPredicate = "https://slsa.dev/provenance/v1";
const oidcIssuer = "https://token.actions.githubusercontent.com";

/**
 * Opt-in, GitHub-hosted attestation verification prerequisite for #771.
 * The caller MUST obtain these expected values from an independently authorized
 * target-repository/run record, not from a manifest or a callback payload.
 * This is not wired to a public release verdict until real tenant acceptance.
 */
export interface TrustedExportExpectation {
  repository: string;
  repositoryId: string;
  reviewedSha: string;
  sourceRef: string;
  workflowPath: string;
  event: string;
  runId: string;
  runAttempt: number;
}

export interface ExportAttestationOptions {
  root: string;
  manifestPath: string;
  expected: TrustedExportExpectation;
  /** Optional already-downloaded Sigstore bundle for independently verified offline evidence. */
  bundlePath?: string | undefined;
}

export interface ExportAttestationResult {
  status: "eligible" | "rejected";
  reason: string;
  sourceSha?: string;
  runInvocationURI?: string;
  subjects?: number;
}

interface SubjectInventory {
  names: Map<string, string>;
  checksums: string;
  manifestPath: string;
}

function allowedSubjectName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes("\\") &&
    !/[\r\n\0]/u.test(name) &&
    !name.startsWith("/") &&
    name.split("/").every((piece) => piece !== "" && piece !== "." && piece !== "..")
  );
}

async function fileSha256(absolute: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  return hash.digest("hex");
}

async function prepareInventory(root: string, manifestPath: string, reviewedSha: string): Promise<SubjectInventory> {
  const absoluteRoot = await fs.realpath(root);
  const absoluteManifest = path.resolve(absoluteRoot, manifestPath);
  const relativeManifest = path.relative(absoluteRoot, absoluteManifest).split(path.sep).join("/");
  if (!allowedSubjectName(relativeManifest) || path.basename(absoluteManifest) !== "manifest.json") {
    throw new Error("Attested export requires a canonical in-root manifest.json.");
  }
  const local = await verifyExportProvenance(absoluteRoot, relativeManifest, { currentGitSha: reviewedSha });
  if (local.status !== "verified" || local.gitShaMatch !== true) {
    throw new Error("Export source and actual file inventory did not pass the local byte-consistency check.");
  }
  const manifest = JSON.parse(await fs.readFile(absoluteManifest, "utf8")) as {
    kind?: string;
    git?: { sha?: string; dirty?: boolean };
    sourceSnapshot?: string;
    steps?: Array<{ kind?: string; status?: string; files?: number }>;
    artifacts?: Array<{ path: string; sha256: string; kind?: string }>;
  };
  if (
    manifest.kind !== "boardreadyops.export-provenance" ||
    manifest.git?.sha !== reviewedSha ||
    manifest.git.dirty !== false ||
    manifest.sourceSnapshot !== "stable" ||
    !["gerbers", "drill"].every((kind) =>
      manifest.steps?.some((step) => step.kind === kind && step.status === "generated" && (step.files ?? 0) > 0),
    ) ||
    !manifest.artifacts?.some((item) => item.kind === "gerber") ||
    !manifest.artifacts.some((item) => item.kind === "drill")
  ) {
    throw new Error("Attested export requires a pinned, clean and successful same-run Gerber/drill manifest.");
  }
  const names = new Map<string, string>();
  names.set(relativeManifest, await fileSha256(absoluteManifest));
  const manifestDir = path.dirname(absoluteManifest);
  for (const item of manifest.artifacts) {
    if (!digestPattern.test(item.sha256)) throw new Error("Invalid artifact digest.");
    const relative = path.relative(absoluteRoot, path.resolve(manifestDir, item.path)).split(path.sep).join("/");
    if (!allowedSubjectName(relative) || names.has(relative)) {
      throw new Error("Attested export contains a duplicate or unsafe subject name.");
    }
    // Hash bytes again at the signing boundary, not only trusting the parsed manifest.
    const actual = await fileSha256(path.join(absoluteRoot, relative));
    if (actual !== item.sha256) throw new Error("An export byte changed before subject preparation.");
    names.set(relative, actual);
  }
  if (names.size > 1024) throw new Error("GitHub attestations support at most 1024 subjects.");
  const checksums = `${[...names]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, digest]) => `${digest}  ${name}`)
    .join("\n")}\n`;
  return { names, checksums, manifestPath: absoluteManifest };
}

/** Subject checksums for actions/attest subject-checksums, after local validation.
 * A checksums file is NOT signed or independently trusted until an attestation
 * is generated and verified on an authorized target-repository runner.
 */
export async function prepareExportAttestationChecksums(options: {
  root: string;
  manifestPath: string;
  reviewedSha: string;
}): Promise<string> {
  if (!shaPattern.test(options.reviewedSha)) throw new Error("Expected full lowercase reviewed commit SHA.");
  return (await prepareInventory(options.root, options.manifestPath, options.reviewedSha)).checksums;
}

function validExpectation(e: TrustedExportExpectation): boolean {
  return (
    repoPattern.test(e.repository) &&
    /^\d+$/u.test(e.repositoryId) &&
    shaPattern.test(e.reviewedSha) &&
    /^refs\/(heads|tags|pull)\/[^\r\n]+$/u.test(e.sourceRef) &&
    /^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/u.test(e.workflowPath) &&
    /^[a-z_]+$/u.test(e.event) &&
    /^[1-9]\d*$/u.test(e.runId) &&
    Number.isSafeInteger(e.runAttempt) &&
    e.runAttempt > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordAt(value: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of keys) current = isRecord(current) ? current[key] : undefined;
  return isRecord(current) ? current : undefined;
}

function matchesVerifiedResult(value: unknown, e: TrustedExportExpectation, inventory: SubjectInventory): boolean {
  const verification = recordAt(value, "verificationResult");
  const cert = recordAt(verification, "signature", "certificate");
  const statement = recordAt(verification, "statement");
  const subjects = statement?.subject;
  const workflowUri = `https://github.com/${e.repository}/${e.workflowPath}@${e.sourceRef}`;
  const runUri = `https://github.com/${e.repository}/actions/runs/${e.runId}/attempts/${e.runAttempt}`;
  if (
    cert?.issuer !== oidcIssuer ||
    cert.sourceRepositoryURI !== `https://github.com/${e.repository}` ||
    cert.sourceRepositoryIdentifier !== e.repositoryId ||
    cert.sourceRepositoryDigest !== e.reviewedSha ||
    cert.sourceRepositoryRef !== e.sourceRef ||
    cert.runInvocationURI !== runUri ||
    cert.buildSignerURI !== workflowUri ||
    cert.buildSignerDigest !== e.reviewedSha ||
    cert.runnerEnvironment !== "github-hosted" ||
    cert.buildTrigger !== e.event ||
    recordAt(cert, "subjectAlternativeName")?.value !== workflowUri ||
    statement?.predicateType !== slsaPredicate ||
    !Array.isArray(subjects) ||
    subjects.length !== inventory.names.size
  )
    return false;

  const remaining = new Map(inventory.names);
  for (const subject of subjects) {
    if (!isRecord(subject) || typeof subject.name !== "string") return false;
    const digest = recordAt(subject, "digest")?.sha256;
    if (remaining.get(subject.name) !== digest) return false;
    remaining.delete(subject.name);
  }
  return remaining.size === 0;
}

/**
 * Requires real cryptographic validation by gh CLI before checking certificate
 * claims and exact signed subject inventory. No caller-supplied unsigned JSON
 * is ever eligible. A positive result is a phase-2 evidence prerequisite only:
 * it does NOT authorize GA, release, or cross-installation acceptance.
 */
export async function verifyReviewedExportAttestation(
  options: ExportAttestationOptions,
): Promise<ExportAttestationResult> {
  const e = options.expected;
  const rejected = (reason: string): ExportAttestationResult => ({ status: "rejected", reason });
  if (!validExpectation(e)) return rejected("Invalid independently trusted source/run expectation.");
  let inventory: SubjectInventory;
  try {
    inventory = await prepareInventory(options.root, options.manifestPath, e.reviewedSha);
  } catch {
    return rejected("Export source, manifest or output inventory failed closed.");
  }

  const args = [
    "attestation",
    "verify",
    inventory.manifestPath,
    "--repo",
    e.repository,
    "--signer-workflow",
    `${e.repository}/${e.workflowPath}`,
    "--source-digest",
    e.reviewedSha,
    "--signer-digest",
    e.reviewedSha,
    "--source-ref",
    e.sourceRef,
    "--cert-oidc-issuer",
    oidcIssuer,
    "--deny-self-hosted-runners",
    "--format",
    "json",
  ];
  if (options.bundlePath) args.push("--bundle", options.bundlePath);
  let response: ProcessResult;
  try {
    response = await runProcess("gh", args, {
      cwd: options.root,
      timeoutMs: 45_000,
      maxStdoutBytes: 4 * 1024 * 1024,
      maxStderrBytes: 4096,
    });
  } catch {
    return rejected("Cryptographic attestation verification could not run.");
  }
  if (response.code !== 0 || response.timedOut || response.error) {
    return rejected("GitHub/Sigstore attestation verification failed or is unavailable.");
  }
  let results: unknown;
  try {
    results = JSON.parse(response.stdout);
  } catch {
    return rejected("Attestation verifier returned malformed or truncated JSON.");
  }
  if (!Array.isArray(results) || !results.some((v) => matchesVerifiedResult(v, e, inventory))) {
    return rejected(
      "No cryptographically verified attestation matched the expected workflow/run and exact output set.",
    );
  }
  return {
    status: "eligible",
    reason: "Signed subject inventory and trusted target workflow identity match; GA acceptance remains separate.",
    sourceSha: e.reviewedSha,
    runInvocationURI: `https://github.com/${e.repository}/actions/runs/${e.runId}/attempts/${e.runAttempt}`,
    subjects: inventory.names.size,
  };
}
