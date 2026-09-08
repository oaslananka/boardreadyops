import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { generateSetupPrPlan, generateWaiverPrPlan } from "../../../packages/cloud-core/src/repository-setup.js";
import { validateConfig } from "../../../src/core/config.js";

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

  it("falls back to default preset if invalid preset specified", () => {
    const plan = generateSetupPrPlan({
      // @ts-expect-error test fallback
      presetId: "invalid-preset",
    });
    expect(plan.preset.id).toBe("open-source");
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
