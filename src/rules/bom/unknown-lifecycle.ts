import fs from "node:fs/promises";
import path from "node:path";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

export const unknownLifecycleRule = rule(
  {
    id: "bom.unknown-lifecycle",
    title: "BOM component lifecycle status is unknown",
    description:
      "Flags components that have no lifecycle data from any source (BOM field, lifecycle database, or supplier plugin). " +
      "Unknown lifecycle status is not silently treated as safe — the absence of data is itself a supply-chain signal.",
    rationale:
      "Teams often assume a missing lifecycle field means the part is active. " +
      "Surfacing unknown status makes the gap explicit so reviewers can decide whether to accept the risk.",
    defaultSeverity: "info",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.unknown-lifecycle.severity", "rules.bom.unknown-lifecycle.db"],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "lifecycle", "sourcing"],
  },
  async (context) => {
    if (!shouldRun(context, "bom.unknown-lifecycle")) {
      return [];
    }
    const { bomRows } = await loadBomContext(context);
    if (bomRows.length === 0) {
      return [];
    }

    const database = await loadLifecycleDb(context.root, configFor(context, "bom.unknown-lifecycle").db);
    const severity = configuredSeverity(context, "bom.unknown-lifecycle", "info");

    return bomRows
      .filter((row) => {
        if (row.dnp) return false;
        const hasLifecycleField = Boolean(row.lifecycle?.trim());
        const hasDbEntry = row.mpn ? database.has(row.mpn.trim().toUpperCase()) : false;
        return !hasLifecycleField && !hasDbEntry;
      })
      .map((row) =>
        finding(context, {
          ruleId: "bom.unknown-lifecycle",
          severity,
          message: `${row.reference} has no lifecycle status — unknown is not safe to assume active.`,
          path: row.sourcePath,
          kind: "bom",
          line: row.line,
          details: { reference: row.reference, mpn: row.mpn },
        }),
      );
  },
);

async function loadLifecycleDb(root: string, configured: unknown): Promise<Set<string>> {
  if (typeof configured !== "string" || configured.trim() === "") {
    return new Set();
  }
  try {
    const raw = JSON.parse(await fs.readFile(path.resolve(root, configured), "utf8")) as Record<string, unknown>;
    return new Set(
      Object.keys(raw)
        .filter((key) => typeof raw[key] === "string")
        .map((key) => key.trim().toUpperCase()),
    );
  } catch {
    return new Set();
  }
}
