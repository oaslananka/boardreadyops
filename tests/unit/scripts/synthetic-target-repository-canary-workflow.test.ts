import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/synthetic-target-repository-canary.yml";

type Workflow = {
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, { "runs-on"?: string; "timeout-minutes"?: number; steps?: unknown[] }>;
};

describe("synthetic target-repository canary workflow", () => {
  it("uses a workflow-call-only, repository-local permission boundary", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_call:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("secrets:");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("checks: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("pull-requests: write");
  });

  it("runs the implementation pinned to the reusable workflow commit", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("repository: oaslananka/boardreadyops");
    expect(workflow).toContain("ref: $" + "{{ github.workflow_sha }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("path: _boardreadyops-canary");
    expect(workflow).toContain("node _boardreadyops-canary/scripts/run-synthetic-target-repository-canary.mjs");
    expect(workflow).toContain("GITHUB_TOKEN: $" + "{{ github.token }}");
    expect(workflow).toContain("GITHUB_REPOSITORY: $" + "{{ github.repository }}");
    expect(workflow).toContain("GITHUB_RUN_ID: $" + "{{ github.run_id }}");
    expect(workflow).toContain("GITHUB_RUN_ATTEMPT: $" + "{{ github.run_attempt }}");
  });

  it("keeps one bounded non-cancelling observation per caller repository", async () => {
    const parsed = yaml.load(await readFile(workflowPath, "utf8")) as Workflow;
    expect(parsed.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "write",
      "pull-requests": "write",
    });
    expect(parsed.concurrency).toEqual({
      group: "boardreadyops-target-canary-$" + "{{ github.repository }}",
      "cancel-in-progress": false,
    });
    expect(Object.keys(parsed.jobs ?? {})).toEqual(["canary"]);
    expect(parsed.jobs?.canary).toMatchObject({
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 30,
    });
  });
});
