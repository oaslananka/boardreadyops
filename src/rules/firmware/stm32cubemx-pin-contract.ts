import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { loadStm32CubeMxContract, stm32CubeMxAdapter } from "../../firmware/stm32cubemx.js";
import { configFor, rule, shouldRun } from "../helpers.js";
import { runFirmwareContractRule } from "./shared.js";

const ruleId = "firmware.stm32cubemx-pin-contract";

export const stm32CubeMxPinContractRule = rule(
  {
    id: ruleId,
    title: "STM32CubeMX pin assignment does not match hardware pinmap",
    description: "Parses a STM32CubeMX `.ioc` project file and checks GPIO labels against the BoardReadyOps pinmap.",
    rationale:
      "STM32CubeMX GPIO labels that drift from the hardware pinmap can ship boards whose code drives the wrong net or component pin.",
    defaultSeverity: "high",
    appliesTo: ["firmware", "pinmap"],
    configKeys: [
      "firmware.stm32cubemx.project",
      "projects.firmware.stm32cubemx.project",
      "rules.firmware.stm32cubemx-pin-contract.file",
      "rules.firmware.stm32cubemx-pin-contract.mcu-designator",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "stm32", "stm32cubemx", "contract"],
  },
  async (context) => {
    if (!shouldRun(context, ruleId)) {
      return [];
    }
    const iocPath = resolveContract(context);
    if (!iocPath) {
      return [];
    }
    const ruleConfig = configFor(context, ruleId);
    const mcuDesignator =
      typeof ruleConfig["mcu-designator"] === "string" && ruleConfig["mcu-designator"].trim() !== ""
        ? ruleConfig["mcu-designator"].trim()
        : typeof context.config.firmware?.stm32cubemx?.mcuDesignator === "string"
          ? context.config.firmware.stm32cubemx.mcuDesignator
          : "U1";

    // Use a custom loader that passes mcu-designator, then delegate to shared logic.
    const customAdapter = {
      ...stm32CubeMxAdapter,
      load: (file: string) => loadStm32CubeMxContract(file, mcuDesignator),
    };
    return runFirmwareContractRule(context, { ruleId, adapter: customAdapter, contractPath: iocPath });
  },
);

function resolveContract(context: RuleContext): string | undefined {
  const ruleFile = configFor(context, ruleId).file;
  const configured =
    (typeof ruleFile === "string" && ruleFile.trim() !== "" ? ruleFile : undefined) ??
    context.config.projects?.find((project) => project.firmware?.stm32cubemx?.project)?.firmware?.stm32cubemx
      ?.project ??
    context.config.firmware?.stm32cubemx?.project;
  return configured ? path.resolve(context.root, configured) : undefined;
}
