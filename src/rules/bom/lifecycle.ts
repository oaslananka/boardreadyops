import fs from "node:fs/promises";
import path from "node:path";
import { classifyLifecycleStatus } from "../../bom/lifecycle.js";
import type { BomRow } from "../../bom/types.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { loadBomContext } from "./shared.js";

const lifecyclePattern = /\b(eol|obsolete|discontinued|nrnd|not recommended|preview)\b/i;

export const lifecycleRule = rule(
  {
    id: "bom.lifecycle",
    title: "BOM component lifecycle status is risky",
    description: "Checks BOM lifecycle fields and local lifecycle data for risky component states.",
    rationale: "Lifecycle risk should be visible before teams commit to parts and fab outputs.",
    defaultSeverity: "medium",
    appliesTo: ["bom"],
    configKeys: ["rules.bom.lifecycle.db"],
    kicadVersions: ["9", "10", "future"],
    tags: ["bom", "lifecycle", "sourcing"],
  },
  async (context) => {
    if (!shouldRun(context, "bom.lifecycle")) {
      return [];
    }
    const { bomRows, schematicRows } = await loadBomContext(context);
    const rows = bomRows.length > 0 ? bomRows : schematicRows;
    const database = await loadLifecycleDatabase(context.root, configFor(context, "bom.lifecycle").db);
    return rows.flatMap((row) => lifecycleFindings(row, database.get(row.mpn ?? ""), context));
  },
);

async function loadLifecycleDatabase(root: string, configured: unknown): Promise<Map<string, string>> {
  if (typeof configured !== "string" || configured.trim() === "") {
    return new Map();
  }
  try {
    const raw = JSON.parse(await fs.readFile(path.resolve(root, configured), "utf8")) as Record<string, unknown>;
    return new Map(
      Object.entries(raw)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([mpn, status]) => [mpn, status]),
    );
  } catch {
    return new Map();
  }
}

function lifecycleFindings(row: BomRow, databaseStatus: string | undefined, context: Parameters<typeof finding>[0]) {
  if (row.dnp) {
    return [];
  }
  if (
    row.lifecycle &&
    shouldRun(context, "bom.eol-detection") &&
    /\b(eol|obsolete|nrnd|not recommended)\b/i.test(row.lifecycle)
  ) {
    return [];
  }
  const lifecycle = row.lifecycle ?? databaseStatus;
  if (!lifecycle || !lifecyclePattern.test(lifecycle)) {
    return [];
  }
  const ruleConfig = configFor(context, "bom.lifecycle");
  const canonicalStatus = classifyLifecycleStatus(lifecycle);
  const severity =
    typeof ruleConfig.severity === "string"
      ? configuredSeverity(context, "bom.lifecycle", "medium")
      : canonicalStatus === "eol" || canonicalStatus === "obsolete"
        ? "high"
        : configuredSeverity(context, "bom.lifecycle", "medium");
  return [
    finding(context, {
      ruleId: "bom.lifecycle",
      severity,
      message: `${row.reference} lifecycle status is ${lifecycle}.`,
      path: row.sourcePath,
      kind: row.sourceKind === "bom" ? "bom" : "schematic",
      line: row.line,
      details: { reference: row.reference, mpn: row.mpn, lifecycle },
    }),
  ];
}
