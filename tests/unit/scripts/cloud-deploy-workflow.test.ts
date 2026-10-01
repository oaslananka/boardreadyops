import fs from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/cloud-deploy.yml";
const deploymentDocsPath = "docs/deployment/self-hosted.md";

describe("cloud-deploy topology preflight", () => {
  it("fails closed before mutating a stale or uncommissioned deployment checkout", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const repoDir = "$" + "{repo_dir}";
    const checkoutPreflight = workflow.indexOf(`test -d "${repoDir}/.git"`);
    const deployRoot = "$" + "{deploy_root}";
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

    const buildCacheMaxUsedSpace = "$" + "{build_cache_max_used_space}";
    const availableMib = "$" + "{available_mib}";
    const requiredMib = "$" + "{required_mib}";
    const repoDir = "$" + "{repo_dir}";
    const deployArgs = "$" + "{deploy_args}";

    expect(workflow).toContain("build_cache_max_used_space=3GB");
    expect(workflow).toContain(
      `docker builder prune --all --force --max-used-space "${buildCacheMaxUsedSpace}" || true`,
    );
    expect(workflow).not.toContain("--filter until=168h");

    const lowSpaceCheck = workflow.indexOf(`if [ "${availableMib}" -lt "${requiredMib}" ]; then`);
    const preflightTrim = workflow.indexOf("            trim_build_cache", lowSpaceCheck);
    const checkout = workflow.indexOf(`cd "${repoDir}"`);
    const caseStart = workflow.indexOf(`case "${deployArgs}" in`);
    const caseEnd = workflow.indexOf("          esac", caseStart);
    const finalTrim = workflow.indexOf("          trim_build_cache", caseEnd);

    expect(lowSpaceCheck).toBeGreaterThan(0);
    expect(preflightTrim).toBeGreaterThan(lowSpaceCheck);
    expect(preflightTrim).toBeLessThan(checkout);
    expect(caseStart).toBeGreaterThan(checkout);
    expect(caseEnd).toBeGreaterThan(caseStart);
    expect(finalTrim).toBeGreaterThan(caseEnd);
  });

  it("retires tagged runtime images before a blocked build only after explicit operator opt-in", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    const availableMib = "$" + "{available_mib}";
    const requiredMib = "$" + "{required_mib}";
    const retireOptIn = "$" + "{retire_superseded_images}";
    const shellImage = "$" + "{image}";
    const bashPid = "$" + "{BASHPID}";

    expect(workflow).toContain("retire_superseded_images:");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain('retire_superseded_images="$2"');
    expect(workflow).toContain(`if [ "${retireOptIn}" = "1" ]; then`);
    expect(workflow).toContain("retain=3");
    expect(workflow).toContain("docker compose -p boardreadyops-cloud images");
    expect(workflow).toContain("grep -vxF");
    expect(workflow).toContain("tail -n +$((retain + 1))");
    expect(workflow).toContain(`docker image rm "${shellImage}"`);
    expect(workflow).toContain(`/tmp/boardreadyops-running-images.${bashPid}`);
    expect(workflow).not.toContain("docker system prune");
    expect(workflow).not.toContain("docker volume prune");

    const cacheReclaim = workflow.indexOf("docker image prune --force || true");
    const optInCheck = workflow.indexOf(`if [ "${retireOptIn}" = "1" ]; then`, cacheReclaim);
    const capacityFailure = workflow.indexOf(`if [ "${availableMib}" -lt "${requiredMib}" ]; then`, optInCheck);

    expect(cacheReclaim).toBeGreaterThan(0);
    expect(optInCheck).toBeGreaterThan(cacheReclaim);
    expect(capacityFailure).toBeGreaterThan(optInCheck);
    expect(documentation).toContain("explicit operator opt-in");
    expect(documentation).toMatch(/keeps the running image and the\s+three newest rollback targets/);
  });

  it("emits aggregate-only disk diagnostics before a low-space preflight exits", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("cloud-deploy disk: docker system summary");
    expect(workflow).toContain("docker system df");
    expect(workflow).toContain("cloud-deploy disk: runtime images count=");
    expect(workflow).toContain("docker image inspect");
    expect(workflow).not.toContain("docker system df -v");
  });

  it("documents the remote path as a commissioned contract, not a permanently live host claim", () => {
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    expect(documentation).toContain("operator-commissioned deployment target");
    expect(documentation).toContain("preflight fails before `git fetch`");
    expect(documentation).toContain("do not create the missing production tree automatically");
    expect(documentation).not.toContain("The current production host does not run");
  });
});
