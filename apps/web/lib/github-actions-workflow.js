const workflowFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.ya?ml$/u;
const defaultWorkflowFile = "readiness-runner.yml";

export function configuredGitHubActionsWorkflow(environment = globalThis.process?.env ?? {}) {
  const configured = environment.BOARDREADYOPS_DISPATCH_WORKFLOW;
  const workflow = typeof configured === "string" && configured.trim() !== "" ? configured.trim() : defaultWorkflowFile;
  return workflowFilePattern.test(workflow) ? workflow : undefined;
}

export function githubActionsWorkflowRef(repository, defaultBranch, workflow) {
  if (!repository || !defaultBranch || !workflow || !workflowFilePattern.test(workflow)) return undefined;
  return `${repository}/.github/workflows/${workflow}@refs/heads/${defaultBranch}`;
}

export function githubActionsWorkflowGitRef(defaultBranch) {
  return defaultBranch ? `refs/heads/${defaultBranch}` : undefined;
}
