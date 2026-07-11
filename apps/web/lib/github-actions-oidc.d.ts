export type GitHubActionsOidcVerificationOptions = {
  readonly runId: string;
  readonly executionAttemptId?: string;
  readonly repository?: string;
  readonly workflowRef?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export function resetGitHubActionsOidcJwksCache(): void;
export function verifyGitHubActionsOidcToken(
  token: string,
  options: GitHubActionsOidcVerificationOptions,
): Promise<boolean>;
