import { describe, expect, it } from "vitest";
import {
  definePlugin,
  defineRulePack,
  type PluginFinding,
  type RulePackManifest,
} from "../../packages/plugin-sdk/src/index.js";

describe("Plugin SDK Contract Verification", () => {
  it("defines and registers a compliant plugin rule with correct type mapping", () => {
    const plugin = definePlugin({
      name: "boardreadyops-plugin-contract-test",
      version: "1.0.0",
      permissions: ["fs:read"],
      rules: [
        {
          meta: {
            id: "contract.test-rule",
            title: "Contract Test Rule",
            description: "Verifies the SDK boundary types match core types.",
            rationale: "Ensures no compilation drift.",
            defaultSeverity: "medium",
            appliesTo: ["pcb"],
            configKeys: [],
            kicadVersions: ["10"],
            tags: ["test"],
          },
          run(context) {
            expect(context.root).toBeDefined();
            expect(context.projects).toBeDefined();
            expect(context.logger).toBeDefined();

            const finding: PluginFinding = {
              ruleId: "contract.test-rule",
              severity: "medium",
              message: "Contract verification finding",
              resource: {
                path: "board.kicad_pcb",
                kind: "pcb",
              },
            };
            return [finding];
          },
        },
      ],
    });

    expect(plugin.name).toBe("boardreadyops-plugin-contract-test");
    const rules = plugin.rules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.meta.id).toBe("contract.test-rule");
  });

  it("defineRulePack returns the manifest unchanged with correct types", () => {
    const pack: RulePackManifest = {
      id: "com.example.contract-test-pack",
      name: "Contract Test Pack",
      version: "1.0.0",
      description: "Verifies defineRulePack SDK boundary types.",
      tags: ["test"],
      compatibility: {
        boardreadyopsMin: "1.8.0",
        kicadVersions: ["9", "10", "future"],
      },
      rules: {
        "bom.missing-mpn": true,
        "bom.lifecycle": { enabled: true, severity: "medium" },
        "manufacturing.package-completeness": false,
      },
    };

    const result = defineRulePack(pack);
    expect(result.id).toBe("com.example.contract-test-pack");
    expect(result.version).toBe("1.0.0");
    expect(result.rules?.["bom.missing-mpn"]).toBe(true);
    expect(result.rules?.["manufacturing.package-completeness"]).toBe(false);
    const lifecycleOverride = result.rules?.["bom.lifecycle"];
    expect(lifecycleOverride).toMatchObject({ enabled: true, severity: "medium" });
    expect(result.compatibility?.boardreadyopsMin).toBe("1.8.0");
  });

  it("definePlugin with rulePacks correctly carries rule pack manifests", () => {
    const pack = defineRulePack({
      id: "com.example.inline-pack",
      name: "Inline Pack",
      version: "0.1.0",
      description: "Inline pack bundled inside a plugin.",
      rules: { "bom.compliance": true },
    });

    const plugin = definePlugin({
      name: "boardreadyops-plugin-with-packs",
      version: "1.0.0",
      rulePacks: [pack],
    });

    expect(plugin.rulePacks).toHaveLength(1);
    expect(plugin.rulePacks?.[0]?.id).toBe("com.example.inline-pack");
  });
});
