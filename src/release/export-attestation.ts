import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
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
  /** Immutable source commit whose KiCad files were exported. */
  reviewedSha: string;
  /** Immutable SHA of the target-repository workflow definition that signed the export. */
  signerSha?: string;
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
  /** Verify a signed, self-contained export archive without a Git checkout of the source repository. */
  sourceCheckout?: boolean | undefined;
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

async function assertCanonicalSubjectPath(absolute: string): Promise<void> {
  // O_NOFOLLOW protects only the final component; a parent directory can
  // become a symlink after the first-party inventory was checked. Reject
  // any such alias before and after descriptor-bound hashing.
  if (path.resolve(await fs.realpath(absolute)) !== path.resolve(absolute)) {
    throw new Error("Attestation subject path is no longer canonical.");
  }
}

async function fileSha256(absolute: string): Promise<string> {
  // The local inventory was validated earlier, but a file could be replaced
  // before it is hashed for signing. Bind the read to a regular file descriptor
  // and reject a final-component symlink substituted after validation.
  await assertCanonicalSubjectPath(absolute);
  const before = await fs.lstat(absolute);
  if (!before.isFile()) throw new Error("Attestation subject is not a regular file.");
  const flags = fsConstants.O_RDONLY | (process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW);
  const handle = await fs.open(absolute, flags);
  try {
    const info = await handle.stat();
    const after = await fs.lstat(absolute);
    if (
      !info.isFile() ||
      !after.isFile() ||
      (process.platform !== "win32" &&
        (info.dev !== before.dev || info.ino !== before.ino || after.dev !== info.dev || after.ino !== info.ino))
    ) {
      throw new Error("Attestation subject changed identity during hashing preparation.");
    }
    await assertCanonicalSubjectPath(absolute);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    await assertCanonicalSubjectPath(absolute);
    const finalInfo = await fs.lstat(absolute);
    if (
      !finalInfo.isFile() ||
      (process.platform !== "win32" && (finalInfo.dev !== info.dev || finalInfo.ino !== info.ino))
    ) {
      throw new Error("Attestation subject changed identity during hashing.");
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
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

  // The source and output tree may have changed after the initial inventory
  // check but before every signing checksum was computed. A second complete
  // validation is required at this signing boundary, including undeclared
  // files and source fingerprints, not just hashes of listed outputs.
  const finalLocal = await verifyExportProvenance(absoluteRoot, relativeManifest, { currentGitSha: reviewedSha });
  if (finalLocal.status !== "verified" || finalLocal.gitShaMatch !== true) {
    throw new Error("Export source or output inventory changed while preparing signing checksums.");
  }
  if ((await fileSha256(absoluteManifest)) !== names.get(relativeManifest)) {
    throw new Error("Export manifest changed while preparing signing checksums.");
  }

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

async function prepareAttestedArchiveInventory(
  root: string,
  manifestPath: string,
  reviewedSha: string,
): Promise<SubjectInventory> {
  const absoluteRoot = await fs.realpath(root);
  const absoluteManifest = path.resolve(absoluteRoot, manifestPath);
  const relativeManifest = path.relative(absoluteRoot, absoluteManifest).split(path.sep).join("/");
  if (!allowedSubjectName(relativeManifest) || path.basename(absoluteManifest) !== "manifest.json") {
    throw new Error("Attested export requires a canonical in-root manifest.json.");
  }
  await assertCanonicalSubjectPath(absoluteManifest);
  const raw = await fs.readFile(absoluteManifest, "utf8");
  const manifest = JSON.parse(raw) as {
    kind?: string;
    schemaVersion?: number;
    tool?: { name?: string; version?: string };
    git?: { sha?: string; dirty?: boolean };
    sourceSnapshot?: string;
    sourceFingerprint?: string;
    steps?: Array<{ kind?: string; status?: string; files?: number }>;
    artifacts?: Array<{ path: string; sha256: string; bytes: number; kind?: string }>;
  };
  if (
    manifest.kind !== "boardreadyops.export-provenance" ||
    manifest.schemaVersion !== 1 ||
    manifest.tool?.name !== "boardreadyops" ||
    manifest.git?.sha !== reviewedSha ||
    manifest.git.dirty !== false ||
    manifest.sourceSnapshot !== "stable" ||
    !digestPattern.test(manifest.sourceFingerprint ?? "") ||
    !["gerbers", "drill", "bom", "positions"].every((kind) =>
      manifest.steps?.some((step) => step.kind === kind && step.status === "generated" && (step.files ?? 0) > 0),
    )
  ) {
    throw new Error("Signed export manifest is not a complete, clean reviewed-source export.");
  }
  const requiredKinds = ["gerber", "drill", "bom", "cpl"];
  const names = new Map<string, string>();
  names.set(relativeManifest, await fileSha256(absoluteManifest));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < requiredKinds.length) {
    throw new Error("Signed export has no complete manufacturing subject inventory.");
  }
  const manifestDir = path.dirname(absoluteManifest);
  const actualFiles = new Set<string>([absoluteManifest]);
  const pending = [manifestDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    await assertCanonicalSubjectPath(directory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Signed export contains a symlink.");
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) throw new Error("Signed export contains a non-regular file.");
      actualFiles.add(absolute);
    }
  }
  const declaredFiles = new Set<string>([absoluteManifest]);
  const kinds = new Set<string>();
  for (const item of manifest.artifacts) {
    if (
      !item ||
      typeof item.path !== "string" ||
      !allowedSubjectName(item.path) ||
      !digestPattern.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes <= 0 ||
      typeof item.kind !== "string"
    ) {
      throw new Error("Signed export contains an invalid subject declaration.");
    }
    if (kinds.has(`${item.kind}\0${item.path}`))
      throw new Error("Signed export contains duplicate subject declarations.");
    kinds.add(`${item.kind}\0${item.path}`);
    const absolute = path.resolve(manifestDir, item.path);
    if (!allowedSubjectName(path.relative(absoluteRoot, absolute).split(path.sep).join("/"))) {
      throw new Error("Signed export subject escaped the archive root.");
    }
    await assertCanonicalSubjectPath(absolute);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size !== item.bytes) throw new Error("Signed export subject size mismatch.");
    const actual = await fileSha256(absolute);
    if (actual !== item.sha256) throw new Error("Signed export subject digest mismatch.");
    const relative = path.relative(absoluteRoot, absolute).split(path.sep).join("/");
    if (names.has(relative)) throw new Error("Signed export contains duplicate subject paths.");
    names.set(relative, actual);
    declaredFiles.add(absolute);
  }
  if (!requiredKinds.every((kind) => manifest.artifacts?.some((item) => item.kind === kind) === true)) {
    throw new Error("Signed export is missing Gerber, drill, BOM or CPL subjects.");
  }
  if (actualFiles.size !== declaredFiles.size || [...actualFiles].some((file) => !declaredFiles.has(file))) {
    throw new Error("Signed export archive contains undeclared or missing files.");
  }
  if (names.size > 1024) throw new Error("GitHub attestations support at most 1024 subjects.");
  const checksums = `${[...names]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n")}\n`;
  return { names, checksums, manifestPath: absoluteManifest };
}

