import { describe, expect, it } from "vitest";
import {
  declaredPermissionKeys,
  declaredPermissionRecord,
  evaluateActionAvailability,
  evaluateAppCapabilities,
  githubAppActions,
  githubAppPermissionProfile,
  missingDeclaredPermissions,
} from "../../../packages/cloud-core/src/github-capabilities.js";

/**
 * The profile exists to stop three copies of the permission list from drifting. These tests are
 * the drift detector: they assert the declaration and the capability evaluator agree, which is
 * exactly the invariant that was broken when `/setup` advertised `contents: none` while
 * `GitHubMutationService` required `contents: write` to do anything at all.
 */
describe("declared GitHub App permission profile", () => {
  it("declares every permission the capability evaluator understands, scoped to the repository", () => {
    expect(declaredPermissionKeys()).toEqual([
      "metadata",
      "checks",
      "actions",
      "pull_requests",
      "contents",
      "workflows",
      "issues",
    ]);
    for (const entry of githubAppPermissionProfile) {
      expect(entry.scope).toBe("repository");
      expect(entry.purpose.length).toBeGreaterThan(20);
      expect(entry.degradation.length).toBeGreaterThan(20);
    }
  });

  it("requests no organization or account permission", () => {
    expect(githubAppPermissionProfile.some((entry) => entry.scope !== "repository")).toBe(false);
  });

  it("satisfies every declared capability when the full profile is granted", () => {
    const granted = declaredPermissionRecord();
    expect(missingDeclaredPermissions(granted)).toEqual([]);

    const capabilities = evaluateAppCapabilities(granted);
    expect(capabilities.canCreateSetupPr).toBe(true);
    expect(capabilities.canCreateWaiverPr).toBe(true);
    expect(capabilities.canCreateRemediationPr).toBe(true);
    expect(capabilities.canDispatchAnalysis).toBe(true);
    expect(capabilities.canPostPrComments).toBe(true);
    expect(capabilities.canCreateCheckRunActions).toBe(true);

    for (const action of evaluateActionAvailability(granted)) {
      expect(action.satisfied).toBe(true);
      expect(action.missingPermissions).toEqual([]);
    }
  });

  it("reports every declared permission as missing for an installation that granted nothing", () => {
    expect(missingDeclaredPermissions({}).map((entry) => entry.key)).toEqual(declaredPermissionKeys());
  });

  it("names the exact missing grant rather than a generic failure", () => {
    // The historic narrow profile: no Contents, no Workflows, Pull requests read only.
    const narrow = { metadata: "read", checks: "write", actions: "write", pull_requests: "read" };
    const missing = missingDeclaredPermissions(narrow).map((entry) => entry.key);
    expect(missing).toEqual(["pull_requests", "contents", "workflows", "issues"]);

    const actions = evaluateActionAvailability(narrow);
    const setup = actions.find((action) => action.id === "setup");
    expect(setup?.satisfied).toBe(false);
    expect(setup?.missingPermissions).toEqual(["contents:write", "workflows:write", "pull_requests:write"]);
    expect(setup?.userExplanation).toContain("Contents (write)");

    // Dispatch survives the narrow profile, so a re-run stays available and must not be hidden.
    expect(actions.find((action) => action.id === "rerun")?.satisfied).toBe(true);
  });

  it("keeps a degradation sentence for every capability-scoped grant", () => {
    for (const entry of githubAppPermissionProfile.filter((candidate) => candidate.requirement === "capability")) {
      expect(entry.degradation).not.toContain("Nothing runs");
    }
  });

  it("maps every offered action onto a capability requirement the evaluator can check", () => {
    expect(githubAppActions.map((action) => action.id)).toEqual(["rerun", "release-preview", "setup", "waive", "fix"]);
    const requirements = new Set(githubAppActions.map((action) => action.requirement));
    expect([...requirements].sort()).toEqual(["dispatch_analysis", "remediation_pr", "setup_pr", "waiver_pr"]);
  });
});
