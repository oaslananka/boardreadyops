import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { zephyrAdapter } from "../../firmware/zephyr.js";
import { configFor, rule } from "../helpers.js";
import { makeFirmwareContractHandler } from "./shared.js";

const ruleId = "firmware.zephyr-pin-contract";

export const zephyrPinContractRule = rule(
  {
    id: ruleId,
    title: "Zephyr firmware pin contract does not match hardware pinmap",
    description: "Checks a Zephyr firmware pin contract YAML against the BoardReadyOps pinmap.",
    rationale:
      "Firmware pin assignments that drift from the hardware pinmap can ship boards whose code drives the wrong net or component pin.",
    defaultSeverity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.zephyr.pinAssignments",
      "projects.firmware.zephyr.pinAssignments",
      "rules.firmware.zephyr-pin-contract.file",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "zephyr", "contract"],
  },
  makeFirmwareContractHandler(ruleId, zephyrAdapter, resolveContract),
);

function resolveContract(context: RuleContext): string | undefined {
  const ruleFile = configFor(context, ruleId).file;
  const configured =
    (typeof ruleFile === "string" && ruleFile.trim() !== "" ? ruleFile : undefined) ??
    context.config.projects?.find((project) => project.firmware?.zephyr?.pinAssignments)?.firmware?.zephyr
      ?.pinAssignments ??
    context.config.firmware?.zephyr?.pinAssignments;
  return configured ? path.resolve(context.root, configured) : undefined;
}
