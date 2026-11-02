export type GitHubActionsOidcVerificationOptions = {
  readonly runId: string;
  readonly executionAttemptId?: string;
  readonly audience?: string;
  readonly repository?: string;
  readonly repositoryId?: string;
  readonly githubRunId?: string;
  readonly workflowRef?: string;
  readonly ref?: string;
  readonly sha?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export function resetGitHubActionsOidcJwksCache(): void;
export function verifyGitHubActionsOidcToken(
  token: string,
  options: GitHubActionsOidcVerificationOptions,
): Promise<boolean>;

export type VerifiedGitHubActionsOidcClaims = {
  readonly workflowSha: string;
  readonly workflowRunId: string;
  readonly repository: string | undefined;
  readonly repositoryId: string | undefined;
  readonly workflowRef: string | undefined;
  readonly ref: string | undefined;
  readonly event: string | undefined;
  readonly runnerEnvironment: string | undefined;
};

export function verifyGitHubActionsOidcTokenClaims(
  token: string,
  options: GitHubActionsOidcVerificationOptions,
): Promise<VerifiedGitHubActionsOidcClaims | undefined>;
