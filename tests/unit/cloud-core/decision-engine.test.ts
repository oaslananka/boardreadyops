import { describe, expect, it } from "vitest";
import {
  type CanonicalDecision,
  canonicalDecisionFromPolicy,
  canonicalDecisionFromReadiness,
  canonicalDecisionFromReviewDecision,
  computeDecisionFingerprint,
  evaluateFindingDecision,
  evaluateReviewReadiness,
} from "../../../packages/cloud-core/src/decision-engine.js";
import type {
  FindingDecisionRecord,
  ReviewApprovalRecord,
  ReviewChecklistItemRecord,
} from "../../../packages/db/src/index.js";

describe("Decision Engine", () => {
  it("evaluates finding decisions and expiry", () => {
    const finding = { fingerprint: "fp-1", severity: "error" };

    // No decision
    const res1 = evaluateFindingDecision(finding);
    expect(res1.isWaived).toBe(false);

    // Active accepted_risk
    const activeDecision: FindingDecisionRecord = {
      id: "fdec-1",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-1",
      disposition: "accepted_risk",
      reason: "Justification with sufficient length for accepted risk",
      owner: "engineer@company.com",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidenceDigest: "a".repeat(64),
      actorId: "actor-1",
      createdAt: new Date().toISOString(),
    };

    const res2 = evaluateFindingDecision(finding, activeDecision);
    expect(res2.isWaived).toBe(true);
    expect(res2.isExpired).toBe(false);

    // Expired accepted_risk
    const expiredDecision: FindingDecisionRecord = {
      ...activeDecision,
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
    };

    const res3 = evaluateFindingDecision(finding, expiredDecision);
    expect(res3.isWaived).toBe(false);
    expect(res3.isExpired).toBe(true);
  });

  it("evaluates review readiness blockers", () => {
    const headEvidenceDigest = "a".repeat(64);
    const findings = [{ fingerprint: "fp-1", severity: "error", ruleId: "trace-clearance", path: "board.kicad_pcb" }];
    const decisions = new Map<string, FindingDecisionRecord>();
    const approvals: ReviewApprovalRecord[] = [];
    const checklist: ReviewChecklistItemRecord[] = [
      {
        id: "chk-1",
        repositoryId: "repo-1",
        reviewId: "rev-1",
        title: "Verify silk",
        completed: false,
        completedBy: null,
        completedAt: null,
        createdAt: new Date().toISOString(),
      },
    ];

    const eval1 = evaluateReviewReadiness({
      findings,
      decisions,
      approvals,
      checklist,
      headEvidenceDigest,
    });

    expect(eval1.isReady).toBe(false);
    expect(eval1.blockers.length).toBeGreaterThanOrEqual(3); // unresolved finding, incomplete checklist, missing approval

    // Now waive finding, complete checklist, and add approval
    decisions.set("fp-1", {
      id: "fdec-1",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      findingFingerprint: "fp-1",
      disposition: "false_positive",
      reason: "Exempted component",
      owner: "engineer@company.com",
      expiresAt: null,
      evidenceDigest: headEvidenceDigest,
      actorId: "actor-1",
      createdAt: new Date().toISOString(),
    });

    const completedChecklist: ReviewChecklistItemRecord[] = checklist.map((item) => ({
      ...item,
      completed: true,
      completedBy: "alice",
      completedAt: new Date().toISOString(),
    }));

    const validApprovals: ReviewApprovalRecord[] = [
      {
        id: "rapp-1",
        repositoryId: "repo-1",
        reviewId: "rev-1",
        revisionId: "rev-rev-1",
        evidenceDigest: headEvidenceDigest,
        approverId: "alice",
        status: "approved",
        reason: "Looks great",
        isBreakGlass: false,
        invalidatedAt: null,
        invalidatedBy: null,
        invalidationReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const eval2 = evaluateReviewReadiness({
      findings,
      decisions,
      approvals: validApprovals,
      checklist: completedChecklist,
      headEvidenceDigest,
    });

    expect(eval1.explanationGraph).toBeDefined();
    expect(eval1.explanationGraph.summary).toContain("Release readiness blocked");
    expect(eval1.explanationGraph.nodes.length).toBeGreaterThan(0);

    expect(eval2.isReady).toBe(true);
    expect(eval2.decision).toBe("approved");
    expect(eval2.blockers.length).toBe(0);
    expect(eval2.explanationGraph.summary).toContain("All release readiness conditions");
    expect(eval2.explanationGraph.nodes.some((n) => n.status === "waived")).toBe(true);
  });

  it("blocks on a 'high' severity finding when the policy severity gate is 'high', unlike the default gate", () => {
    const headEvidenceDigest = "a".repeat(64);
    const findings = [{ fingerprint: "fp-1", severity: "high", ruleId: "clearance", path: "board.kicad_pcb" }];

    const withoutPolicy = evaluateReviewReadiness({
      findings,
      decisions: new Map(),
      approvals: [],
      checklist: [],
      headEvidenceDigest,
    });
    expect(withoutPolicy.blockers.some((b) => b.type === "unresolved_finding")).toBe(false);

    const withPolicy = evaluateReviewReadiness({
      findings,
      decisions: new Map(),
      approvals: [],
      checklist: [],
      headEvidenceDigest,
      policy: { requiredChecklist: [], requiredRoles: [], severityGate: "high" },
    });
    expect(withPolicy.blockers.some((b) => b.type === "unresolved_finding")).toBe(true);
  });

  it("computes an order-independent decision fingerprint that changes only when the outcome changes", () => {
    const headEvidenceDigest = "a".repeat(64);
    const findingA = { fingerprint: "fp-a", severity: "error", ruleId: "clearance", path: "a.kicad_pcb" };
    const findingB = { fingerprint: "fp-b", severity: "high", ruleId: "silkscreen", path: "b.kicad_pcb" };
    const checklistA = { id: "chk-a", title: "Verify silk", completed: true };
    const checklistB = { id: "chk-b", title: "Verify BOM", completed: false };

    const forwardOrder = evaluateReviewReadiness({
      findings: [findingA, findingB],
      decisions: new Map(),
      approvals: [],
      checklist: [checklistA, checklistB],
      headEvidenceDigest,
    });

    const reverseOrder = evaluateReviewReadiness({
      findings: [findingB, findingA],
      decisions: new Map(),
      approvals: [],
      checklist: [checklistB, checklistA],
      headEvidenceDigest,
    });

    expect(forwardOrder.decisionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(forwardOrder.decisionFingerprint).toBe(reverseOrder.decisionFingerprint);
    expect(computeDecisionFingerprint(forwardOrder)).toBe(forwardOrder.decisionFingerprint);

    const extraBlockingFinding = evaluateReviewReadiness({
      findings: [findingA, findingB, { fingerprint: "fp-c", severity: "error", ruleId: "drc", path: "c.kicad_pcb" }],
      decisions: new Map(),
      approvals: [],
      checklist: [checklistA, checklistB],
      headEvidenceDigest,
    });

    expect(extraBlockingFinding.decisionFingerprint).not.toBe(forwardOrder.decisionFingerprint);
  });

  it("surfaces a changes-requested approval as an explanation graph node", () => {
    const headEvidenceDigest = "a".repeat(64);
    const changesRequestedApproval: ReviewApprovalRecord = {
      id: "rapp-2",
      repositoryId: "repo-1",
      reviewId: "rev-1",
      revisionId: "rev-rev-1",
      evidenceDigest: headEvidenceDigest,
      approverId: "bob",
      status: "changes_requested",
      reason: "Silkscreen overlaps the fiducial",
      isBreakGlass: false,
      invalidatedAt: null,
      invalidatedBy: null,
      invalidationReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const withReason = evaluateReviewReadiness({
      findings: [],
      decisions: new Map(),
      approvals: [changesRequestedApproval],
      checklist: [],
      headEvidenceDigest,
    });

    expect(withReason.decision).toBe("changes_requested");
    expect(withReason.explanationGraph.nodes).toContainEqual(
      expect.objectContaining({
        category: "approvals",
        condition: "Changes Requested",
        status: "fail",
        details: "Changes requested by bob: Silkscreen overlaps the fiducial",
        referenceId: "rapp-2",
      }),
    );

    const withoutReason = evaluateReviewReadiness({
      findings: [],
      decisions: new Map(),
      approvals: [{ ...changesRequestedApproval, reason: null }],
      checklist: [],
      headEvidenceDigest,
    });

    expect(withoutReason.explanationGraph.nodes.find((n) => n.condition === "Changes Requested")?.details).toBe(
      "Changes requested by bob: No reason provided",
    );
  });

  it("blocks when a policy-required checklist item was never added to the review", () => {
    const headEvidenceDigest = "a".repeat(64);

    const result = evaluateReviewReadiness({
      findings: [],
      decisions: new Map(),
      approvals: [],
      checklist: [{ id: "chk-1", title: "Verify silk", completed: true }],
      headEvidenceDigest,
      policy: { requiredChecklist: ["Verify silk", "Check DFM"], requiredRoles: [] },
    });

    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        type: "missing_required_checklist_item",
        message: expect.stringContaining("Check DFM"),
      }),
    );
    expect(
      result.blockers.some((b) => b.type === "missing_required_checklist_item" && b.message.includes("Verify silk")),
    ).toBe(false);
  });

  it("blocks when a policy-required approver role has no matching approval, and passes once one exists", () => {
    const headEvidenceDigest = "a".repeat(64);
    const approvals = [
      {
        id: "rapp-1",
        evidenceDigest: headEvidenceDigest,
        approverId: "alice",
        status: "approved" as const,
      },
    ];

    const withoutRoleData = evaluateReviewReadiness({
      findings: [],
      decisions: new Map(),
      approvals,
      checklist: [],
      headEvidenceDigest,
      requiredApprovalsCount: 1,
      policy: { requiredChecklist: [], requiredRoles: ["hardware-lead"] },
    });
    expect(withoutRoleData.blockers).toContainEqual(
      expect.objectContaining({ type: "missing_required_approver_role" }),
    );

    const withRoleData = evaluateReviewReadiness({
      findings: [],
      decisions: new Map(),
      approvals,
      checklist: [],
      headEvidenceDigest,
      requiredApprovalsCount: 1,
      policy: { requiredChecklist: [], requiredRoles: ["hardware-lead"] },
      approverRoles: new Map([["alice", ["hardware-lead"]]]),
    });
    expect(withRoleData.blockers.some((b) => b.type === "missing_required_approver_role")).toBe(false);
    expect(withRoleData.isReady).toBe(true);
  });
});

describe("canonical decision vocabulary", () => {
  it("maps every readiness status to a canonical decision, totally and deterministically", () => {
    const cases: Array<[Parameters<typeof canonicalDecisionFromReadiness>[0], CanonicalDecision]> = [
      ["ready", "PASS"],
      ["at-risk", "CONDITIONAL"],
      ["blocked", "FAIL"],
    ];
    for (const [status, expected] of cases) {
      expect(canonicalDecisionFromReadiness(status)).toBe(expected);
      expect(canonicalDecisionFromReadiness(status)).toBe(canonicalDecisionFromReadiness(status));
    }
  });

  it("maps every policy status to a canonical decision, totally and deterministically", () => {
    const cases: Array<[Parameters<typeof canonicalDecisionFromPolicy>[0], CanonicalDecision]> = [
      ["pass", "PASS"],
      ["fail", "FAIL"],
    ];
    for (const [status, expected] of cases) {
      expect(canonicalDecisionFromPolicy(status)).toBe(expected);
      expect(canonicalDecisionFromPolicy(status)).toBe(canonicalDecisionFromPolicy(status));
    }
  });

  it("maps every review decision to a canonical decision, totally and deterministically", () => {
    const cases: Array<[Parameters<typeof canonicalDecisionFromReviewDecision>[0], CanonicalDecision]> = [
      ["pending", "UNKNOWN"],
      ["approved", "PASS"],
      ["changes_requested", "FAIL"],
    ];
    for (const [decision, expected] of cases) {
      expect(canonicalDecisionFromReviewDecision(decision)).toBe(expected);
      expect(canonicalDecisionFromReviewDecision(decision)).toBe(canonicalDecisionFromReviewDecision(decision));
    }
  });
});
