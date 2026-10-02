export type RepositorySetupStateId = "unconfigured" | "validation_pending" | "attention" | "ready";

export type RepositorySetupStateInput = {
  setupRevision?: number;
  setupWorkflowStatus?: string;
  setupConfigStatus?: string;
  setupObservedSha?: string;
};

export type RepositorySetupState = {
  id: RepositorySetupStateId;
  label: string;
  description: string;
  currentStep: 1 | 4;
};

function humanize(value: string | undefined): string {
  return (value ?? "unknown").replaceAll("_", " ");
}

function explicitProblem(value: string | undefined): boolean {
  return value !== undefined && value !== "unknown" && value !== "ready";
}

/**
 * Turns persisted setup facts into the repository onboarding state shown in the setup UI.
 *
 * The state is derived from control-plane facts rather than browser-local progress: a reload,
 * a second maintainer, or a different browser therefore sees the same answer.
 */
export function deriveRepositorySetupState(input: RepositorySetupStateInput): RepositorySetupState {
  if (input.setupRevision === undefined) {
    return {
      id: "unconfigured",
      label: "Setup not started",
      description:
        "No persisted setup revision exists for this repository yet. Choose a policy, review the files, and open the setup pull request.",
      currentStep: 1,
    };
  }

  if (input.setupWorkflowStatus === "ready" && input.setupConfigStatus === "ready") {
    const commit = input.setupObservedSha ? ` at commit ${input.setupObservedSha.slice(0, 8)}` : "";
    return {
      id: "ready",
      label: "Repository setup verified",
      description: `The repository-owned workflow and BoardReadyOps configuration are verified${commit}.`,
      currentStep: 4,
    };
  }

  if (explicitProblem(input.setupWorkflowStatus) || explicitProblem(input.setupConfigStatus)) {
    return {
      id: "attention",
      label: "Setup needs attention",
      description: `The latest persisted setup revision reports workflow ${humanize(
        input.setupWorkflowStatus,
      )} and configuration ${humanize(input.setupConfigStatus)}. Resolve the setup condition, then validate again.`,
      currentStep: 4,
    };
  }

  return {
    id: "validation_pending",
    label: "Validation pending",
    description:
      "A setup revision exists, but workflow and configuration readiness have not both been verified yet. Merge or apply the reviewed setup files, then validate readiness.",
    currentStep: 4,
  };
}
