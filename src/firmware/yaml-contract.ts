/**
 * Shared YAML pin-contract schema and loader for adapters that use the
 * BoardReadyOps YAML contract format (PlatformIO, ESP-IDF, Zephyr).
 */

import fs from "node:fs/promises";
import * as yaml from "js-yaml";
import { z } from "zod";
import { type FirmwareContract, type LoadedFirmwareContract, normalizeHardwareKey } from "./contract.js";

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

/**
 * Load and parse a YAML pin contract file.
 * Returns `{ document, errors: [] }` on success or `{ errors }` on failure.
 *
 * @param file        Path to the YAML contract file.
 * @param adapterLabel  Human-readable adapter name used in the error message.
 */
export async function loadYamlPinContract(file: string, adapterLabel: string): Promise<LoadedFirmwareContract> {
  try {
    const raw = yaml.load(await fs.readFile(file, "utf8"));
    const parsed = contractSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    }
    return { document: normalizeYamlContract(parsed.data), errors: [] };
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : `${adapterLabel} pin contract could not be loaded`] };
  }
}

function normalizeYamlContract(input: z.infer<typeof contractSchema>): FirmwareContract {
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
