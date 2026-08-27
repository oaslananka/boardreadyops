import type { FindingDisposition, ReviewDecision } from "@boardreadyops/contracts";

export interface FindingDecisionLike {
  id: string;
  findingFingerprint: string;
  disposition: FindingDisposition;
  reason: string;
  owner: string;
  expiresAt: string | null;
  evidenceDigest: string;
}

export interface ReviewApprovalLike {
  id: string;
  evidenceDigest: string;
  approverId: string;
  status: "approved" | "changes_requested" | "invalidated" | "dismissed";
  reason?: string | null | undefined;
  invalidatedAt?: string | null | undefined;
}

export interface ReviewChecklistItemLike {
  id: string;
  title: string;
  completed: boolean;
}

export interface FindingWithDecision {
  fingerprint: string;
  ruleId: string;
  severity: "error" | "warning" | "info";
  path: string;
  decision?: FindingDecisionLike | undefined;
}

export interface FindingEvaluationResult {
  fingerprint: string;
  disposition?: FindingDisposition | undefined;
  isWaived: boolean;
  isFixRequired: boolean;
  isExpired: boolean;
  activeDecision?: FindingDecisionLike | undefined;
}

export function evaluateFindingDecision(
  finding: { fingerprint: string; severity: string },
  decision?: FindingDecisionLike | undefined,
  now = new Date(),
): FindingEvaluationResult {
  if (!decision) {
    return {
      fingerprint: finding.fingerprint,
      isWaived: false,
      isFixRequired: false,
      isExpired: false,
    };
  }

  const isExpired = decision.expiresAt !== null && new Date(decision.expiresAt) <= now;
  if (isExpired) {
    return {
      fingerprint: finding.fingerprint,
      disposition: decision.disposition,
      isWaived: false,
      isFixRequired: false,
      isExpired: true,
      activeDecision: decision,
    };
  }

  const isWaived =
    decision.disposition === "accepted_risk" ||
    decision.disposition === "false_positive" ||
    decision.disposition === "not_applicable";

  const isFixRequired = decision.disposition === "open";

  return {
    fingerprint: finding.fingerprint,
    disposition: decision.disposition,
    isWaived,
    isFixRequired,
    isExpired: false,
    activeDecision: decision,
  };
}

export interface ReviewReadinessBlocker {
  type: "unresolved_finding" | "incomplete_checklist" | "missing_approval" | "changes_requested";
  message: string;
  referenceId?: string | undefined;
}

export interface ReviewReadinessEvaluation {
  decision: ReviewDecision;
  isReady: boolean;
  blockers: ReviewReadinessBlocker[];
  approvedCount: number;
  totalChecklistCount: number;
  completedChecklistCount: number;
}

export function evaluateReviewReadiness(options: {
  findings: Array<{ fingerprint: string; severity: string; ruleId: string; path: string }>;
  decisions: Map<string, FindingDecisionLike>;
  approvals: ReviewApprovalLike[];
  checklist: ReviewChecklistItemLike[];
  headEvidenceDigest: string;
  requiredApprovalsCount?: number | undefined;
  now?: Date | undefined;
}): ReviewReadinessEvaluation {
  const {
    findings,
    decisions,
    approvals,
    checklist,
    headEvidenceDigest,
    requiredApprovalsCount = 1,
    now = new Date(),
  } = options;

  const blockers: ReviewReadinessBlocker[] = [];

  // 1. Check findings
  for (const finding of findings) {
    if (finding.severity === "error" || finding.severity === "critical") {
      const decision = decisions.get(finding.fingerprint);
      const evalResult = evaluateFindingDecision(finding, decision, now);
      if (!evalResult.isWaived) {
        blockers.push({
          type: "unresolved_finding",
          message: `Unresolved blocking finding: ${finding.ruleId} at ${finding.path}`,
          referenceId: finding.fingerprint,
        });
      }
    }
  }

  // 2. Check checklist
  const totalChecklistCount = checklist.length;
  const completedChecklistCount = checklist.filter((item) => item.completed).length;
  for (const item of checklist) {
    if (!item.completed) {
      blockers.push({
        type: "incomplete_checklist",
        message: `Incomplete checklist item: ${item.title}`,
        referenceId: item.id,
      });
    }
  }

  // 3. Check approvals
  // Filter valid approved records targeting the current head evidence digest
  const validApprovals = approvals.filter(
    (app) => app.status === "approved" && app.evidenceDigest === headEvidenceDigest && !app.invalidatedAt,
  );

  const changesRequested = approvals.find(
    (app) => app.status === "changes_requested" && app.evidenceDigest === headEvidenceDigest && !app.invalidatedAt,
  );

  if (changesRequested) {
    blockers.push({
      type: "changes_requested",
      message: `Changes requested by ${changesRequested.approverId}: ${changesRequested.reason ?? "No reason provided"}`,
      referenceId: changesRequested.id,
    });
  } else if (validApprovals.length < requiredApprovalsCount) {
    blockers.push({
      type: "missing_approval",
      message: `Requires at least ${requiredApprovalsCount} approval(s), currently has ${validApprovals.length}`,
    });
  }

  const isReady = blockers.length === 0;
  let decision: ReviewDecision = "pending";
  if (changesRequested) {
    decision = "changes_requested";
  } else if (isReady) {
    decision = "approved";
  }

  return {
    decision,
    isReady,
    blockers,
    approvedCount: validApprovals.length,
    totalChecklistCount,
    completedChecklistCount,
  };
}
