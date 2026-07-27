export type SyntheticCanaryVisibility = "public" | "private";
export type SyntheticCanaryReason =
  | "canary_pr_update_failed"
  | "canary_check_run_missing"
  | "canary_check_run_timeout"
  | "canary_check_run_failed"
  | "canary_check_run_binding_invalid"
  | "canary_workflow_missing"
  | "canary_workflow_timeout"
  | "canary_workflow_failed"
  | "canary_github_api_unavailable";

export interface SyntheticCanaryOptions {
  readonly repository: string;
  readonly token: string;
  readonly visibility: SyntheticCanaryVisibility;
  readonly branch: string;
  readonly pullRequestTitle: string;
  readonly noncePath: string;
  readonly checkRunName: string;
  readonly readinessWorkflow: string;
  readonly publicOrigin: string;
  readonly apiBaseUrl: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly maxRequests: number;
  readonly runId: string;
  readonly runAttempt: string;
}

export interface SyntheticCanaryDependencies {
  readonly request?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number | Date;
  readonly mutation?: typeof updateSyntheticCanaryPullRequest;
  readonly verification?: typeof verifySyntheticCanary;
}

export interface SyntheticCanaryMutationResult {
  readonly expectedSha: string;
  readonly pullRequestNumber: number;
}

export interface SyntheticCanaryVerificationResult {
  readonly expectedSha: string;
  readonly checkRunId: number;
  readonly checkRunUrl?: string;
  readonly releaseRunId: string;
  readonly workflowRunId: number;
  readonly workflowUrl?: string;
}

export class SyntheticCanaryError extends Error {
  readonly reason: SyntheticCanaryReason;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(reason: SyntheticCanaryReason, message: string, details?: Readonly<Record<string, unknown>>);
}

export function readSyntheticCanaryOptions(
  environment?: Readonly<Record<string, string | undefined>>,
): SyntheticCanaryOptions;
export function updateSyntheticCanaryPullRequest(
  options: SyntheticCanaryOptions,
  dependencies?: SyntheticCanaryDependencies,
): Promise<SyntheticCanaryMutationResult>;
export function verifySyntheticCanary(
  options: SyntheticCanaryOptions,
  expectedSha: string,
  dependencies?: SyntheticCanaryDependencies,
): Promise<SyntheticCanaryVerificationResult>;
export function runSyntheticCanary(
  options: SyntheticCanaryOptions,
  dependencies?: SyntheticCanaryDependencies,
): Promise<
  SyntheticCanaryVerificationResult &
    SyntheticCanaryMutationResult & {
      readonly ok: true;
      readonly repository: string;
      readonly visibility: SyntheticCanaryVisibility;
      readonly elapsedMs: number;
    }
>;
