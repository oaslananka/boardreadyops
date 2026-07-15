export declare function configuredGitHubActionsWorkflow(
  environment?: Readonly<Record<string, string | undefined>>,
): string | undefined;

export declare function githubActionsWorkflowRef(
  repository: string,
  defaultBranch: string,
  workflow: string,
): string | undefined;

export declare function githubActionsWorkflowGitRef(defaultBranch: string): string | undefined;
