import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { platformioAdapter } from "../../firmware/platformio.js";
import { configFor, rule } from "../helpers.js";
import { makeFirmwareContractHandler } from "./shared.js";

const ruleId = "firmware.platformio-pin-contract";

export const platformioPinContractRule = rule(
  {
    id: ruleId,
    title: "PlatformIO firmware pin contract does not match hardware pinmap",
    description: "Checks a PlatformIO-style firmware pin contract against the BoardReadyOps pinmap.",
    rationale:
      "Firmware pin assignments that drift from the hardware pinmap can ship boards whose code drives the wrong net or component pin.",
    defaultSeverity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.platformio.pinAssignments",
      "projects.firmware.platformio.pinAssignments",
      "rules.firmware.platformio-pin-contract.file",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "platformio", "contract"],
  },
  makeFirmwareContractHandler(ruleId, platformioAdapter, resolvePlatformioContract),
);

function resolvePlatformioContract(context: RuleContext): string | undefined {
  const ruleFile = configFor(context, ruleId).file;
  const configured =
    (typeof ruleFile === "string" && ruleFile.trim() !== "" ? ruleFile : undefined) ??
    context.config.projects?.find((project) => project.firmware?.platformio?.pinAssignments)?.firmware?.platformio
      ?.pinAssignments ??
    context.config.firmware?.platformio?.pinAssignments;
  return configured ? path.resolve(context.root, configured) : undefined;
}
