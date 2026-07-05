import type { FirmwareContractAdapter, LoadedFirmwareContract } from "./contract.js";
import { loadYamlPinContract } from "./yaml-contract.js";

export async function loadZephyrPinContract(file: string): Promise<LoadedFirmwareContract> {
  return loadYamlPinContract(file, "Zephyr");
}

export const zephyrAdapter: FirmwareContractAdapter = {
  id: "zephyr",
  label: "Zephyr",
  configKey: "zephyr",
  load: loadZephyrPinContract,
};
