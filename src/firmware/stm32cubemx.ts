import fs from "node:fs/promises";
import {
  type FirmwareContractAdapter,
  type FirmwarePinAssignment,
  type LoadedFirmwareContract,
  normalizeHardwareKey,
} from "./contract.js";

/**
 * Pattern that matches a KV line in a STM32CubeMX .ioc file.
 * e.g. `PA0.GPIO_Label=BTN_USER` or `PB6.Signal=USART1_TX`
 */
const IOC_LINE_PATTERN = /^([A-Z]+\d+(?:\.\d+)?)\.([\w_]+)=(.+)$/;

/**
 * Parse a STM32CubeMX `.ioc` project file and extract pin-to-signal mappings.
 *
 * For each pin that has a `GPIO_Label`, that label becomes the firmware signal name.
 * The `hardware` field is constructed as `<mcuDesignator>.<pin>` (e.g. `U1.PA0`).
 */
export async function loadStm32CubeMxContract(file: string, mcuDesignator = "U1"): Promise<LoadedFirmwareContract> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : "STM32CubeMX .ioc file could not be loaded"] };
  }

  const pinLabels = new Map<string, string>();
  const pinNets = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const match = IOC_LINE_PATTERN.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, pinId, key, value] = match;
    if (!pinId || !key || !value) {
      continue;
    }
    if (key === "GPIO_Label") {
      pinLabels.set(pinId, value.trim());
    } else if (key === "Signal" && value.trim() !== "GPIO_Input" && value.trim() !== "GPIO_Output") {
      // Record peripheral signals (e.g. USART1_TX) as net hints
      pinNets.set(pinId, value.trim());
    }
  }

  if (pinLabels.size === 0) {
    return {
      errors: ["STM32CubeMX .ioc file has no GPIO_Label entries; add labels in the Pinout view to map signals"],
    };
  }

  const pins: FirmwarePinAssignment[] = [];
  for (const [pinId, label] of pinLabels) {
    const net = pinNets.get(pinId);
    pins.push({
      signal: label,
      hardware: normalizeHardwareKey(`${mcuDesignator}.${pinId}`),
      ...(net ? { net } : {}),
    });
  }

  return { document: { version: 1, pins }, errors: [] };
}

export const stm32CubeMxAdapter: FirmwareContractAdapter = {
  id: "stm32cubemx",
  label: "STM32CubeMX",
  configKey: "stm32cubemx",
  load: loadStm32CubeMxContract,
};
