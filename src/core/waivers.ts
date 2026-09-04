import { matchesProjectScope } from "../util/path.js";
import type { WaiverConfig } from "./config.js";
import type { Finding } from "./findings.js";

export interface WaiverStatus {
  rule: string;
  owner: string;
  reason: string;
  expires?: string | undefined;
  approvedBy?: string | undefined;
  evidence?: string | undefined;
  stale: boolean;
  expired: boolean;
  matched: number;
}

/**
 * A finding that was suppressed by a waiver whose reason reads as a false-positive claim
 * (e.g. "false positive: KiCad DRC flags a net tie we intend"). This is the only place
 * BoardReadyOps currently records "this finding was wrong", so it doubles as the false-positive
 * telemetry hook: the pipeline enriches each signal with the rule's category/evidenceType
 * (src/core/rule-registry.ts) and logs it, making false-positive rate queryable per rule
 * category/evidence-type over time without inventing a new suppression mechanism.
 */
export interface FalsePositiveSignal {
  ruleId: string;
  findingFingerprint: string;
  reason: string;
}

export interface WaiverEvaluation {
  active: WaiverStatus[];
  expired: WaiverStatus[];
  findings: Finding[];
  falsePositiveSignals: FalsePositiveSignal[];
}

const FALSE_POSITIVE_REASON = /false[\s-]?positive/i;

export function applyWaivers(findings: Finding[], waivers: WaiverConfig[] = [], now = new Date()): WaiverEvaluation {
  if (waivers.length === 0) {
    return { active: [], expired: [], findings, falsePositiveSignals: [] };
  }
  const today = now.toISOString().slice(0, 10);
  const statuses = waivers.map((waiver) => ({ waiver, expired: isExpired(waiver.expires, today), matched: 0 }));

  const falsePositiveSignals: FalsePositiveSignal[] = [];
  const waived = findings.map((finding) => {
    const match = statuses.find((entry) => !entry.expired && waiverMatches(finding, entry.waiver));
    if (match) {
      match.matched += 1;
      if (FALSE_POSITIVE_REASON.test(match.waiver.reason)) {
        falsePositiveSignals.push({
          ruleId: finding.ruleId,
          findingFingerprint: finding.fingerprint,
          reason: match.waiver.reason,
        });
      }
      return { ...finding, suppressed: true };
    }
    return finding;
  });

  // Count matches for expired waivers too, so reports can show what they would have covered.
  for (const entry of statuses.filter((candidate) => candidate.expired)) {
    entry.matched = findings.filter((finding) => waiverMatches(finding, entry.waiver)).length;
  }

  const active: WaiverStatus[] = [];
  const expired: WaiverStatus[] = [];
  for (const entry of statuses) {
    const status = toStatus(entry.waiver, entry.expired, entry.matched);
    (entry.expired ? expired : active).push(status);
  }
  return { active, expired, findings: waived, falsePositiveSignals };
}

function toStatus(waiver: WaiverConfig, expired: boolean, matched: number): WaiverStatus {
  return {
    rule: waiver.rule,
    owner: waiver.owner,
    reason: waiver.reason,
    ...(waiver.expires === undefined ? {} : { expires: waiver.expires }),
    ...(waiver.approvedBy === undefined ? {} : { approvedBy: waiver.approvedBy }),
    ...(waiver.evidence === undefined ? {} : { evidence: waiver.evidence }),
    expired,
    stale: isStale(waiver, expired, matched),
    matched,
  };
}

function isStale(waiver: WaiverConfig, expired: boolean, matched: number): boolean {
  return expired === false && waiver.fingerprint !== undefined && matched === 0;
}

function isExpired(expires: string | undefined, today: string): boolean {
  return Boolean(expires && expires < today);
}

function waiverMatches(finding: Finding, waiver: WaiverConfig): boolean {
  if (waiver.rule !== finding.ruleId) {
    return false;
  }
  if (waiver.fingerprint && waiver.fingerprint.toLowerCase() !== finding.fingerprint) {
    return false;
  }
  if (waiver.project && !matchesProjectScope(finding.resource.path, waiver.project)) {
    return false;
  }
  return true;
}
