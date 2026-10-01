import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflowPath = path.join(root, ".github", "workflows", "cloud-rollout-commission.yml");

describe("cloud rollout commissioning workflow", () => {
  it("provides only a bounded add-to-rollout operation on the commissioned policy file", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("repository:");
    expect(workflow).toContain("group: cloud-deploy");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("/opt/boardreadyops-cloud/release-repositories");
    expect(workflow).toContain("max_policy_bytes=65536");
    expect(workflow).toContain("grep -Fxiq");
    expect(workflow).toContain("sudo tee -a");
    expect(workflow).toContain("commissioned repository");
    expect(workflow).not.toContain("docker system prune");
    expect(workflow).not.toContain("sudo sh -c");
    expect(workflow).not.toContain("command:");
  });
});
