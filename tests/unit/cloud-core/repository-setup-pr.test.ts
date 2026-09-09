import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { generateSetupPrPlan, generateWaiverPrPlan } from "../../../packages/cloud-core/src/repository-setup.js";
import { validateConfig } from "../../../src/core/config.js";

const expression = (value: string) => `$${value}`;

describe("Setup and Waiver PR plan generation", () => {
  it("generates a complete setup PR plan for production preset", () => {
    const plan = generateSetupPrPlan({
      presetId: "production",
      workflowContent: "name: BoardReadyOps Readiness Runner\n",
    });

    expect(plan.branchName).toBe("boardreadyops/setup");
    expect(plan.prTitle).toContain("initialize BoardReadyOps release readiness (Production release)");
    expect(plan.prBody).toContain("Production release");
    expect(plan.prBody).toContain("boardreadyops.yml");
    expect(plan.prBody).toContain(".github/workflows/readiness-runner.yml");
    expect(plan.prBody).toContain("id-token: write");
    expect(plan.prBody).toContain("Rollback");

    expect(plan.files).toHaveLength(2);
    const configFile = plan.files.find((f) => f.path === "boardreadyops.yml");
    const workflowFile = plan.files.find((f) => f.path === ".github/workflows/readiness-runner.yml");

    expect(configFile).toBeDefined();
    expect(workflowFile).toBeDefined();
    if (!configFile) throw new Error("Expected configFile");

    // Verify config is valid against core config schema
    const parsedConfig = yaml.load(configFile.content);
    expect(validateConfig(parsedConfig)).toEqual([]);
  });

  it("generates a self-contained setup probe workflow pinned to the trusted cloud origin", () => {
    const plan = generateSetupPrPlan({
      presetId: "open-source",
      cloudOrigin: "https://cloud.example",
    });
    const workflowFile = plan.files.find((file) => file.path === ".github/workflows/readiness-runner.yml");
    expect(workflowFile).toBeDefined();
    if (!workflowFile) throw new Error("Expected workflowFile");

    const document = yaml.load(workflowFile.content) as Record<string, unknown>;
    const jobs = document.jobs as Record<string, Record<string, unknown>>;
    const probe = jobs["setup-probe"];
    expect(probe?.if).toBe(expression("{{ inputs.setup_probe_id != '' }}"));
    expect(probe?.permissions).toEqual({ contents: "read", "id-token": "write" });
    const setupProbeVariable = "${" + "SETUP_PROBE_ID}";
    expect(workflowFile.content).toContain(
      `expected_url="https://cloud.example/api/v1/setup-probes/result?probe_id=${setupProbeVariable}"`,
    );
    expect(workflowFile.content).not.toContain("vars.BOARDREADYOPS_CLOUD_ORIGIN");
    expect(workflowFile.content).not.toContain("contents: write");
  });

  it("falls back to default preset if invalid preset specified", () => {
    const plan = generateSetupPrPlan({
      // @ts-expect-error test fallback
      presetId: "invalid-preset",
    });
    expect(plan.preset.id).toBe("open-source");
  });

  it("fails closed when a waiver plan has no current repository config", () => {
    expect(() =>
      generateWaiverPrPlan({
        ruleId: "manufacturing.drill-coverage",
        reason: "Temporary fab exception",
      }),
    ).toThrow(/current.*boardreadyops\.yml.*required/iu);
  });

  it("fails closed when the current repository config is malformed", () => {
    expect(() =>
      generateWaiverPrPlan({
        ruleId: "manufacturing.drill-coverage",
        reason: "Temporary fab exception",
        currentConfigContent: "version: [unterminated",
      }),
    ).toThrow(/current.*boardreadyops\.yml.*valid YAML/iu);
  });

  it("does not duplicate an identical waiver already present in repository config", () => {
    const plan = generateWaiverPrPlan({
      ruleId: "rule.test",
      reason: "temporary exception",
      owner: "octocat",
      currentConfigContent:
        "version: 1\nmode: enforce\nwaivers:\n  - rule: rule.test\n    owner: octocat\n    reason: temporary exception\n",
    });

    const updated = yaml.load(plan.files[0]?.content ?? "") as Record<string, unknown>;
    expect(updated.waivers).toEqual([{ rule: "rule.test", owner: "octocat", reason: "temporary exception" }]);
  });

  it("preserves repository YAML comments while adding a waiver", () => {
    const plan = generateWaiverPrPlan({
      ruleId: "rule.test",
      reason: "temporary exception",
      owner: "octocat",
      currentConfigContent:
        "# keep repository context\nversion: 1\nmode: enforce # keep operator note\nrules:\n  bom.missing-mpn: true # keep rule note\n",
    });

    const content = plan.files[0]?.content ?? "";
    expect(content).toContain("# keep repository context");
    expect(content).toContain("mode: enforce # keep operator note");
    expect(content).toContain("bom.missing-mpn: true # keep rule note");
  });

  it("generates a waiver PR plan that appends a waiver to existing config", () => {
    const initialConfig = "version: 1\nmode: enforce\n";
    const plan = generateWaiverPrPlan({
      ruleId: "manufacturing.drill-coverage",
      reason: "External fab house provides drills",
      owner: "engineer@hardware.corp",
      currentConfigContent: initialConfig,
    });

    expect(plan.branchName).toBe("boardreadyops/waiver-manufacturing.drill-coverage");
    expect(plan.prTitle).toContain("add waiver for manufacturing.drill-coverage");
    expect(plan.prBody).toContain("manufacturing.drill-coverage");
    expect(plan.prBody).toContain("External fab house provides drills");
    expect(plan.files).toHaveLength(1);

    const updatedConfig = plan.files[0];
    if (!updatedConfig) throw new Error("Expected updatedConfig");
    expect(updatedConfig.path).toBe("boardreadyops.yml");
    const parsed = yaml.load(updatedConfig.content) as Record<string, unknown>;
    expect(Array.isArray(parsed.waivers)).toBe(true);
    const waivers = parsed.waivers as Array<Record<string, string>>;
    expect(waivers).toHaveLength(1);
    expect(waivers[0]?.rule).toBe("manufacturing.drill-coverage");
    expect(waivers[0]?.reason).toBe("External fab house provides drills");
    expect(waivers[0]?.owner).toBe("engineer@hardware.corp");
  });
});
