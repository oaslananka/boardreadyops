import { loadPinmap } from "../../pinmap/loader.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { resolvePinmap, schematicNetLabels } from "./shared.js";

export const pinmapNetLabelRule = rule(
  {
    id: "pinmap.net-label",
    title: "Pinmap net is not declared as a schematic net label",
    description: "Checks pinmap net names against schematic labels visible to firmware integration.",
    rationale: "Pinmap entries without matching schematic labels are easy to miswire in firmware.",
    defaultSeverity: "medium",
    appliesTo: ["pinmap", "schematic"],
    configKeys: ["pinmap", "projects.pinmap", "rules.pinmap.net-label.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "schematic"],
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "pinmap.net-label")) {
      return [];
    }
    if (shouldRun(context, "pinmap.verify")) {
      return [];
    }
    const pinmapPath = resolvePinmap(context);
    if (!pinmapPath) {
      return [];
    }
    const loaded = await loadPinmap(pinmapPath);
    const labels = await schematicNetLabels(context);
    return (loaded.document?.pins ?? [])
      .filter((entry) => !labels.has(entry.net))
      .map((entry) =>
        finding(context, {
          ruleId: "pinmap.net-label",
          severity: configuredSeverity(context, "pinmap.net-label", "medium"),
          message: `Pinmap net ${entry.net} has no matching schematic net label.`,
          path: pinmapPath,
          kind: "pinmap",
          line: 1,
          details: { net: entry.net, entry },
        }),
      );
  },
);
