import { buildAlternatesMap, hasApprovedAlternates } from "../../bom/alternates.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

export const singleSourceRule = rule(
  {
    id: "bom.single-source",
    title: "BOM part has a single supplier",
    description: "Checks supplier metadata for BOM rows that only list one source.",
    rationale: "Single-source parts increase procurement risk when a supplier changes availability.",
    defaultSeverity: "medium",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.single-source.severity", "bom.alternates"],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "sourcing", "supplier"],
  },
  async (context) => {
    if (!shouldRun(context, "bom.single-source")) {
      return [];
    }
    const { bomRows } = await loadBomContext(context);
    const alternatesMap = buildAlternatesMap(context.config.bom?.alternates ?? []);
    return bomRows
      .filter(
        (row) => !row.dnp && row.mpn && row.suppliers?.length === 1 && !hasApprovedAlternates(row.mpn, alternatesMap),
      )
      .map((row) =>
        finding(context, {
          ruleId: "bom.single-source",
          severity: configuredSeverity(context, "bom.single-source", "medium"),
          message: `${row.reference} uses ${row.mpn} with only one supplier listed.`,
          path: row.sourcePath,
          kind: "bom",
          line: row.line,
          details: { reference: row.reference, mpn: row.mpn, supplier: row.suppliers?.[0] },
        }),
      );
  },
);
