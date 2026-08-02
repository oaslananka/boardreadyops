export type TargetRepositoryIsolationEvidence = {
  sourceSha: string;
  independentCallbacksAccepted: number;
  independentCheckRunsPublished: number;
  crossInstallationCallbacksRejected: number;
  staleAttemptCallbacksRejected: number;
  claimMutationCallbacksRejected: number;
  trustSnapshotCallbacksRejected: number;
  rejectedCallbackMutations: number;
  rejectedCallbackPublications: number;
  optionalCommentWarnings: number;
  responseLeakageFindings: number;
};

export type TargetRepositoryIsolationReport = {
  event: "target_repository_two_installation_isolation_verified";
  sourceSha: string;
  topology: { installations: 2; repositories: 2; runs: 2; executionAttempts: 2 };
  accepted: { independentCallbacks: number; independentCheckRuns: number };
  rejected: {
    crossInstallationCallbacks: number;
    staleAttemptCallbacks: number;
    claimMutationCallbacks: number;
    trustSnapshotCallbacks: number;
  };
  invariants: {
    rejectedCallbackMutations: number;
    rejectedCallbackPublications: number;
    optionalCommentWarnings: number;
    responseLeakageFindings: number;
  };
};

export function validateTargetRepositoryIsolationEvidence(input: unknown): TargetRepositoryIsolationEvidence;
export function buildTargetRepositoryIsolationReport(input: unknown): TargetRepositoryIsolationReport;
export function writeTargetRepositoryIsolationReport(
  inputPath: string,
  outputPath: string,
): Promise<TargetRepositoryIsolationReport>;
