import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  isRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "../../../packages/cloud-core/src/repository-setup.js";
import { validateConfig } from "../../../src/core/config.js";

describe("repository setup presets", () => {
  it("publishes the four product presets with valid version-one configurations", () => {
    expect(repositorySetupPresets.map((preset) => preset.id)).toEqual([
      "open-source",
      "prototype",
      "production",
      "contract-design",
    ]);
    for (const preset of repositorySetupPresets) {
      expect(validateConfig(yaml.load(preset.config)), preset.id).toEqual([]);
      expect(preset.config).not.toMatch(/token|secret|password|webhook:/iu);
    }
  });

  it("uses a versioned setup and workflow contract", () => {
    expect(repositorySetupPresetVersion).toBe(1);
    expect(repositorySetupWorkflowContractVersion).toBe(1);
    expect(repositorySetupWorkflowPath).toBe("readiness-runner.yml");
  });

  it("resolves only known preset identifiers", () => {
    expect(isRepositorySetupPresetId("production")).toBe(true);
    expect(repositorySetupPreset("production")?.releaseMode).toBe("production");
    expect(isRepositorySetupPresetId("unknown")).toBe(false);
    expect(repositorySetupPreset("unknown")).toBeUndefined();
  });
});
