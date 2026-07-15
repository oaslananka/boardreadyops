import { describe, expect, it } from "vitest";
import {
  configuredGitHubActionsWorkflow,
  githubActionsWorkflowGitRef,
  githubActionsWorkflowRef,
} from "../../../apps/web/lib/github-actions-workflow.js";

describe("target-repository GitHub Actions workflow binding", () => {
  it("uses the readiness workflow as the compatibility default", () => {
    expect(configuredGitHubActionsWorkflow({})).toBe("readiness-runner.yml");
  });

  it("accepts only a workflow filename, not a path or numeric workflow id", () => {
    expect(configuredGitHubActionsWorkflow({ BOARDREADYOPS_DISPATCH_WORKFLOW: "boardreadyops-cloud.yaml" })).toBe(
      "boardreadyops-cloud.yaml",
    );
    expect(configuredGitHubActionsWorkflow({ BOARDREADYOPS_DISPATCH_WORKFLOW: "../workflow.yml" })).toBeUndefined();
    expect(configuredGitHubActionsWorkflow({ BOARDREADYOPS_DISPATCH_WORKFLOW: "12345" })).toBeUndefined();
  });

  it("binds the OIDC workflow and git refs to the target default branch", () => {
    expect(githubActionsWorkflowRef("octo-org/hardware-board", "production/main", "readiness-runner.yml")).toBe(
      "octo-org/hardware-board/.github/workflows/readiness-runner.yml@refs/heads/production/main",
    );
    expect(githubActionsWorkflowGitRef("production/main")).toBe("refs/heads/production/main");
  });
});
