import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { parsePcb } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const layerStackupRule = rule(
  {
    id: "manufacturing.layer-stackup",
    title: "PCB stackup layer count does not match expected copper layers",
    description: "Compares the parsed PCB stackup layer count with configured expectations.",
    rationale: "Stackup mismatches change fabrication cost and electrical assumptions.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.layer-stackup.expected-layers"],
    kicadVersions: ["9", "10", "future"],
    tags: ["manufacturing", "pcb", "stackup"],
    ...RULE_CLASSIFICATIONS.manufacturabilityCapabilityThreshold,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.layer-stackup")) {
      return [];
    }
    const expected = configFor(context, "manufacturing.layer-stackup")["expected-layers"];
    const output = [];
    for (const project of context.projects) {
      for (const board of project.boardFiles) {
        const parsed = await parsePcb(path.resolve(context.root, board));
        const expectedLayers = typeof expected === "number" ? expected : parsed.copperLayerCount;
        if (parsed.stackupLayerCount !== undefined && parsed.stackupLayerCount !== expectedLayers) {
          output.push(
            finding(context, {
              ruleId: "manufacturing.layer-stackup",
              severity: configuredSeverity(context, "manufacturing.layer-stackup", "medium"),
              message: `PCB stackup has ${parsed.stackupLayerCount} layers, expected ${expectedLayers}.`,
              path: board,
              kind: "pcb",
              details: { expectedLayers, stackupLayers: parsed.stackupLayerCount },
            }),
          );
        }
      }
    }
    return output;
  },
);
