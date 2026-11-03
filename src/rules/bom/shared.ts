import path from "node:path";
import { loadBom } from "../../bom/loader.js";
import type { BomRow } from "../../bom/types.js";
import type { RuleContext } from "../../core/context.js";
import { parsePcb } from "../../kicad/pcb.js";
import { parseSchematic } from "../../kicad/schematic.js";
import { globFiles } from "../../util/glob.js";

export async function loadBomContext(context: RuleContext): Promise<{
  bomRows: BomRow[];
  schematicRows: BomRow[];
  pcbFootprints: Map<string, { footprint: string; dnp: boolean }>;
}> {
  const bomPath = await resolveBomPath(context);
  const bomRows = bomPath ? await loadBom(bomPath) : [];
  const schematicRows: BomRow[] = [];
  const pcbFootprints = new Map<string, { footprint: string; dnp: boolean }>();
  for (const project of context.projects) {
    for (const schematic of project.schematicFiles) {
      const parsed = await parseSchematic(path.resolve(context.root, schematic));
      // KiCad's virtual # references (power/graphical symbols) never denote
      // purchasable BOM parts, even when an older schematic omits (in_bom no).
      // Keep the symbols available to non-BOM schematic analysis.
      schematicRows.push(
        ...parsed.components.filter((component) => component.inBom !== false && !component.reference.startsWith("#")),
      );
    }
    for (const board of project.boardFiles) {
      const parsed = await parsePcb(path.resolve(context.root, board));
      for (const footprint of parsed.footprints) {
        pcbFootprints.set(footprint.reference, { footprint: footprint.footprint, dnp: footprint.dnp });
      }
    }
  }
  return { bomRows, schematicRows, pcbFootprints };
}

async function resolveBomPath(context: RuleContext): Promise<string | undefined> {
  if (context.options.bom && context.options.bom !== "auto") {
    return path.resolve(context.root, context.options.bom);
  }
  const configured = context.config.projects?.find((project) => project.bom)?.bom;
  if (configured) {
    return path.resolve(context.root, configured);
  }
  const found = await globFiles(context.root, ["**/bom*.csv", "**/*bom*.csv", "**/bom*.tsv", "**/*bom*.tsv"]);
  return found[0];
}
