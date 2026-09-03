import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { arduinoAdapter } from "../../firmware/arduino.js";
import { configFor, rule, shouldRun } from "../helpers.js";
import { runFirmwareContractRule } from "./shared.js";

const ruleId = "firmware.arduino-pin-contract";

export const arduinoPinContractRule = rule(
  {
    id: ruleId,
    title: "Arduino firmware pin contract does not match hardware pinmap",
    description: "Checks an Arduino/C `#define` firmware pin header against the BoardReadyOps pinmap.",
    rationale:
      "Firmware pin macros that drift from the hardware pinmap can ship boards whose code drives the wrong net or component pin.",
    defaultSeverity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.arduino.pinAssignments",
      "projects.firmware.arduino.pinAssignments",
      "rules.firmware.arduino-pin-contract.file",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "arduino", "contract"],
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, ruleId)) {
      return [];
    }
    const contractPath = resolveArduinoContract(context);
    if (!contractPath) {
      return [];
    }
    return runFirmwareContractRule(context, { ruleId, adapter: arduinoAdapter, contractPath });
  },
);

function resolveArduinoContract(context: RuleContext): string | undefined {
  const ruleFile = configFor(context, ruleId).file;
  const configured =
    (typeof ruleFile === "string" && ruleFile.trim() !== "" ? ruleFile : undefined) ??
    context.config.projects?.find((project) => project.firmware?.arduino?.pinAssignments)?.firmware?.arduino
      ?.pinAssignments ??
    context.config.firmware?.arduino?.pinAssignments;
  return configured ? path.resolve(context.root, configured) : undefined;
}
