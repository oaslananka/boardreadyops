import { createHash } from "node:crypto";
import type { FindingDiffState, FindingDisposition, ReviewFindingDiffItem } from "@boardreadyops/contracts";

export interface InputFinding {
  fingerprint?: string;
  ruleId: string;
  severity: "error" | "high" | "medium" | "low" | "info";
  message: string;
  path?: string | null;
  project?: string | null;
  kind?: string | null;
  currentDisposition?: FindingDisposition;
}

export interface FindingDiffResult {
  items: ReviewFindingDiffItem[];
  counts: {
    total: number;
    new: number;
    persistent: number;
    regressed: number;
    resolved: number;
  };
  hasBlockers: boolean;
}

export interface EvidenceDigestInput {
  toolVersion: string;
  kicadVersion?: string;
  rulePackDigest: string;
  configDigest: string;
  headCommitSha: string;
  baseCommitSha?: string;
  findingFingerprints: readonly string[];
  artifactDigests?: readonly { name: string; sha256: string }[];
}

const severityRank: Record<string, number> = {
  error: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export function canonicalFingerprint(finding: InputFinding): string {
  if (finding.fingerprint && /^[0-9a-f]{64}$/u.test(finding.fingerprint)) {
    return finding.fingerprint;
  }
  const payload = JSON.stringify({
    ruleId: finding.ruleId,
    path: finding.path ?? "",
    project: finding.project ?? "",
    message: finding.message,
    severity: finding.severity,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function computeFindingDiff(
  baseFindings: readonly InputFinding[] = [],
  headFindings: readonly InputFinding[] = [],
): FindingDiffResult {
  const baseMap = new Map<string, InputFinding>();
  for (const item of baseFindings) {
    const fp = canonicalFingerprint(item);
    baseMap.set(fp, { ...item, fingerprint: fp });
  }

  const headMap = new Map<string, InputFinding>();
  for (const item of headFindings) {
    const fp = canonicalFingerprint(item);
    headMap.set(fp, { ...item, fingerprint: fp });
  }

  const items: ReviewFindingDiffItem[] = [];
  const counts = {
    total: 0,
    new: 0,
    persistent: 0,
    regressed: 0,
    resolved: 0,
  };

  // Process findings present in head
  for (const [fp, headFinding] of headMap.entries()) {
    const baseFinding = baseMap.get(fp);
    let diffState: FindingDiffState;

    if (!baseFinding) {
      diffState = "new";
      counts.new += 1;
    } else {
      const headRank = severityRank[headFinding.severity] ?? 1;
      const baseRank = severityRank[baseFinding.severity] ?? 1;

      if (headRank > baseRank || baseFinding.currentDisposition === "fixed") {
        diffState = "regressed";
        counts.regressed += 1;
      } else {
        diffState = "persistent";
        counts.persistent += 1;
      }
    }

    items.push({
      fingerprint: fp,
      ruleId: headFinding.ruleId,
      severity: headFinding.severity,
      message: headFinding.message,
      path: headFinding.path ?? undefined,
      project: headFinding.project ?? undefined,
      diffState,
      currentDisposition: headFinding.currentDisposition ?? "open",
      commentCount: 0,
    });
  }

  // Process findings present only in base (resolved)
  for (const [fp, baseFinding] of baseMap.entries()) {
    if (!headMap.has(fp)) {
      counts.resolved += 1;
      items.push({
        fingerprint: fp,
        ruleId: baseFinding.ruleId,
        severity: baseFinding.severity,
        message: baseFinding.message,
        path: baseFinding.path ?? undefined,
        project: baseFinding.project ?? undefined,
        diffState: "resolved",
        currentDisposition: "fixed",
        commentCount: 0,
      });
    }
  }

  counts.total = items.length;

  // Blocker check: error severity or regressed finding that is open
  const hasBlockers = items.some(
    (item) =>
      item.diffState !== "resolved" &&
      item.currentDisposition === "open" &&
      (item.severity === "error" || item.severity === "high"),
  );

  return {
    items,
    counts,
    hasBlockers,
  };
}

// Ordinal (code-unit) compare, not localeCompare: this order feeds a SHA-256 digest, and
// localeCompare's collation can vary across ICU builds/locales — it must stay byte-identical
// everywhere the digest is computed.
function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function computeEvidenceDigest(input: EvidenceDigestInput): string {
  const sortedFingerprints = [...input.findingFingerprints].sort(ordinalCompare);
  const sortedArtifacts = [...(input.artifactDigests ?? [])].sort((a, b) => ordinalCompare(a.name, b.name));

  const canonicalPayload = JSON.stringify({
    toolVersion: input.toolVersion,
    kicadVersion: input.kicadVersion ?? "",
    rulePackDigest: input.rulePackDigest,
    configDigest: input.configDigest,
    headCommitSha: input.headCommitSha,
    baseCommitSha: input.baseCommitSha ?? "",
    findings: sortedFingerprints,
    artifacts: sortedArtifacts,
  });

  return createHash("sha256").update(canonicalPayload).digest("hex");
}
