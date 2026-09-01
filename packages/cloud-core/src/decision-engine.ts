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
  decision?: FindingDecisionLike,
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
  referenceId?: string;
}

export interface ReviewReadinessPolicyGate {
  requiredChecklist: string[];
  requiredRoles: string[];
  severityGate?: "error" | "high" | "medium" | null;
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

export interface DecisionExplanationNode {
  category: "findings" | "checklist" | "approvals" | "policy" | "waivers";
  condition: string;
  status: "pass" | "fail" | "waived" | "neutral";
  details?: string | undefined;
  referenceId?: string | undefined;
}

export interface DecisionExplanationGraph {
  nodes: DecisionExplanationNode[];
  summary: string;
}

export interface ReviewReadinessEvaluation {
  decision: ReviewDecision;
  isReady: boolean;
  blockers: ReviewReadinessBlocker[];
  approvedCount: number;
  totalChecklistCount: number;
  completedChecklistCount: number;
  explanationGraph: DecisionExplanationGraph;
}

function collectFindingBlockers(
  findings: Array<{ fingerprint: string; severity: string; ruleId: string; path: string }>,
  decisions: Map<string, FindingDecisionLike>,
  policy: ReviewReadinessPolicyGate | null | undefined,
  now: Date,
): ReviewReadinessBlocker[] {
  const blockers: ReviewReadinessBlocker[] = [];
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
  return blockers;
}

function collectChecklistBlockers(
  checklist: ReviewChecklistItemLike[],
  policy: ReviewReadinessPolicyGate | null | undefined,
): ReviewReadinessBlocker[] {
  const blockers: ReviewReadinessBlocker[] = [];
  for (const item of checklist) {
    if (!item.completed) {
      blockers.push({
        type: "incomplete_checklist",
        message: `Incomplete checklist item: ${item.title}`,
        referenceId: item.id,
      });
    }
  }

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
  return blockers;
}

function collectRoleBlockers(
  validApprovals: ReviewApprovalLike[],
  policy: ReviewReadinessPolicyGate | null | undefined,
  approverRoles: Map<string, string[]> | undefined,
): ReviewReadinessBlocker[] {
  const blockers: ReviewReadinessBlocker[] = [];
  if (policy && policy.requiredRoles.length > 0) {
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
  return blockers;
}

function collectApprovalBlockers(
  validApprovals: ReviewApprovalLike[],
  changesRequested: ReviewApprovalLike | undefined,
  requiredApprovalsCount: number,
  policy: ReviewReadinessPolicyGate | null | undefined,
  approverRoles: Map<string, string[]> | undefined,
): ReviewReadinessBlocker[] {
  const blockers: ReviewReadinessBlocker[] = [];
  if (changesRequested) {
    blockers.push({
      type: "changes_requested",
      message: `Changes requested by ${changesRequested.approverId}: ${changesRequested.reason ?? "No reason provided"}`,
      referenceId: changesRequested.id,
    });
    return blockers;
  }

  if (validApprovals.length < requiredApprovalsCount) {
    blockers.push({
      type: "missing_approval",
      message: `Requires at least ${requiredApprovalsCount} approval(s), currently has ${validApprovals.length}`,
    });
  }

  blockers.push(...collectRoleBlockers(validApprovals, policy, approverRoles));
  return blockers;
}

export function evaluateReviewReadiness(options: {
  findings: Array<{ fingerprint: string; severity: string; ruleId: string; path: string }>;
  decisions: Map<string, FindingDecisionLike>;
  approvals: ReviewApprovalLike[];
  checklist: ReviewChecklistItemLike[];
  headEvidenceDigest: string;
  requiredApprovalsCount?: number;
  policy?: ReviewReadinessPolicyGate | null;
  approverRoles?: Map<string, string[]>;
  now?: Date;
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

  const validApprovals = approvals.filter(
    (app) => app.status === "approved" && app.evidenceDigest === headEvidenceDigest && !app.invalidatedAt,
  );

  const changesRequested = approvals.find(
    (app) => app.status === "changes_requested" && app.evidenceDigest === headEvidenceDigest && !app.invalidatedAt,
  );

  const blockers: ReviewReadinessBlocker[] = [
    ...collectFindingBlockers(findings, decisions, policy, now),
    ...collectChecklistBlockers(checklist, policy),
    ...collectApprovalBlockers(validApprovals, changesRequested, requiredApprovalsCount, policy, approverRoles),
  ];

  const totalChecklistCount = checklist.length;
  const completedChecklistCount = checklist.filter((item) => item.completed).length;
  const isReady = blockers.length === 0;

  let decision: ReviewDecision = "pending";
  if (changesRequested) {
    decision = "changes_requested";
  } else if (isReady) {
    decision = "approved";
  }

  const nodes: DecisionExplanationNode[] = [];

  for (const finding of findings) {
    const isBlockingSeverity = policy?.severityGate
      ? isAtOrAboveSeverityGate(finding.severity, policy.severityGate)
      : finding.severity === "error" || finding.severity === "critical";
    const dec = decisions.get(finding.fingerprint);
    const evalRes = evaluateFindingDecision(finding, dec, now);
    if (evalRes.isWaived) {
      nodes.push({
        category: "waivers",
        condition: finding.ruleId,
        status: "waived",
        details: `Waived via ${evalRes.disposition}: ${dec?.reason ?? "approved exception"}`,
        referenceId: finding.fingerprint,
      });
    } else if (isBlockingSeverity) {
      nodes.push({
        category: "findings",
        condition: finding.ruleId,
        status: "fail",
        details: `Blocking finding (${finding.severity}) at ${finding.path}`,
        referenceId: finding.fingerprint,
      });
    } else {
      nodes.push({
        category: "findings",
        condition: finding.ruleId,
        status: "pass",
        details: `Non-blocking finding (${finding.severity}) at ${finding.path}`,
        referenceId: finding.fingerprint,
      });
    }
  }

  for (const item of checklist) {
    nodes.push({
      category: "checklist",
      condition: item.title,
      status: item.completed ? "pass" : "fail",
      referenceId: item.id,
    });
  }

  nodes.push({
    category: "approvals",
    condition: `Required Approvals (>= ${requiredApprovalsCount})`,
    status: validApprovals.length >= requiredApprovalsCount ? "pass" : "fail",
    details: `${validApprovals.length} of ${requiredApprovalsCount} valid approvals received`,
  });

  if (changesRequested) {
    nodes.push({
      category: "approvals",
      condition: "Changes Requested",
      status: "fail",
      details: `Changes requested by ${changesRequested.approverId}: ${changesRequested.reason ?? "No reason provided"}`,
      referenceId: changesRequested.id,
    });
  }

  const summary = isReady
    ? "All release readiness conditions, approvals, and checklist items satisfied."
    : `Release readiness blocked by ${blockers.length} item(s): ${blockers.map((b) => b.message).join("; ")}`;

  const explanationGraph: DecisionExplanationGraph = {
    nodes,
    summary,
  };

  return {
    decision,
    isReady,
    blockers,
    approvedCount: validApprovals.length,
    totalChecklistCount,
    completedChecklistCount,
    explanationGraph,
  };
}
