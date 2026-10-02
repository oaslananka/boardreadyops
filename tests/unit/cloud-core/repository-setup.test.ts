import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  isRepositorySetupPresetId,
  isRepositorySetupSelectablePresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "../../../packages/cloud-core/src/repository-setup.js";
import { validateConfig } from "../../../src/core/config.js";

type ParsedSetupConfig = {
  releaseMode?: unknown;
  "fail-on"?: unknown;
  rules?: Record<string, unknown>;
  report?: Record<string, unknown>;
};

function configSemantics(config: string) {
  const parsed = yaml.load(config) as ParsedSetupConfig;
  const rules = Object.entries(parsed.rules ?? {});
  return {
    releaseMode: parsed.releaseMode,
    failOn: parsed["fail-on"],
    enabledRules: rules
      .filter(([, value]) => value === true)
      .map(([name]) => name)
      .sort(),
    disabledRules: rules
      .filter(([, value]) => value === false)
      .map(([name]) => name)
      .sort(),
    reports: Object.fromEntries(Object.entries(parsed.report ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  };
}

describe("repository setup presets", () => {
  it("publishes only semantically distinct presets for new setup choices", () => {
    expect(repositorySetupPresets.map((preset) => preset.id)).toEqual(["open-source", "prototype", "production"]);
    for (const preset of repositorySetupPresets) {
      expect(validateConfig(yaml.load(preset.config)), preset.id).toEqual([]);
      expect(preset.config).not.toMatch(/token|secret|password|webhook:/iu);
      expect(preset.semanticSummary.length).toBeGreaterThan(0);
    }
  });

  it("snapshots parsed preset semantics instead of YAML line ordering", () => {
    expect(
      Object.fromEntries(repositorySetupPresets.map((preset) => [preset.id, configSemantics(preset.config)])),
    ).toMatchSnapshot();
  });

  it("keeps the historical contract id readable but unavailable for new selection", () => {
    const production = repositorySetupPreset("production");
    const legacyContract = repositorySetupPreset("contract-design");

    expect(isRepositorySetupPresetId("contract-design")).toBe(true);
    expect(isRepositorySetupSelectablePresetId("contract-design")).toBe(false);
    expect(legacyContract).toBeDefined();
    expect(configSemantics(legacyContract?.config ?? "")).toEqual(configSemantics(production?.config ?? ""));
  });

  it("uses a versioned setup and workflow contract", () => {
    expect(repositorySetupPresetVersion).toBe(1);
    expect(repositorySetupWorkflowContractVersion).toBe(1);
    expect(repositorySetupWorkflowPath).toBe("readiness-runner.yml");
  });

  it("resolves only known preset identifiers", () => {
    expect(isRepositorySetupPresetId("production")).toBe(true);
    expect(isRepositorySetupSelectablePresetId("production")).toBe(true);
    expect(repositorySetupPreset("production")?.releaseMode).toBe("production");
    expect(isRepositorySetupPresetId("unknown")).toBe(false);
    expect(repositorySetupPreset("unknown")).toBeUndefined();
  });
});
