import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  isRepositorySetupPresetId,
  isRepositorySetupSelectablePresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupSelectablePresets,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "../../../packages/cloud-core/src/repository-setup.js";
import { validateConfig } from "../../../src/core/config.js";

function semanticConfig(config: string): unknown {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return value;
  }
  return normalize(yaml.load(config));
}

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

  it("offers only semantically distinct presets for new setup revisions", () => {
    expect(repositorySetupSelectablePresets.map((preset) => preset.id)).toEqual([
      "open-source",
      "prototype",
      "production",
    ]);
    expect(isRepositorySetupSelectablePresetId("contract-design")).toBe(false);
    expect(isRepositorySetupPresetId("contract-design")).toBe(true);

    const selectableSemantics = repositorySetupSelectablePresets.map((preset) =>
      JSON.stringify(semanticConfig(preset.config)),
    );
    expect(new Set(selectableSemantics).size).toBe(selectableSemantics.length);

    const production = repositorySetupPreset("production");
    const legacyContract = repositorySetupPreset("contract-design");
    expect(production).toBeDefined();
    expect(legacyContract).toBeDefined();
    expect(semanticConfig(legacyContract?.config ?? "")).toEqual(semanticConfig(production?.config ?? ""));
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
