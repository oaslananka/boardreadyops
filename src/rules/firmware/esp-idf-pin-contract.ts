import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { espIdfAdapter } from "../../firmware/esp-idf.js";
import { configFor, rule } from "../helpers.js";
import { makeFirmwareContractHandler } from "./shared.js";

const ruleId = "firmware.esp-idf-pin-contract";

export const espIdfPinContractRule = rule(
  {
    id: ruleId,
    title: "ESP-IDF firmware pin contract does not match hardware pinmap",
    description: "Checks an ESP-IDF firmware pin contract YAML against the BoardReadyOps pinmap.",
    rationale:
      "Firmware pin assignments that drift from the hardware pinmap can ship boards whose code drives the wrong net or component pin.",
    defaultSeverity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.esp-idf.pinAssignments",
      "projects.firmware.esp-idf.pinAssignments",
      "rules.firmware.esp-idf-pin-contract.file",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "esp-idf", "contract"],
  },
  makeFirmwareContractHandler(ruleId, espIdfAdapter, resolveContract),
);

function resolveContract(context: RuleContext): string | undefined {
  const ruleFile = configFor(context, ruleId).file;
  const configured =
    (typeof ruleFile === "string" && ruleFile.trim() !== "" ? ruleFile : undefined) ??
    context.config.projects?.find((project) => project.firmware?.["esp-idf"]?.pinAssignments)?.firmware?.["esp-idf"]
      ?.pinAssignments ??
    context.config.firmware?.["esp-idf"]?.pinAssignments;
  return configured ? path.resolve(context.root, configured) : undefined;
}
