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

  it("updates only the non-secret rollout policy and restarts the consumers fail-closed", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    expect(workflow).toContain('repository="$1"');
    expect(workflow).toContain('policy_file="/opt/boardreadyops-cloud/release-repositories"');
    expect(workflow).toContain('^[a-z0-9_.-]+/[a-z0-9_.-]+$');
    expect(workflow).toContain('tr "[:upper:]" "[:lower:]"');
    expect(workflow).toContain('test -f "${policy_file}"');
    expect(workflow).toContain("mktemp");
    expect(workflow).toContain("sort -u");
    expect(workflow).toContain('cmp -s "${policy_file}" "${next_policy}"');
    expect(workflow).toContain('docker compose -p boardreadyops-cloud restart web worker');
    expect(workflow).toContain('docker compose -p boardreadyops-cloud ps web worker');
    expect(workflow).toContain("curl -fsS --max-time 10 http://127.0.0.1:3003/api/health/ready");
    expect(workflow).not.toContain("runtime-env");
    expect(workflow).not.toContain("docker system prune");
    expect(documentation).toContain("cloud-commission-repository");
    expect(documentation).toContain("non-secret rollout policy");
  });
});
