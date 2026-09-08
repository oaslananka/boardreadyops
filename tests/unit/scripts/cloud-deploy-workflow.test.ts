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

  it("caps BuildKit cache by size before a low-space build and after every build", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("build_cache_max_used_space=3GB");
    expect(workflow).toContain(
      'docker builder prune --all --force --max-used-space "${build_cache_max_used_space}" || true',
    );
    expect(workflow).not.toContain("--filter until=168h");

    const lowSpaceCheck = workflow.indexOf('if [ "${available_mib}" -lt "${required_mib}" ]; then');
    const preflightTrim = workflow.indexOf("            trim_build_cache", lowSpaceCheck);
    const checkout = workflow.indexOf('cd "${repo_dir}"');
    const caseStart = workflow.indexOf('case "${deploy_args}" in');
    const caseEnd = workflow.indexOf("          esac", caseStart);
    const finalTrim = workflow.indexOf("          trim_build_cache", caseEnd);

    expect(lowSpaceCheck).toBeGreaterThan(0);
    expect(preflightTrim).toBeGreaterThan(lowSpaceCheck);
    expect(preflightTrim).toBeLessThan(checkout);
    expect(caseStart).toBeGreaterThan(checkout);
    expect(caseEnd).toBeGreaterThan(caseStart);
    expect(finalTrim).toBeGreaterThan(caseEnd);
  });

  it("documents the remote path as a commissioned contract, not a permanently live host claim", () => {
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    expect(documentation).toContain("operator-commissioned deployment target");
    expect(documentation).toContain("preflight fails before `git fetch`");
    expect(documentation).toContain("do not create the missing production tree automatically");
    expect(documentation).not.toContain("The current production host does not run");
  });
});
