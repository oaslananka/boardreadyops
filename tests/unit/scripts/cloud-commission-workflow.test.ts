import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const workflowPath = path.join(repoRoot, ".github/workflows/cloud-commission-repository.yml");
const deploymentDocsPath = path.join(repoRoot, "docs/deployment/github-actions-execution.md");

describe("cloud repository commissioning workflow", () => {
  it("requires an explicit repository and serializes with production deploys", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("name: cloud-commission-repository");
    expect(workflow).toContain("repository:");
    expect(workflow).toContain("required: true");
    expect(workflow).toContain("type: string");
    expect(workflow).toContain("group: cloud-deploy");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
  });

  it("bootstraps a legacy inline rollout only with explicit opt-in and a pinned running image", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");
    const deployRoot = "$" + "{deploy_root}";
    const deployRunbook = "$" + "{deploy_runbook}";
    const policyOverrideFile = "$" + "{policy_override_file}";
    const runningImageTag = "$" + "{running_image_tag}";
    const recreateAttempted = "$" + "{recreate_attempted}";

    expect(workflow).toContain("bootstrap_legacy_inline:");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("type: boolean");
    expect(workflow).toContain("BOOTSTRAP_LEGACY_INLINE");
    expect(workflow).toContain('bootstrap_legacy_inline="$2"');
    expect(workflow).toContain("legacy rollout bootstrap is disabled");
    expect(workflow).toContain("BOARDREADYOPS_RELEASE_REPOSITORIES");
    expect(workflow).toContain("legacy inline rollout differs between web and worker");
    expect(workflow).toContain("legacy inline rollout is empty");
    expect(workflow).toContain(`deploy_runbook="${deployRoot}/deploy.sh"`);
    expect(workflow).toContain(`policy_override_file="${deployRoot}/compose.release-policy.yml"`);
    expect(workflow).toContain("policy override already exists without a policy file");
    expect(workflow).toContain("release-repositories:/run/policies/repositories:ro");
    expect(workflow).toContain("BOARDREADYOPS_RELEASE_REPOSITORIES_FILE: /run/policies/repositories");
    expect(workflow).toContain("boardreadyops-web-runtime:");
    expect(workflow).toContain("legacy consumers are not running the same runtime image");
    expect(workflow).toContain(`BOARDREADYOPS_IMAGE_TAG="${runningImageTag}"`);
    expect(workflow).toContain(`"${deployRunbook}" -f "${policyOverrideFile}" config --quiet`);
    expect(workflow).toContain(
      `"${deployRunbook}" -f "${policyOverrideFile}" up -d --no-deps --force-recreate web worker`,
    );
    expect(workflow).toContain(`"${deployRunbook}" up -d --no-deps --force-recreate web worker`);
    expect(workflow).toContain("legacy bootstrap failed readiness; restoring legacy topology");
    expect(workflow).toContain("bootstrap_abort");
    expect(workflow).toContain(`if [ "${recreateAttempted}" = "1" ]`);
    expect(workflow).not.toContain("cat runtime-env");
    expect(workflow).not.toContain("grep BOARDREADYOPS_RELEASE_REPOSITORIES runtime-env");
    expect(documentation).toContain("bootstrap_legacy_inline");
    expect(documentation).toContain("default-off");
  });

  it("updates only the non-secret rollout policy and restarts the consumers fail-closed", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");
    const deployRoot = "$" + "{deploy_root}";
    const policyFile = "$" + "{policy_file}";
    const nextPolicy = "$" + "{next_policy}";
    const runningImageTag = "$" + "{running_image_tag}";
    const webContainer = "$" + "{web_container}";
    const workerContainer = "$" + "{worker_container}";

    expect(workflow).toContain('repository="$1"');
    expect(workflow).toContain('policy_file="/opt/boardreadyops-cloud/release-repositories"');
    expect(workflow).toContain('container_policy_path="/run/policies/repositories"');
    expect(workflow).toContain("^[a-z0-9_.-]+/[a-z0-9_.-]+$");
    expect(workflow).toContain('tr "[:upper:]" "[:lower:]"');
    expect(workflow).toContain("BOARDREADYOPS_RELEASE_REPOSITORIES_FILE");
    expect(workflow).toContain("docker inspect");
    expect(workflow).toContain(`test -f "${policyFile}"`);
    expect(workflow).toContain("mktemp");
    expect(workflow).toContain("sort -u");
    expect(workflow).toContain(`cmp -s "${policyFile}" "${nextPolicy}"`);
    expect(workflow).toContain(`policy_override_file="${deployRoot}/compose.release-policy.yml"`);
    expect(workflow).toContain("recreate_consumers() {");
    expect(workflow).toContain(`BOARDREADYOPS_IMAGE_TAG="${runningImageTag}"`);
    expect(workflow).toContain("up -d --no-deps --force-recreate web worker");
    expect(workflow).toContain('web_container="$(container_for_service web)"');
    expect(workflow).toContain('worker_container="$(container_for_service worker)"');
    expect(workflow).toContain("consumer recreate failed; restoring previous rollout policy");
    expect(workflow).toContain("rollback could not recreate consumers");
    expect(workflow).toContain("consumers failed readiness; restoring previous rollout policy");
    expect(workflow.indexOf("recreate_consumers() {")).toBeLessThan(workflow.indexOf('next_policy="$(mktemp'));
    expect(workflow).not.toContain(`docker restart "${webContainer}" "${workerContainer}"`);
    expect(workflow).toContain("policy_visible_in_consumer() {");
    expect(workflow).toContain(`policy_visible_in_consumer "${webContainer}"`);
    expect(workflow).toContain(`policy_visible_in_consumer "${workerContainer}"`);
    expect(workflow).toContain("consumers did not observe updated rollout policy; restoring previous rollout policy");
    expect(workflow.indexOf("policy_visible_in_consumer() {")).toBeGreaterThan(
      workflow.indexOf('previous_policy="$(mktemp'),
    );
    expect(workflow.indexOf("consumers did not observe updated rollout policy")).toBeLessThan(
      workflow.indexOf("repository commissioned successfully"),
    );
    expect(workflow).toContain("container_for_service");
    expect(workflow).toContain("http://127.0.0.1:3000/api/health/ready");
    expect(workflow).toContain("http://127.0.0.1:3001/health/ready");
    expect(workflow).not.toContain("runtime-env");
    expect(workflow).not.toContain("docker system prune");
    expect(documentation).toContain("cloud-commission-repository");
    expect(documentation).toContain("non-secret rollout policy");
  });
});
