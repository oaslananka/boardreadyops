import fs from "node:fs/promises";
import {
  type FirmwareContractAdapter,
  type FirmwarePinAssignment,
  type LoadedFirmwareContract,
  normalizeHardwareKey,
} from "./contract.js";

export async function loadArduinoPinContract(file: string): Promise<LoadedFirmwareContract> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : "Arduino pin header could not be loaded"] };
  }
  const pins: FirmwarePinAssignment[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDefineLine(line);
    if (!parsed || !parsed.signal || !parsed.hardware) {
      continue;
    }
    const meta = parseMeta(parsed.comment);
    pins.push({
      signal: parsed.signal,
      hardware: normalizeHardwareKey(parsed.hardware),
      ...(meta.net ? { net: meta.net } : {}),
      ...(meta.pin ? { pin: meta.pin } : {}),
      ...(meta.environment ? { environment: meta.environment } : {}),
    });
  }
  if (pins.length === 0) {
    return { errors: ["Arduino pin header has no #define pin assignments"] };
  }
  return { document: { version: 1, pins }, errors: [] };
}

function parseDefineLine(line: string): { signal: string; hardware: string; comment: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) {
    return null;
  }
  const [code, ...commentParts] = trimmed.split("//");
  const match = /^#\s*define\s+([A-Za-z_]\w*)\s+(\S+)/.exec(code?.trim() ?? "");
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return { signal: match[1], hardware: match[2], comment: commentParts.join("//").trim() };
}

export const arduinoAdapter: FirmwareContractAdapter = {
  id: "arduino",
  label: "Arduino/C header",
  configKey: "arduino",
  load: loadArduinoPinContract,
};

function parseMeta(comment: string): {
  net?: string | undefined;
  pin?: string | undefined;
  environment?: string | undefined;
} {
  return {
    net: matchMeta(comment, "net"),
    pin: matchMeta(comment, "pin"),
    environment: matchMeta(comment, "env(?:ironment)?"),
  };
}

function matchMeta(comment: string, key: string): string | undefined {
  return new RegExp(`\\b${key}\\s*=\\s*(\\S+)`, "i").exec(comment)?.[1];
}
