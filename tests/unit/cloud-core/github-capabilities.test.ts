import { describe, expect, it } from "vitest";
import {
  checkCapabilityRequirement,
  evaluateAppCapabilities,
  type GitHubAppPermissions,
} from "../../../packages/cloud-core/src/github-capabilities.js";

describe("GitHub App capability model", () => {
  it("evaluates a zero-permission installation to all false", () => {
    const capabilities = evaluateAppCapabilities({});
    expect(capabilities.checksWrite).toBe(false);
    expect(capabilities.actionsDispatch).toBe(false);
    expect(capabilities.pullRequestsWrite).toBe(false);
    expect(capabilities.contentsWrite).toBe(false);
    expect(capabilities.workflowsWrite).toBe(false);
    expect(capabilities.issuesWrite).toBe(false);
    expect(capabilities.canCreateSetupPr).toBe(false);
    expect(capabilities.canCreateWaiverPr).toBe(false);
    expect(capabilities.canPostPrComments).toBe(false);
  });

  it("evaluates full zero-touch target permissions correctly", () => {
    const permissions: GitHubAppPermissions = {
      metadata: "read",
      checks: "write",
      actions: "write",
      pullRequests: "write",
      contents: "write",
      workflows: "write",
      issues: "write",
    };
    const capabilities = evaluateAppCapabilities(permissions);
    expect(capabilities.checksWrite).toBe(true);
    expect(capabilities.actionsDispatch).toBe(true);
    expect(capabilities.pullRequestsWrite).toBe(true);
    expect(capabilities.contentsWrite).toBe(true);
    expect(capabilities.workflowsWrite).toBe(true);
    expect(capabilities.issuesWrite).toBe(true);
    expect(capabilities.canCreateSetupPr).toBe(true);
    expect(capabilities.canCreateRemediationPr).toBe(true);
    expect(capabilities.canCreateWaiverPr).toBe(true);
    expect(capabilities.canPostPrComments).toBe(true);
    expect(capabilities.canCreateCheckRunActions).toBe(true);
    expect(capabilities.canDispatchAnalysis).toBe(true);
  });

  it("handles GitHub API snake_case permission names and case insensitivity", () => {
    const rawApiPermissions = {
      metadata: "read",
      checks: "write",
      pull_requests: "write",
      contents: "write",
      actions: "write",
    };
    const capabilities = evaluateAppCapabilities(rawApiPermissions);
    expect(capabilities.pullRequestsWrite).toBe(true);
    expect(capabilities.checksWrite).toBe(true);
    expect(capabilities.contentsWrite).toBe(true);
    expect(capabilities.workflowsWrite).toBe(false);
    expect(capabilities.canCreateSetupPr).toBe(false); // requires workflows:write
    expect(capabilities.canCreateWaiverPr).toBe(true); // only requires contents:write + pullRequests:write
  });

  it("permits PR comments via either pullRequests:write or issues:write", () => {
    const prOnly = evaluateAppCapabilities({ pullRequests: "write" });
    expect(prOnly.canPostPrComments).toBe(true);

    const issuesOnly = evaluateAppCapabilities({ issues: "write" });
    expect(issuesOnly.canPostPrComments).toBe(true);

    const neither = evaluateAppCapabilities({ pullRequests: "read", issues: "read" });
    expect(neither.canPostPrComments).toBe(false);
  });

  it("provides actionable feedback when checking capability requirements", () => {
    const legacyPermissions: GitHubAppPermissions = {
      metadata: "read",
      checks: "write",
      actions: "write",
      pullRequests: "read",
      contents: "none",
    };
    const capabilities = evaluateAppCapabilities(legacyPermissions);

    const setupPrCheck = checkCapabilityRequirement(capabilities, "setup_pr");
    expect(setupPrCheck.satisfied).toBe(false);
    expect(setupPrCheck.missingPermissions).toContain("contents:write");
    expect(setupPrCheck.missingPermissions).toContain("workflows:write");
    expect(setupPrCheck.missingPermissions).toContain("pull_requests:write");
    expect(setupPrCheck.userExplanation).toContain("Contents (write)");

    const dispatchCheck = checkCapabilityRequirement(capabilities, "dispatch_analysis");
    expect(dispatchCheck.satisfied).toBe(true);
    expect(dispatchCheck.missingPermissions).toHaveLength(0);
  });
});
