import type { PcbFootprint } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { parsedBoards } from "./shared.js";

/**
 * Returns true if the footprint reference looks like a multi-pin IC or
 * polarised connector where a pin-1 marker is required.
 */
function needsPin1Marker(footprint: PcbFootprint): boolean {
  const ref = footprint.reference.toUpperCase();
  // ICs and integrated circuits
  if (/^(U|IC)\d/.test(ref)) {
    return true;
  }
  // Connectors that typically have pin 1 marked
  if (/^(J|P|CN|X)\d/.test(ref)) {
    return true;
  }
  return false;
}

/**
 * Returns true if the footprint uses a recognized library path.
 * Standard KiCad library footprints use "Library:FootprintName" syntax
 * and include pin-1 markers by convention.
 */
function usesLibraryFootprint(footprint: PcbFootprint): boolean {
  return footprint.footprint.includes(":");
}

export const pin1MarkersRule = rule(
  {
    id: "manufacturing.dfm-pin1-markers",
    title: "IC or connector may lack a clear pin-1 marker",
    description:
      "Checks that ICs and polarised connectors use recognized library footprints that include standard pin-1 markers.",
    rationale:
      "Without a clear pin-1 marker, components can be placed 180° rotated, causing immediate board failure and difficult rework.",
    defaultSeverity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.dfm-pin1-markers"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "dfm", "manufacturing", "pcb", "pin1"],
    category: "manufacturability",
    evidenceType: "heuristic",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.dfm-pin1-markers")) {
      return [];
    }
    const config = configFor(context, "manufacturing.dfm-pin1-markers");
    if (config.enabled !== true) {
      return [];
    }
    const output = [];
    for (const board of await parsedBoards(context)) {
      const suspects = board.footprints.filter(
        (fp) => !fp.dnp && !fp.boardOnly && needsPin1Marker(fp) && !usesLibraryFootprint(fp),
      );
      for (const footprint of suspects) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.dfm-pin1-markers",
            severity: configuredSeverity(context, "manufacturing.dfm-pin1-markers", "low"),
            message: `${footprint.reference} (${footprint.footprint || "custom footprint"}) uses a custom footprint; verify a clear pin-1 marker is present on the silkscreen or fab layer.`,
            path: board.path,
            kind: "pcb",
            fix: {
              description:
                "Replace with a standard KiCad library footprint that includes a pin-1 marker (dot, triangle, or chamfer), or manually add a clear pin-1 indicator to the silkscreen or fab layer.",
            },
            details: { reference: footprint.reference, footprint: footprint.footprint },
          }),
        );
      }
    }
    return output;
  },
);
