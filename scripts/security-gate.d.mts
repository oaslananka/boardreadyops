export interface SecurityGateInput {
  eventName: string;
  forkPullRequest: boolean;
  policy: {
    codeScan: boolean;
    dependencyScan: boolean;
    compliance: boolean;
    sbom: boolean;
  };
  results: {
    policy: string;
    codeql: string;
    semgrep: string;
    gitleaks: string;
    dependencyReview: string;
    osvPullRequest: string;
    osvFull: string;
    compliance: string;
    sbom: string;
  };
}

export interface SecurityGateEvaluation {
  ok: boolean;
  failures: string[];
  summary: string;
}

export declare function evaluateSecurityGate(input: SecurityGateInput): SecurityGateEvaluation;
export declare function main(): void;
