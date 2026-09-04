import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import type { RuleExplanation } from "../../core/rule-registry.js";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { fileMtimeMs } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { normalizeRelative } from "../../util/path.js";
import { vendorOutputPatterns } from "../../vendor/outputs.js";
import { resolveVendorProfile } from "../../vendor/profiles.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

interface OutputInspection {
  required: string;
  patterns: string[];
  found: string[];
  fresh: boolean;
  vendorProfile?: string | undefined;
  vendorAssumptions: string[];
}

export const outputsPresentRule = {
  ...rule(
    {
      id: "manufacturing.outputs-present",
      title: "Required manufacturing outputs are missing or stale",
      description: "Checks required fabrication outputs and whether they are fresh relative to PCB sources.",
      rationale: "A release without current manufacturing outputs is not ready to send to a fab.",
      defaultSeverity: "high",
      appliesTo: ["pcb", "manifest"],
      configKeys: ["rules.manufacturing.outputs-present.required", "rules.manufacturing.outputs-present.patterns"],
      kicadVersions: ["9", "10", "future"],
      tags: ["fabrication", "manufacturing", "outputs"],
      ...RULE_CLASSIFICATIONS.manufacturabilityVendorProfile,
    },
    async (context) => {
      if (!shouldRun(context, "manufacturing.outputs-present")) {
        return [];
      }
      const inspections = await inspectRequiredOutputs(context);
      if (inspections.length === 0) {
        return [];
      }
      const output = [];
      for (const inspection of inspections) {
        if (inspection.found.length > 0 && inspection.fresh) {
          continue;
        }
        output.push(
          finding(context, {
            ruleId: "manufacturing.outputs-present",
            severity: configuredSeverity(context, "manufacturing.outputs-present", "high"),
            message: `Required manufacturing output ${inspection.required} is ${
              inspection.found.length === 0 ? "missing" : "stale"
            }.`,
            path: ".",
            kind: "manifest",
            details: {
              required: inspection.required,
              ...(inspection.vendorProfile ? { vendorProfile: inspection.vendorProfile } : {}),
              ...(inspection.vendorAssumptions.length > 0 ? { vendorAssumptions: inspection.vendorAssumptions } : {}),
            },
          }),
        );
      }
      return output;
    },
  ),
  explain: explainOutputsPresent,
};

async function inspectRequiredOutputs(context: RuleContext): Promise<OutputInspection[]> {
  const config = configFor(context, "manufacturing.outputs-present");
  const vendor = resolveVendorProfile(context.config.vendor);
  const required = requiredOutputNames(config.required, vendor?.requiredOutputs);
  if (required.length === 0) {
    return [];
  }
  const newestBoard = Math.max(
    0,
    ...(
      await Promise.all(
        context.projects.flatMap((project) =>
          project.boardFiles.map((board) => fileMtimeMs(path.resolve(context.root, board))),
        ),
      )
    ).filter((value): value is number => typeof value === "number"),
  );
  const inspections = [];
  for (const requiredOutput of required) {
    const outputPatterns = patternsFor(config.patterns, requiredOutput);
    const found = await globFiles(context.root, outputPatterns);
    const fresh =
      newestBoard === 0 ||
      (await Promise.all(found.map(fileMtimeMs))).some((mtime) => typeof mtime === "number" && mtime >= newestBoard);
    inspections.push({
      required: requiredOutput,
      patterns: outputPatterns,
      found,
      fresh,
      vendorProfile: vendor?.profile.id,
      vendorAssumptions: vendor?.assumptions ?? [],
    });
  }
  return inspections;
}

async function explainOutputsPresent(context: RuleContext): Promise<RuleExplanation> {
  const inspections = await inspectRequiredOutputs(context);
  return {
    ruleId: "manufacturing.outputs-present",
    summary: "Shows the configured manufacturing output search patterns and the files they matched.",
    sections: [
      {
        title: "Searched patterns",
        lines: inspections.map((inspection) => `${inspection.required}: ${inspection.patterns.join(", ")}`),
      },
      {
        title: "Found",
        lines: inspections.flatMap((inspection) =>
          inspection.found.length > 0
            ? inspection.found.map((file) => `${inspection.required}: ${normalizeRelative(context.root, file)}`)
            : [`${inspection.required}: none`],
        ),
      },
      {
        title: "Vendor profile",
        lines: vendorProfileLines(inspections),
      },
      {
        title: "Missing",
        lines: inspections
          .filter((inspection) => inspection.found.length === 0 || !inspection.fresh)
          .map((inspection) => (inspection.found.length === 0 ? inspection.required : `${inspection.required}: stale`)),
      },
    ],
  };
}

function requiredOutputNames(value: unknown, vendorRequired: string[] | undefined): string[] {
  const configured = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return [...new Set([...(vendorRequired ?? []), ...configured])];
}

function vendorProfileLines(inspections: OutputInspection[]): string[] {
  const vendor = inspections.find((inspection) => inspection.vendorProfile);
  if (!vendor?.vendorProfile) {
    return ["none"];
  }
  return [
    `profile: ${vendor.vendorProfile}`,
    ...vendor.vendorAssumptions.map((assumption) => `assumption: ${assumption}`),
  ];
}

function patternsFor(value: unknown, output: string): string[] {
  if (isPatternMap(value)) {
    const configured = value[output]?.filter((pattern) => pattern.trim().length > 0);
    if (configured && configured.length > 0) {
      return configured;
    }
  }
  return vendorOutputPatterns(output);
}

function isPatternMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (patterns) => Array.isArray(patterns) && patterns.every((pattern) => typeof pattern === "string"),
    )
  );
}
