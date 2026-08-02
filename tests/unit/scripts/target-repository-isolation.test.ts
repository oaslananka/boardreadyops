import { describe, expect, it } from "vitest";
import {
  buildTargetRepositoryIsolationReport,
  validateTargetRepositoryIsolationEvidence,
} from "../../../scripts/target-repository-isolation.mjs";

const sourceSha = "a".repeat(40);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    sourceSha,
    independentCallbacksAccepted: 2,
    independentCheckRunsPublished: 2,
    crossInstallationCallbacksRejected: 2,
    staleAttemptCallbacksRejected: 1,
    claimMutationCallbacksRejected: 7,
    trustSnapshotCallbacksRejected: 2,
    rejectedCallbackMutations: 0,
    rejectedCallbackPublications: 0,
    optionalCommentWarnings: 1,
    responseLeakageFindings: 0,
    ...overrides,
  };
}

describe("target-repository two-installation isolation evidence", () => {
  it("builds one aggregate-only verified report", () => {
    expect(buildTargetRepositoryIsolationReport(evidence())).toEqual({
      event: "target_repository_two_installation_isolation_verified",
      sourceSha,
      topology: {
        installations: 2,
        repositories: 2,
        runs: 2,
        executionAttempts: 2,
      },
      accepted: {
        independentCallbacks: 2,
        independentCheckRuns: 2,
      },
      rejected: {
        crossInstallationCallbacks: 2,
        staleAttemptCallbacks: 1,
        claimMutationCallbacks: 7,
        trustSnapshotCallbacks: 2,
      },
      invariants: {
        rejectedCallbackMutations: 0,
        rejectedCallbackPublications: 0,
        optionalCommentWarnings: 1,
        responseLeakageFindings: 0,
      },
    });
  });

  it("fails closed when any required proof or invariant is missing", () => {
    expect(() => validateTargetRepositoryIsolationEvidence(evidence({ independentCallbacksAccepted: 1 }))).toThrow(
      "independent callbacks",
    );
    expect(() => validateTargetRepositoryIsolationEvidence(evidence({ rejectedCallbackMutations: 1 }))).toThrow(
      "rejected callback mutations",
    );
    expect(() => validateTargetRepositoryIsolationEvidence(evidence({ responseLeakageFindings: 1 }))).toThrow(
      "response leakage",
    );
  });

  it("rejects non-exact source revisions", () => {
    expect(() => validateTargetRepositoryIsolationEvidence(evidence({ sourceSha: "main" }))).toThrow(
      "sourceSha must be an exact 40-character lowercase Git SHA",
    );
  });
});
