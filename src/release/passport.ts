import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { boardReadyVersion } from "../generated/version.js";
import { canonicalizeJson } from "../util/json.js";
import type { ReleaseEvidenceManifest } from "./evidence.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PassportArtifactDigest {
  path: string;
  sha256: string;
  bytes: number;
}

interface PassportHardwareArtifacts {
  gerbers: PassportArtifactDigest[];
  drill: PassportArtifactDigest[];
}

export interface PassportBomState {
  present: boolean;
  format?: string | null | undefined;
  hash?: string | null | undefined;
  componentCount?: number | null | undefined;
}

export interface PassportFirmwareState {
  present: boolean;
  hash?: string | null | undefined;
  componentCount?: number | null | undefined;
}

interface PassportPolicy {
  rulesetHash: string;
  failOn: string;
  ruleCount: number;
  rules?: string[] | undefined;
  policyStatus?: "pass" | "fail" | "not-evaluated" | undefined;
}

interface PassportContext {
  engineVersion: string;
  kicadVersion?: string | null | undefined;
  nodeVersion: string;
  platform: string;
}

interface PassportDecision {
  status: "pass" | "fail";
  reasons: string[];
}

interface PassportApproval {
  approverId: string;
  status: "approved" | "changes_requested";
  reason?: string | undefined;
  isBreakGlass?: boolean | undefined;
  timestamp: string;
}

interface PassportWaiver {
  fingerprint: string;
  disposition: string;
  reason: string;
  owner: string;
  expiresAt?: string | null | undefined;
}

interface PassportEvidence {
  bundlePath: string;
  manifestHash?: string | null | undefined;
  ledgerPath?: string | null | undefined;
  ledgerDigest?: string | null | undefined;
}

export interface ReleasePassport {
  schemaVersion: 1;
  type: "release-passport";
  tool: { name: "boardreadyops"; version: string };
  generatedAt: string;
  release: {
    id: string;
    git?: { sha?: string | undefined; dirty?: boolean | undefined; branch?: string | undefined } | undefined;
  };
  artifacts: {
    hardware: PassportHardwareArtifacts;
    bom: PassportBomState;
    firmware: PassportFirmwareState;
  };
  policy: PassportPolicy;
  context: PassportContext;
  decision: PassportDecision;
  approvals: PassportApproval[];
  waivers: PassportWaiver[];
  evidence: PassportEvidence;
  verification: {
    algorithm: "sha256";
    passportDigest: string;
  };
}

export interface PassportGenerateOptions {
  /** Stable release identifier (git tag, semver, etc.). */
  releaseId: string;
  /** Git SHA of the source commit. */
  gitSha?: string | undefined;
  /** Whether the working tree was dirty. */
  gitDirty?: boolean | undefined;
  /** Git branch name. */
  gitBranch?: string | undefined;
  /** Gerber artifacts from the evidence bundle. */
  gerbers: PassportArtifactDigest[];
  /** Drill artifacts from the evidence bundle. */
  drill: PassportArtifactDigest[];
  /** BOM state. */
  bom: PassportBomState;
  /** Firmware state. */
  firmware: PassportFirmwareState;
  /** Policy evaluation context. */
  policy: PassportPolicy;
  /** kicad-cli version string, if detected. */
  kicadVersion?: string | undefined;
  /** Relative path to the evidence bundle. */
  evidenceBundlePath: string;
  /** SHA-256 digest of the evidence bundle's manifest.json. */
  evidenceManifestHash?: string | undefined;
  /** Relative path to the review evidence ledger. */
  evidenceLedgerPath?: string | undefined;
  /** Digest of the review evidence ledger. */
  evidenceLedgerDigest?: string | undefined;
  /** Approval records to bind. */
  approvals?: PassportApproval[] | undefined;
  /** Active waivers to bind. */
  waivers?: PassportWaiver[] | undefined;
  /** Generation timestamp override. */
  generatedAt?: string | undefined;
}

// ---------------------------------------------------------------------------
// Digest computation
// ---------------------------------------------------------------------------

/**
 * Compute the passport digest: the SHA-256 of the canonicalized JSON of the
 * passport with `verification.passportDigest` set to the empty string. This
 * makes the digest cover every other field deterministically.
 */
