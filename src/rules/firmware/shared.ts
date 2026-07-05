import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import type { Finding } from "../../core/findings.js";
import {
  compareFirmwareContract,
  type FirmwareContractAdapter,
  type HardwareSignal,
  normalizeHardwareKey,
} from "../../firmware/contract.js";
import { loadPinmap } from "../../pinmap/loader.js";
import { configuredSeverity, finding, shouldRun } from "../helpers.js";
import { resolvePinmap } from "../pinmap/shared.js";

/**
 * Returns the async rule handler for a firmware pin-contract rule.
 * Eliminates the identical shouldRun / resolveContract boilerplate across adapter-specific rules.
 */
export function makeFirmwareContractHandler(
  ruleId: string,
  adapter: FirmwareContractAdapter,
  resolveContractPath: (context: RuleContext) => string | undefined,
): (context: RuleContext) => Promise<Finding[]> {
  return async (context) => {
    if (!shouldRun(context, ruleId)) {
      return [];
    }
    const contractPath = resolveContractPath(context);
    if (!contractPath) {
      return [];
    }
    return runFirmwareContractRule(context, { ruleId, adapter, contractPath });
  };
}

/**
 * Shared body for adapter-driven firmware pin contract rules. Loads the adapter's contract and
 * the hardware pinmap, compares them, and emits findings for parse errors, unknown firmware
 * signals, hardware/net mismatches, and hardware signals missing from the firmware contract.
 */
export async function runFirmwareContractRule(
  context: RuleContext,
  options: { ruleId: string; adapter: FirmwareContractAdapter; contractPath: string },
): Promise<Finding[]> {
  const { ruleId, adapter, contractPath } = options;
  const pinmapPath = resolvePinmap(context);
  if (!pinmapPath) {
    return [];
  }
  const severity = configuredSeverity(context, ruleId, "high");
  const [contract, pinmap] = await Promise.all([adapter.load(contractPath), loadPinmap(pinmapPath)]);
  const output: Finding[] = [
    ...contract.errors.map((error) =>
      finding(context, {
        ruleId,
        severity,
        message: `${adapter.label} pin contract could not be parsed: ${error}`,
        path: contractPath,
        kind: "firmware",
        line: 1,
      }),
    ),
    ...pinmap.errors.map((error) =>
      finding(context, {
        ruleId,
        severity,
        message: `Pinmap could not be parsed: ${error}`,
        path: pinmapPath,
        kind: "pinmap",
        line: 1,
      }),
    ),
  ];
  if (contract.errors.length > 0 || pinmap.errors.length > 0) {
    return output;
  }

  const hardwareBySignal = new Map<string, HardwareSignal>(
    (pinmap.document?.pins ?? [])
      .filter((entry) => entry.firmware)
      .map((entry) => [
        entry.firmware as string,
        {
          signal: entry.firmware as string,
          hardware: normalizeHardwareKey(`${entry.designator}.${entry.pin}`),
          net: entry.net,
        },
      ]),
  );
  const comparison = compareFirmwareContract(contract.document?.pins ?? [], hardwareBySignal);

  for (const assignment of comparison.unknownFirmwareSignals) {
    output.push(
      finding(context, {
        ruleId,
        severity,
        message: `Firmware signal ${assignment.signal} is not declared by the hardware pinmap.`,
        path: contractPath,
        kind: "firmware",
        line: 1,
        details: { firmware: assignment, pinmapPath: path.relative(context.root, pinmapPath) },
      }),
    );
  }
  for (const { assignment, hardware } of comparison.mismatches) {
    output.push(
      finding(context, {
        ruleId,
        severity,
        message: `Firmware signal ${assignment.signal} maps to ${assignment.hardware}${assignment.net ? ` / ${assignment.net}` : ""}, but hardware pinmap expects ${hardware.hardware} / ${hardware.net}.`,
        path: contractPath,
        kind: "firmware",
        line: 1,
        details: {
          firmware: assignment,
          hardware,
          sources: {
            firmware: path.relative(context.root, contractPath),
            pinmap: path.relative(context.root, pinmapPath),
          },
        },
      }),
    );
  }
  for (const hardware of comparison.missingHardwareSignals) {
    output.push(
      finding(context, {
        ruleId,
        severity,
        message: `Hardware signal ${hardware.signal} is missing from the ${adapter.label} firmware pin contract.`,
        path: pinmapPath,
        kind: "pinmap",
        line: 1,
        details: { hardware, firmwarePath: path.relative(context.root, contractPath) },
      }),
    );
  }
  return output;
}
