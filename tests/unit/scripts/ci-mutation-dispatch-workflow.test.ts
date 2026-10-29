import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/ci.yml");
const nightlyPath = join(process.cwd(), ".github/workflows/mutation-nightly.yml");

type DispatchConfig = {
  on: {
    workflow_dispatch: {
      inputs: Record<string, { type: string; default: boolean; required: boolean }>;
    };
    push: unknown;
    pull_request: unknown;
  };
  jobs: Record<string, { if?: string; steps?: unknown[] }>;
};

describe("cost-bounded manual mutation workflow", () => {
  it("retains full CI dispatch and makes long mutation opt-in with a false default", async () => {
    const ci = yaml.load(await readFile(workflowPath, "utf8")) as DispatchConfig;
    expect(ci.on).toHaveProperty("push");
    expect(ci.on).toHaveProperty("pull_request");
    expect(ci.on.workflow_dispatch.inputs.run_mutation).toMatchObject({
      type: "boolean",
      default: false,
      required: false,
    });
    expect(ci.jobs.mutation?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(ci.jobs.mutation?.if).toContain("inputs.run_mutation == true");
    expect(ci.jobs.mutation?.if).toContain("needs.risk-profile.outputs.needs_mutation == 'true'");
    expect(ci.jobs.mutation?.steps).toBeDefined();
  });

  it("does not disable the existing scheduled mutation workflow", async () => {
    const nightly = yaml.load(await readFile(nightlyPath, "utf8")) as {
      on: { schedule: Array<{ cron: string }> };
      jobs: Record<string, { steps: unknown[] }>;
    };
    expect(nightly.on.schedule).toHaveLength(1);
    expect(nightly.jobs.mutation?.steps).toBeDefined();
  });
});
