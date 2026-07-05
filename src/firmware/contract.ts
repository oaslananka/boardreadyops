export interface FirmwarePinAssignment {
  signal: string;
  hardware: string;
  net?: string | undefined;
  pin?: string | undefined;
  environment?: string | undefined;
}

export interface FirmwareContract {
  version: 1;
  pins: FirmwarePinAssignment[];
}

export interface LoadedFirmwareContract {
  document?: FirmwareContract | undefined;
  errors: string[];
}

/**
 * A firmware contract adapter loads an ecosystem-specific firmware pin file (PlatformIO YAML,
 * Arduino/C header, ...) into the shared {@link FirmwareContract} model so a single rule can
 * compare any firmware ecosystem against the hardware pinmap.
 */
export interface FirmwareContractAdapter {
  /** Stable adapter id, e.g. `platformio` or `arduino`. */
  id: string;
  /** Human-facing label used in rule messages, e.g. `PlatformIO`. */
  label: string;
  /** Key under `firmware:` in `boardreadyops.yml` that points at this adapter's contract file. */
  configKey: "platformio" | "arduino" | "zephyr" | "esp-idf" | "stm32cubemx";
  load(file: string): Promise<LoadedFirmwareContract>;
}

export interface HardwareSignal {
  signal: string;
  hardware: string;
  net?: string | undefined;
}

export interface FirmwareContractComparison {
  /** Firmware signals that the hardware pinmap does not declare. */
  unknownFirmwareSignals: FirmwarePinAssignment[];
  /** Firmware signals whose hardware pin or net disagrees with the pinmap. */
  mismatches: Array<{ assignment: FirmwarePinAssignment; hardware: HardwareSignal }>;
  /** Hardware firmware signals that the firmware contract never assigns. */
  missingHardwareSignals: HardwareSignal[];
}

export function normalizeHardwareKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

/** Compare firmware pin assignments against the hardware pinmap, independent of adapter. */
export function compareFirmwareContract(
  pins: FirmwarePinAssignment[],
  hardwareBySignal: Map<string, HardwareSignal>,
): FirmwareContractComparison {
  const comparison: FirmwareContractComparison = {
    unknownFirmwareSignals: [],
    mismatches: [],
    missingHardwareSignals: [],
  };
  const firmwareSignals = new Set<string>();
  for (const assignment of pins) {
    firmwareSignals.add(assignment.signal);
    const hardware = hardwareBySignal.get(assignment.signal);
    if (!hardware) {
      comparison.unknownFirmwareSignals.push(assignment);
      continue;
    }
    const netMismatch = Boolean(assignment.net && assignment.net !== hardware.net);
    const hardwareMismatch = normalizeHardwareKey(assignment.hardware) !== hardware.hardware;
    if (netMismatch || hardwareMismatch) {
      comparison.mismatches.push({ assignment, hardware });
    }
  }
  for (const hardware of hardwareBySignal.values()) {
    if (!firmwareSignals.has(hardware.signal)) {
      comparison.missingHardwareSignals.push(hardware);
    }
  }
  return comparison;
}
