import type { FirmwareContractAdapter, LoadedFirmwareContract } from "./contract.js";
import { loadYamlPinContract } from "./yaml-contract.js";

export type LoadedPlatformioPinContract = LoadedFirmwareContract;

export async function loadPlatformioPinContract(file: string): Promise<LoadedPlatformioPinContract> {
  return loadYamlPinContract(file, "PlatformIO");
}

export const platformioAdapter: FirmwareContractAdapter = {
  id: "platformio",
  label: "PlatformIO",
  configKey: "platformio",
  load: loadPlatformioPinContract,
};
