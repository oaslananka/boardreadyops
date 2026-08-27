import { describe, expect, it } from "vitest";
import { evaluateFindingDecision, evaluateReviewReadiness } from "../../../packages/cloud-core/src/decision-engine.js";
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

    expect(eval2.isReady).toBe(true);
    expect(eval2.decision).toBe("approved");
    expect(eval2.blockers.length).toBe(0);
  });
});
