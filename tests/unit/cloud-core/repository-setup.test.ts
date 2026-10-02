import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  isRepositorySetupPresetId,
  isSelectableRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "../../../packages/cloud-core/src/repository-setup.js";
import { validateConfig } from "../../../src/core/config.js";

describe("repository setup presets", () => {
  it("publishes only semantically distinct selectable presets with valid version-one configurations", () => {
    expect(repositorySetupPresets.map((preset) => preset.id)).toEqual(["open-source", "prototype", "production"]);
    for (const preset of repositorySetupPresets) {
      expect(validateConfig(yaml.load(preset.config)), preset.id).toEqual([]);
      expect(preset.config).not.toMatch(/token|secret|password|webhook:/iu);
    }
  });

  it("retains contract-design only for historical compatibility", () => {
    expect(isRepositorySetupPresetId("contract-design")).toBe(true);
    expect(isSelectableRepositorySetupPresetId("contract-design")).toBe(false);
    expect(yaml.load(repositorySetupPreset("contract-design")?.config ?? "")).toEqual(
      yaml.load(repositorySetupPreset("production")?.config ?? ""),
    );
  });

  it("snapshots generated preset semantics instead of YAML key ordering", () => {
    const semantics = repositorySetupPresets.map((preset) => {
      const config = yaml.load(preset.config) as {
        releaseMode?: string;
        "fail-on"?: string;
        rules?: Record<string, boolean>;
      };
      const rules = Object.entries(config.rules ?? {});
      return {
        id: preset.id,
        releaseMode: config.releaseMode,
        failOn: config["fail-on"],
        enabledRules: rules
          .filter(([, enabled]) => enabled)
          .map(([rule]) => rule)
          .sort(),
        disabledRules: rules
          .filter(([, enabled]) => !enabled)
          .map(([rule]) => rule)
          .sort(),
      };
    });
    expect(semantics).toMatchInlineSnapshot(`
      [
        {
          "disabledRules": [],
          "enabledRules": [
            "bom.compliance",
            "bom.eol-detection",
            "bom.identity-conflicts",
            "bom.lifecycle",
            "bom.missing-mpn",
            "bom.unknown-lifecycle",
            "design.board-outline",
            "design.unique-references",
            "drc.kicad",
            "manufacturing.drill-coverage",
            "manufacturing.fab-notes",
            "manufacturing.layer-stackup",
            "release.changelog-present",
            "release.revision-set",
            "release.tag-matches-revision",
            "release.version-format",
          ],
          "failOn": "high",
          "id": "open-source",
          "releaseMode": "pilot",
        },
        {
          "disabledRules": [
            "bom.single-source",
            "manufacturing.drill-coverage",
            "manufacturing.fab-notes",
            "manufacturing.package-completeness",
            "manufacturing.position-coverage",
            "release.changelog-present",
            "release.tag-matches-revision",
          ],
          "enabledRules": [
            "bom.compliance",
            "bom.eol-detection",
            "bom.lifecycle",
            "bom.missing-mpn",
            "bom.risk-score",
            "bom.unknown-lifecycle",
            "design.board-outline",
            "design.unique-references",
            "drc.kicad",
            "release.revision-set",
          ],
          "failOn": "high",
          "id": "prototype",
          "releaseMode": "prototype",
        },
        {
          "disabledRules": [],
          "enabledRules": [
            "bom.compliance",
            "bom.eol-detection",
            "bom.identity-conflicts",
            "bom.lifecycle",
            "bom.missing-mpn",
            "bom.risk-score",
            "bom.single-source",
            "bom.unknown-lifecycle",
            "design.board-outline",
            "design.unique-references",
            "drc.kicad",
            "erc.kicad",
            "manufacturing.assembly-sides",
            "manufacturing.drill-coverage",
            "manufacturing.fab-notes",
            "manufacturing.fiducials",
            "manufacturing.layer-stackup",
            "manufacturing.package-completeness",
            "manufacturing.pin1-markers",
            "manufacturing.polarity-markers",
            "manufacturing.position-coverage",
            "manufacturing.silkscreen-over-pad",
            "manufacturing.test-points",
            "manufacturing.tooling-holes",
            "release.changelog-present",
            "release.revision-set",
            "release.tag-matches-revision",
            "release.version-format",
          ],
          "failOn": "medium",
          "id": "production",
          "releaseMode": "production",
        },
      ]
    `);
  });

  it("uses a versioned setup and workflow contract", () => {
    expect(repositorySetupPresetVersion).toBe(1);
    expect(repositorySetupWorkflowContractVersion).toBe(1);
    expect(repositorySetupWorkflowPath).toBe("readiness-runner.yml");
  });

  it("resolves only known preset identifiers", () => {
    expect(isRepositorySetupPresetId("production")).toBe(true);
    expect(isSelectableRepositorySetupPresetId("production")).toBe(true);
    expect(repositorySetupPreset("production")?.releaseMode).toBe("production");
    expect(isRepositorySetupPresetId("unknown")).toBe(false);
    expect(repositorySetupPreset("unknown")).toBeUndefined();
  });
});