export function computePassportDigest(passport: Omit<ReleasePassport, "verification">): string {
  const canonical = canonicalizeJson(passport);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Build a complete ReleasePassport from the provided options.
 *
 * The passport digest covers every field except `verification.passportDigest`
 * itself, creating a single tamper-evident root hash.
 */
export function buildReleasePassport(options: PassportGenerateOptions): ReleasePassport {
  const now = options.generatedAt ?? new Date().toISOString();

  const passportBody: Omit<ReleasePassport, "verification"> = {
    schemaVersion: 1,
    type: "release-passport",
    tool: { name: "boardreadyops", version: boardReadyVersion },
    generatedAt: now,
    release: {
      id: options.releaseId,
      ...(options.gitSha || options.gitBranch
        ? {
            git: {
              ...(options.gitSha ? { sha: options.gitSha } : {}),
              ...(options.gitDirty !== undefined ? { dirty: options.gitDirty } : {}),
              ...(options.gitBranch ? { branch: options.gitBranch } : {}),
            },
          }
        : {}),
    },
    artifacts: {
      hardware: {
        gerbers: [...options.gerbers].sort((a, b) => a.path.localeCompare(b.path)),
        drill: [...options.drill].sort((a, b) => a.path.localeCompare(b.path)),
      },
      bom: options.bom,
      firmware: options.firmware,
    },
    policy: options.policy,
    context: {
      engineVersion: boardReadyVersion,
      nodeVersion: process.version,
      platform: process.platform,
      ...(options.kicadVersion ? { kicadVersion: options.kicadVersion } : {}),
    },
    decision: { status: "pass", reasons: [] },
    approvals: [...(options.approvals ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    waivers: [...(options.waivers ?? [])].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    evidence: {
      bundlePath: options.evidenceBundlePath,
      ...(options.evidenceManifestHash ? { manifestHash: options.evidenceManifestHash } : {}),
      ...(options.evidenceLedgerPath ? { ledgerPath: options.evidenceLedgerPath } : {}),
      ...(options.evidenceLedgerDigest ? { ledgerDigest: options.evidenceLedgerDigest } : {}),
    },
  };

  const digest = computePassportDigest(passportBody);

  return {
    ...passportBody,
    verification: { algorithm: "sha256", passportDigest: digest },
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

type PassportErrorCode =
  | "SCHEMA_MISMATCH"
  | "DIGEST_MISMATCH"
  | "MANIFEST_HASH_MISMATCH"
  | "DIGITAL_SIGNATURE_INVALID"
  | "MALFORMED_PASSPORT";

export interface PassportVerification {
  ok: boolean;
  errors: string[];
  errorCodes: PassportErrorCode[];
}

/**
 * Verify a ReleasePassport's internal integrity: recompute the digest and
 * compare it to the embedded `verification.passportDigest`.
 */
export function verifyPassportDigest(passport: ReleasePassport): PassportVerification {
  const errors: string[] = [];
  const errorCodes: PassportErrorCode[] = [];

  if (passport.schemaVersion !== 1 || passport.type !== "release-passport") {
    errors.push("passport schema version or type mismatch");
    errorCodes.push("SCHEMA_MISMATCH");
  }

  const { verification, ...body } = passport;
  const recomputed = computePassportDigest(body);
  if (recomputed !== verification.passportDigest) {
    errors.push(
      `passport digest mismatch: recomputed ${recomputed.slice(0, 12)}… but passport declares ${verification.passportDigest.slice(0, 12)}…`,
    );
    errorCodes.push("DIGEST_MISMATCH");
  }

  return { ok: errors.length === 0, errors, errorCodes };
}

/**
 * Verify a passport alongside its evidence bundle: check the passport's own
 * integrity and then optionally rehash the evidence bundle's manifest.json
 * to confirm it still matches the passport's recorded hash.
 */
export async function verifyReleasePassport(
  passport: ReleasePassport,
  passportDir: string,
  options: { verifyEvidenceManifest?: boolean } = {},
): Promise<PassportVerification> {
  const base = verifyPassportDigest(passport);

  if (base.ok && options.verifyEvidenceManifest && passport.evidence.manifestHash) {
    const manifestPath = path.resolve(passportDir, passport.evidence.bundlePath, "manifest.json");
    try {
      const content = await fs.readFile(manifestPath);
      const actualHash = createHash("sha256").update(content).digest("hex");
      if (actualHash !== passport.evidence.manifestHash) {
        base.errors.push(
          `evidence manifest hash mismatch: rehashed ${actualHash.slice(0, 12)}… but passport records ${passport.evidence.manifestHash.slice(0, 12)}…`,
        );
        base.errorCodes.push("MANIFEST_HASH_MISMATCH");
        base.ok = false;
      }
    } catch (error) {
      base.errors.push(`evidence manifest unreadable: ${error instanceof Error ? error.message : String(error)}`);
      base.errorCodes.push("MANIFEST_HASH_MISMATCH");
      base.ok = false;
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// BOM/Firmware state helpers
// ---------------------------------------------------------------------------

/**
 * Derive the PassportBomState from an evidence manifest. Returns an explicit
 * present/absent state rather than silently omitting missing data.
 */
export function deriveBomState(manifest: ReleaseEvidenceManifest): PassportBomState {
  const bomArtifacts = manifest.artifacts.filter((a) => a.kind === "bom");
  if (bomArtifacts.length === 0) {
    return { present: false, format: null, hash: null, componentCount: null };
  }
  // Hash the first BOM artifact (typically the single canonical BOM file).
  const primary = bomArtifacts[0];
  return {
    present: true,
    format: "csv",
    hash: primary?.sha256 ?? null,
    componentCount: null, // CSV row counts require parsing; left for callers to enrich.
  };
}

/**
 * Derive the PassportFirmwareState from a firmware snapshot or evidence.
 * Returns an explicit present/absent state.
 */
export function deriveFirmwareState(
  firmwareHash?: string | undefined,
  componentCount?: number | undefined,
): PassportFirmwareState {
  if (!firmwareHash) {
    return { present: false, hash: null, componentCount: null };
  }
  return {
    present: true,
    hash: firmwareHash,
    componentCount: componentCount ?? null,
  };
}

/**
 * Compute the SHA-256 of a stringified ruleset configuration object.
 */
export function computeRulesetHash(ruleset: unknown): string {
  const canonical = canonicalizeJson(ruleset);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Human-readable rendering
// ---------------------------------------------------------------------------

function formatDecisionSummary(status: string, reasons: string[]): string {
  const suffix = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
  return `  Decision:        ${status.toUpperCase()}${suffix}`;
}

function formatBomSummary(present: boolean, format: string | null | undefined): string {
  const status = present ? "present" : "ABSENT";
  const fmt = format ? ` (${format})` : "";
  return `  BOM:             ${status}${fmt}`;
}

function formatWaiverLine(waiver: PassportWaiver): string {
  const expiry = waiver.expiresAt ? ` (expires ${waiver.expiresAt})` : "";
  return `    - ${waiver.disposition}: ${waiver.reason.slice(0, 60)}… [${waiver.owner}]${expiry}`;
}

export function formatPassportText(passport: ReleasePassport): string {
  const lines: string[] = [
    "",
    "Release Passport",
    `  Tool:            boardreadyops v${passport.tool.version}`,
    `  Generated at:    ${passport.generatedAt}`,
    `  Release ID:      ${passport.release.id}`,
  ];

  if (passport.release.git?.sha) {
    const dirty = passport.release.git.dirty ? " (dirty)" : "";
    const branch = passport.release.git.branch ? ` [${passport.release.git.branch}]` : "";
    lines.push(`  Source commit:   ${passport.release.git.sha}${dirty}${branch}`);
  }

  lines.push(
    formatDecisionSummary(passport.decision.status, passport.decision.reasons),
    `  Policy:          ${passport.policy.policyStatus ?? "not-evaluated"} (${passport.policy.ruleCount} rules, fail-on=${passport.policy.failOn})`,
    `  Gerber files:    ${passport.artifacts.hardware.gerbers.length}`,
    `  Drill files:     ${passport.artifacts.hardware.drill.length}`,
    formatBomSummary(passport.artifacts.bom.present, passport.artifacts.bom.format),
    `  Firmware:        ${passport.artifacts.firmware.present ? "present" : "not declared"}`,
    `  Approvals:       ${passport.approvals.length}`,
    `  Active waivers:  ${passport.waivers.length}`,
    `  Evidence bundle: ${passport.evidence.bundlePath}`,
    `  Passport digest: ${passport.verification.passportDigest.slice(0, 16)}…`,
    "",
  );

  if (passport.decision.reasons.length > 0) {
    lines.push("  Decision reasons:");
    for (const reason of passport.decision.reasons) {
      lines.push(`    - ${reason}`);
    }
    lines.push("");
  }

  if (passport.waivers.length > 0) {
    lines.push("  Active waivers:");
    for (const waiver of passport.waivers) {
      lines.push(formatWaiverLine(waiver));
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
