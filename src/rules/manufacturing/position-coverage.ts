import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import {
  assemblyFootprints,
  missingReferences,
  parsedBoards,
  positionOutputText,
  projectOutputSearchRoots,
} from "./shared.js";

export const positionCoverageRule = rule(
  {
    id: "manufacturing.position-coverage",
    title: "Position output does not cover populated assembly references",
    description: "Checks configured assembly jobs for position/CPL output coverage of populated PCB references.",
    rationale: "Pick-and-place data must cover populated components so assembly review does not miss placements.",
    defaultSeverity: "medium",
    appliesTo: ["pcb", "manifest"],
    configKeys: ["rules.manufacturing.position-coverage.patterns"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "cpl", "dfa", "manufacturing", "position"],
    category: "assembly",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.position-coverage")) {
      return [];
    }
    const config = configFor(context, "manufacturing.position-coverage");
    if (config.enabled !== true) {
      return [];
    }
    const patterns = Array.isArray(config.patterns)
      ? config.patterns.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    const position = await positionOutputText(context.root, projectOutputSearchRoots(context), patterns);
    const output = [];
    for (const board of await parsedBoards(context)) {
      const references = assemblyFootprints(board.footprints).map((footprint) => footprint.reference);
      if (references.length === 0) {
        continue;
      }
      if (position.files.length === 0) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.position-coverage",
            severity: configuredSeverity(context, "manufacturing.position-coverage", "medium"),
            message: "Assembly position/CPL output is required but no position output was found.",
            path: board.path,
            kind: "manifest",
            details: { missingRefs: references.slice(0, 20), totalMissingRefs: references.length },
          }),
        );
        continue;
      }
      const missingRefs = missingReferences(position.text, references);
      if (missingRefs.length > 0) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.position-coverage",
            severity: configuredSeverity(context, "manufacturing.position-coverage", "medium"),
            message: `${missingRefs.length} populated assembly reference(s) are missing from position outputs.`,
            path: board.path,
            kind: "pcb",
            details: {
              missingRefs: missingRefs.slice(0, 20),
              totalMissingRefs: missingRefs.length,
              positionFiles: position.files,
            },
          }),
        );
      }
    }
    return output;
  },
);
