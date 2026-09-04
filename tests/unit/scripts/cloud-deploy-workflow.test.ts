import fs from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/cloud-deploy.yml";
const deploymentDocsPath = "docs/deployment/self-hosted.md";

describe("cloud-deploy topology preflight", () => {
  it("fails closed before mutating a stale or uncommissioned deployment checkout", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const repoDir = `$` + "{repo_dir}";
    const checkoutPreflight = workflow.indexOf(`test -d "${repoDir}/.git"`);
    const deployRoot = `$` + "{deploy_root}";
    const runbookPreflight = workflow.indexOf(`test -x "${deployRoot}/deploy.sh"`);
    const fetch = workflow.indexOf("git fetch origin --prune");

    expect(checkoutPreflight).toBeGreaterThan(0);
    expect(runbookPreflight).toBeGreaterThan(checkoutPreflight);
    expect(fetch).toBeGreaterThan(runbookPreflight);
    expect(workflow).toContain("deployment checkout is not commissioned");
    expect(workflow).toContain("deployment runbook is not commissioned");
  });

  it("documents the remote path as a commissioned contract, not a permanently live host claim", () => {
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    expect(documentation).toContain("operator-commissioned deployment target");
    expect(documentation).toContain("preflight fails before `git fetch`");
    expect(documentation).toContain("do not create the missing production tree automatically");
    expect(documentation).not.toContain("The current production host does not run");
  });
});
