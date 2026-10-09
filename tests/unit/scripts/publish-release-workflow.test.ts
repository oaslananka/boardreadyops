import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/publish-release.yml");

describe("reviewed one-click release publication", () => {
  it("is manually dispatched only, never on a push or a schedule", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const config = yaml.load(workflow) as { on: Record<string, unknown>; jobs: Record<string, unknown> };
    expect(Object.keys(config.on)).toEqual(["workflow_dispatch"]);
    expect(workflow).not.toContain("  push:");
    expect(workflow).not.toContain("  schedule:");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("fails closed for unauthorized actors, refs, or absent release outputs", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const jobs = (yaml.load(workflow) as { jobs: Record<string, unknown> }).jobs;
    expect(jobs["publish-release"]).toBeDefined();
    expect(workflow).toContain("EVENT_NAME: $" + "{{ github.event_name }}");
    expect(workflow).toContain("REPOSITORY: $" + "{{ github.repository }}");
    expect(workflow).toContain("REF: $" + "{{ github.ref }}");
    expect(workflow).toContain("ACTOR: $" + "{{ github.actor }}");
    expect(workflow).toContain(['[ "', "$", '{ACTOR}" != "oaslananka" ]'].join(""));
    expect(workflow).toContain(['[ "', "$", '{CREATED}" != "true" ]'].join(""));
    expect(workflow).toContain("No reviewed stable release PR was ready to publish");
  });

  it("separates tagging from release preparation and reuses the existing OIDC npm workflow", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("skip-github-pull-request: true");
    expect(workflow).toContain("skip-github-release: false");
    expect(workflow).toContain("token: $" + "{{ secrets.RELEASE_PLEASE_TOKEN }}");
    expect(workflow).toContain("googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7");
    expect(workflow).toContain("gh workflow run publish-npm.yml");
    expect(workflow).toContain("-f prerelease=false -f update_floating_tags=true");
    expect(workflow).not.toContain("npm publish --");
    expect(workflow).not.toContain("continue-on-error: true");
  });
});