function validExpectation(e: TrustedExportExpectation): boolean {
  return (
    repoPattern.test(e.repository) &&
    /^\d+$/u.test(e.repositoryId) &&
    shaPattern.test(e.reviewedSha) &&
    (e.signerSha === undefined || shaPattern.test(e.signerSha)) &&
    // Only a protected-branch workflow_dispatch is a supported export signer.
    // A signed push/tag/PR run cannot fulfill the target-repository contract.
    /^refs\/heads\/[^\r\n]+$/u.test(e.sourceRef) &&
    /^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/u.test(e.workflowPath) &&
    e.event === "workflow_dispatch" &&
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
  // A workflow_dispatch signs from its protected workflow revision, while the
  // separately reviewed PR commit is bound by the signed manifest + subject bytes.
  // Never mistake GitHub certificate sourceRepositoryDigest for the PR checkout SHA.
  const workflowUri = `https://github.com/${e.repository}/${e.workflowPath}@${e.sourceRef}`;
  // gh attestation verify 2.102 exposes the certified SAN as a string.
  // Older parsed verifier results may wrap it in { value }; both must
  // match the independently trusted signer workflow URI exactly.
  const san = cert?.subjectAlternativeName;
  const signerSAN = typeof san === "string" ? san : recordAt(cert, "subjectAlternativeName")?.value;
  const runUri = `https://github.com/${e.repository}/actions/runs/${e.runId}/attempts/${e.runAttempt}`;
  if (
    cert?.issuer !== oidcIssuer ||
    cert.sourceRepositoryURI !== `https://github.com/${e.repository}` ||
    cert.sourceRepositoryIdentifier !== e.repositoryId ||
    cert.sourceRepositoryDigest !== (e.signerSha ?? e.reviewedSha) ||
    cert.githubWorkflowSHA !== (e.signerSha ?? e.reviewedSha) ||
    cert.sourceRepositoryRef !== e.sourceRef ||
    cert.runInvocationURI !== runUri ||
    cert.buildSignerURI !== workflowUri ||
    cert.buildSignerDigest !== (e.signerSha ?? e.reviewedSha) ||
    cert.runnerEnvironment !== "github-hosted" ||
    cert.buildTrigger !== e.event ||
    signerSAN !== workflowUri ||
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
    inventory =
      options.sourceCheckout === false
        ? await prepareAttestedArchiveInventory(options.root, options.manifestPath, e.reviewedSha)
        : await prepareInventory(options.root, options.manifestPath, e.reviewedSha);
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
    e.signerSha ?? e.reviewedSha,
    "--signer-digest",
    e.signerSha ?? e.reviewedSha,
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
  // The external verifier can take tens of seconds. The workspace is not
  // immutable merely because its bytes matched the signed subjects earlier.
  // Recheck the source and complete output set before returning an eligible
  // result; no stale pre-verification hash may bless a changed checkout.
  try {
    const afterVerification =
      options.sourceCheckout === false
        ? await prepareAttestedArchiveInventory(options.root, options.manifestPath, e.reviewedSha)
        : await prepareInventory(options.root, options.manifestPath, e.reviewedSha);
    if (
      afterVerification.manifestPath !== inventory.manifestPath ||
      afterVerification.checksums !== inventory.checksums
    ) {
      return rejected("Export source or subject inventory changed during attestation verification.");
    }
  } catch {
    return rejected("Export source or subject inventory changed during attestation verification.");
  }
  return {
    status: "eligible",
    reason: "Signed subject inventory and trusted target workflow identity match; GA acceptance remains separate.",
    sourceSha: e.reviewedSha,
    runInvocationURI: `https://github.com/${e.repository}/actions/runs/${e.runId}/attempts/${e.runAttempt}`,
    subjects: inventory.names.size,
  };
}
