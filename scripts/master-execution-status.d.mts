export type ExecutionStatusValue = "implemented" | "partial" | "missing" | "blocked" | "deferred";
export type VerificationResult = "pass" | "fail" | "not_run";

export interface ValidationOptions {
  pathExists?(path: string): boolean;
}

export interface WorkstreamEvidence {
  code: string[];
  tests: string[];
  docs: string[];
  deployed: string[];
  commits: string[];
  pullRequests: string[];
}

export interface WorkstreamStatus {
  id: string;
  name: string;
  phase: number;
  priority: "P0" | "P1" | "P2" | "P3";
  status: ExecutionStatusValue;
  owner: string;
  dependencies: string[];
  milestone: string;
  issues: number[];
  evidence: WorkstreamEvidence;
  verification: { command: string; result: VerificationResult; checkedAt: string };
  remaining?: string;
  deferUntil?: string;
}

export interface ExecutionStatus {
  version: 1;
  spec: { path: string; sha256: string };
  roadmap: {
    source: string;
    checkedAt: string;
    orderedMilestones: string[];
    completedMilestones: string[];
  };
  baseline: {
    command: string;
    result: VerificationResult;
    commit: string;
    checkedAt: string;
    blockers: string[];
  };
  workstreams: WorkstreamStatus[];
}

export const executionStatusIds: readonly string[];
export function validateExecutionStatus(value: unknown, options?: ValidationOptions): ExecutionStatus;
