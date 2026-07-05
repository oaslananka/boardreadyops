import fs from "node:fs/promises";
import * as yaml from "js-yaml";
import { z } from "zod";
import {
  type FirmwareContract,
  type FirmwareContractAdapter,
  type LoadedFirmwareContract,
  normalizeHardwareKey,
} from "./contract.js";

const pinObjectSchema = z.strictObject({
  hardware: z.string().min(1),
  net: z.string().min(1).optional(),
  pin: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
});

const pinArrayEntrySchema = pinObjectSchema.extend({
  signal: z.string().min(1),
});

const contractSchema = z.strictObject({
  version: z.literal(1),
  pins: z.union([z.record(z.string().min(1), pinObjectSchema), z.array(pinArrayEntrySchema)]),
});

export async function loadEspIdfPinContract(file: string): Promise<LoadedFirmwareContract> {
  try {
    const raw = yaml.load(await fs.readFile(file, "utf8"));
    const parsed = contractSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    }
    return { document: normalizeContract(parsed.data), errors: [] };
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : "ESP-IDF pin contract could not be loaded"] };
  }
}

export const espIdfAdapter: FirmwareContractAdapter = {
  id: "esp-idf",
  label: "ESP-IDF",
  configKey: "esp-idf",
  load: loadEspIdfPinContract,
};

function normalizeContract(input: z.infer<typeof contractSchema>): FirmwareContract {
  const pins = Array.isArray(input.pins)
    ? input.pins.map((entry) => ({
        signal: entry.signal,
        hardware: normalizeHardwareKey(entry.hardware),
        ...(entry.net ? { net: entry.net } : {}),
        ...(entry.pin ? { pin: entry.pin } : {}),
        ...(entry.environment ? { environment: entry.environment } : {}),
      }))
    : Object.entries(input.pins).map(([signal, entry]) => ({
        signal,
        hardware: normalizeHardwareKey(entry.hardware),
        ...(entry.net ? { net: entry.net } : {}),
        ...(entry.pin ? { pin: entry.pin } : {}),
        ...(entry.environment ? { environment: entry.environment } : {}),
      }));
  return { version: 1, pins };
}
