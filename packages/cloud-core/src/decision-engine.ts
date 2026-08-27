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
  type:
    | "unresolved_finding"
    | "incomplete_checklist"
    | "missing_approval"
    | "changes_requested"
    | "missing_required_checklist_item"
    | "missing_required_approver_role";
  message: string;
  referenceId?: string | undefined;
}

export interface ReviewReadinessPolicyGate {
  requiredChecklist: string[];
  requiredRoles: string[];
  severityGate?: "error" | "high" | "medium" | null | undefined;
}

const SEVERITY_ORDER = ["info", "low", "medium", "high", "error"] as const;

function isAtOrAboveSeverityGate(severity: string, gate: "error" | "high" | "medium"): boolean {
  const severityRank = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  const gateRank = SEVERITY_ORDER.indexOf(gate);
  if (severityRank === -1 || gateRank === -1) {
    return false;
  }
  return severityRank >= gateRank;
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
  policy?: ReviewReadinessPolicyGate | null | undefined;
  approverRoles?: Map<string, string[]> | undefined;
  now?: Date | undefined;
}): ReviewReadinessEvaluation {
  const {
    findings,
    decisions,
    approvals,
    checklist,
    headEvidenceDigest,
    requiredApprovalsCount = 1,
    policy,
    approverRoles,
    now = new Date(),
  } = options;

  const blockers: ReviewReadinessBlocker[] = [];

  // 1. Check findings against the policy severity gate (defaults to blocking only "error")
  for (const finding of findings) {
    const isBlockingSeverity = policy?.severityGate
      ? isAtOrAboveSeverityGate(finding.severity, policy.severityGate)
      : finding.severity === "error" || finding.severity === "critical";
    if (isBlockingSeverity) {
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

  // 2b. Check policy-required checklist items exist at all (not just completed)
  if (policy) {
    const existingTitles = new Set(checklist.map((item) => item.title.trim().toLowerCase()));
    for (const requiredTitle of policy.requiredChecklist) {
      if (!existingTitles.has(requiredTitle.trim().toLowerCase())) {
        blockers.push({
          type: "missing_required_checklist_item",
          message: `Policy requires checklist item not present on this review: ${requiredTitle}`,
        });
      }
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

  // 4. Check policy-required approver roles, if a role directory was supplied.
  // Without approverRoles, role coverage cannot be verified, so it fails closed rather than
  // silently passing a governance requirement no data source can confirm.
  if (policy && policy.requiredRoles.length > 0 && !changesRequested) {
    for (const requiredRole of policy.requiredRoles) {
      const hasApprovalFromRole = validApprovals.some((app) =>
        approverRoles?.get(app.approverId)?.includes(requiredRole),
      );
      if (!hasApprovalFromRole) {
        blockers.push({
          type: "missing_required_approver_role",
          message: `Policy requires approval from role "${requiredRole}", none found among current approvers`,
        });
      }
    }
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
