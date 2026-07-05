import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

export const identityConflictsRule = rule(
  {
    id: "bom.identity-conflicts",
    title: "BOM component identity conflict",
    description:
      "Detects components whose identity fields (MPN, manufacturer) differ between BOM and schematic sources, or appear multiple times within the same BOM with conflicting values.",
    rationale:
      "Conflicting component identities produce ambiguous sourcing decisions and unreliable release diffs. " +
      "A stable, consistent identity ensures every tool in the release pipeline references the same part.",
    defaultSeverity: "high",
    appliesTo: ["bom", "schematic"],
    configKeys: ["rules.bom.identity-conflicts.severity"],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "identity", "sourcing"],
  },
  async (context) => {
    if (!shouldRun(context, "bom.identity-conflicts")) {
      return [];
    }
    const { bomRows, schematicRows } = await loadBomContext(context);

    const findings = [];

    // Detect within-BOM duplicate references with conflicting MPNs
    const bomByRef = new Map<string, { mpn: string; line: number | undefined; path: string }[]>();
    for (const row of bomRows) {
      if (!row.reference || row.dnp) continue;
      const existing = bomByRef.get(row.reference) ?? [];
      existing.push({ mpn: row.mpn ?? "", line: row.line, path: row.sourcePath });
      bomByRef.set(row.reference, existing);
    }
    for (const [reference, entries] of bomByRef) {
      const uniqueMpns = new Set(entries.map((entry) => entry.mpn.toLowerCase()));
      if (uniqueMpns.size > 1) {
        const first = entries[0];
        findings.push(
          finding(context, {
            ruleId: "bom.identity-conflicts",
            severity: configuredSeverity(context, "bom.identity-conflicts", "high"),
            message: `${reference} appears ${entries.length} times in the BOM with conflicting MPNs: ${[...uniqueMpns].join(", ")}.`,
            path: first?.path ?? "",
            kind: "bom",
            line: first?.line,
            details: {
              reference,
              conflictType: "within-bom",
              mpns: [...uniqueMpns],
            },
          }),
        );
      }
    }

    // Detect BOM vs schematic MPN conflicts (only when both sources are available)
    if (bomRows.length > 0 && schematicRows.length > 0) {
      const schematicMpn = new Map<string, string>();
      for (const row of schematicRows) {
        if (row.mpn) {
          schematicMpn.set(row.reference, row.mpn);
        }
      }
      for (const row of bomRows) {
        if (!row.mpn || row.dnp) continue;
        const schemMpn = schematicMpn.get(row.reference);
        if (schemMpn && schemMpn.toLowerCase() !== row.mpn.toLowerCase()) {
          findings.push(
            finding(context, {
              ruleId: "bom.identity-conflicts",
              severity: configuredSeverity(context, "bom.identity-conflicts", "high"),
              message: `${row.reference} has MPN "${row.mpn}" in the BOM but "${schemMpn}" in the schematic.`,
              path: row.sourcePath,
              kind: "bom",
              line: row.line,
              details: {
                reference: row.reference,
                conflictType: "bom-schematic",
                bomMpn: row.mpn,
                schematicMpn: schemMpn,
              },
            }),
          );
        }
      }
    }

    return findings;
  },
);
