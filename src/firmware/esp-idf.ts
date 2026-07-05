import type { FirmwareContractAdapter, LoadedFirmwareContract } from "./contract.js";
import { loadYamlPinContract } from "./yaml-contract.js";

export async function loadEspIdfPinContract(file: string): Promise<LoadedFirmwareContract> {
  return loadYamlPinContract(file, "ESP-IDF");
}

export const espIdfAdapter: FirmwareContractAdapter = {
  id: "esp-idf",
  label: "ESP-IDF",
  configKey: "esp-idf",
  load: loadEspIdfPinContract,
};
