import type { PcbFootprint } from "../../kicad/pcb.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { parsedBoards } from "./shared.js";

/**
 * Returns true if the footprint is likely a polarized component that requires
 * a clear polarity marking on the silkscreen or fab layer.
 */
function isPolarized(footprint: PcbFootprint): boolean {
  const ref = footprint.reference.toUpperCase();
  const fp = footprint.footprint.toLowerCase();
  // Diodes and LEDs are always polarized
  if (/^(D|LED|VD)\d/.test(ref)) {
    return true;
  }
  // Electrolytic and tantalum capacitors (by footprint name convention)
  if (/^C\d/.test(ref) && /cp_elec|tantalum|tant|pol[_-]?cap/i.test(fp)) {
    return true;
  }
  // Electrolytic by explicit footprint path prefix
  if (/capacitor_tht:cp_|capacitor_smd:cp_/.test(fp)) {
    return true;
  }
  return false;
}

/**
 * Returns true if the footprint appears to use a recognized KiCad library
 * path that typically includes polarity indicators (contains a colon separating
 * library:footprint, suggesting it is a library-managed footprint).
 */
function usesLibraryFootprint(footprint: PcbFootprint): boolean {
  return footprint.footprint.includes(":");
}

export const polarityMarkersRule = rule(
  {
    id: "manufacturing.dfm-polarity-markers",
    title: "Polarized component may lack a clear polarity marking",
    description:
      "Checks that polarized components (diodes, LEDs, electrolytic capacitors) use recognized library footprints that include standard polarity markings.",
    rationale:
      "Missing or ambiguous polarity marks cause assembly errors and can permanently damage polarized components on the first power-on.",
    defaultSeverity: "low",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.dfm-polarity-markers"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "dfm", "manufacturing", "pcb", "polarity"],
    category: "manufacturability",
    evidenceType: "heuristic",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.dfm-polarity-markers")) {
      return [];
    }
    const config = configFor(context, "manufacturing.dfm-polarity-markers");
    if (config.enabled !== true) {
      return [];
    }
    const output = [];
    for (const board of await parsedBoards(context)) {
      const suspects = board.footprints.filter(
        (fp) => !fp.dnp && !fp.boardOnly && isPolarized(fp) && !usesLibraryFootprint(fp),
      );
      for (const footprint of suspects) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.dfm-polarity-markers",
            severity: configuredSeverity(context, "manufacturing.dfm-polarity-markers", "low"),
            message: `Polarized component ${footprint.reference} uses a custom footprint (${footprint.footprint || "unnamed"}); verify a clear polarity marking is present on the silkscreen or fab layer.`,
            path: board.path,
            kind: "pcb",
            fix: {
              description:
                "Replace with a standard KiCad library footprint that includes a polarity marker, or manually verify the silkscreen and fab layer contain an unambiguous polarity indicator.",
            },
            details: { reference: footprint.reference, footprint: footprint.footprint },
          }),
        );
      }
    }
    return output;
  },
);
