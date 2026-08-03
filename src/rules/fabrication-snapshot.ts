import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { loadBom } from "../bom/loader.js";
import type { BomRow } from "../bom/types.js";
import type { BoardReadyOpsConfig } from "../core/config.js";
import type { PipelineOptions, ProjectContext } from "../core/context.js";
import type { FabricationSnapshot } from "../core/diff/fabrication.js";
import { parseSchematic } from "../kicad/schematic.js";
import { globFiles } from "../util/glob.js";
import { toPosixPath } from "../util/path.js";

const manufacturingPatterns: Record<string, string[]> = {
  gerber: ["**/*.gbr", "**/*.gbrjob"],
  drill: ["**/*.drl"],
  position: ["**/*.pos", "**/*position*.csv"],
};

export async function captureFabricationSnapshot(
  root: string,
  projects: ProjectContext[],
  options: PipelineOptions,
  config: BoardReadyOpsConfig,
): Promise<FabricationSnapshot> {
  const loadedBoms = await loadBomRows(await resolveBomPaths(root, options, config));
  const bomRows = loadedBoms.paths.length > 0 ? loadedBoms.rows : await loadSchematicRows(root, projects);
  const snapshotBom = bomRows.map((row) => snapshotBomRow(root, row));
  const outputs = await Promise.all(
    [
      loadedBoms.paths.length > 0 ? outputFromFiles(root, "bom", loadedBoms.paths) : outputFromRows("bom", snapshotBom),
      ...Object.entries(manufacturingPatterns).map(async ([kind, patterns]) =>
        outputFromFiles(root, kind, await projectScopedFiles(root, projects, patterns)),
      ),
    ].filter((entry): entry is Promise<FabricationSnapshot["outputs"][number]> => Boolean(entry)),
  );

  return {
    bom: snapshotBom.toSorted(compareSnapshotBomRows),
    outputs: outputs.toSorted((a, b) => a.kind.localeCompare(b.kind)),
  };
}

async function resolveBomPaths(root: string, options: PipelineOptions, config: BoardReadyOpsConfig): Promise<string[]> {
  if (options.bom && options.bom !== "auto") {
    return [path.resolve(root, options.bom)];
  }
  const configured = config.projects
    ?.flatMap((project) => (project.bom ? [path.resolve(root, project.bom)] : []))
    .sort((a, b) => a.localeCompare(b));
  if (configured && configured.length > 0) {
    return [...new Set(configured)];
  }
  return globFiles(root, ["**/bom*.csv", "**/*bom*.csv", "**/bom*.tsv", "**/*bom*.tsv"]);
}

async function loadBomRows(paths: string[]): Promise<{ paths: string[]; rows: BomRow[] }> {
  const loadedPaths: string[] = [];
  const rows: BomRow[] = [];
  for (const bomPath of paths) {
    try {
      rows.push(...(await loadBom(bomPath)));
      loadedPaths.push(bomPath);
    } catch {
      // Fabrication snapshots should not make non-BOM scans depend on BOM availability.
    }
  }
  return { paths: loadedPaths, rows };
}

async function loadSchematicRows(root: string, projects: ProjectContext[]): Promise<BomRow[]> {
  const rows: BomRow[] = [];
  for (const project of projects) {
    for (const schematic of project.schematicFiles) {
      rows.push(...(await parseSchematic(path.resolve(root, schematic))).components);
    }
  }
  return rows;
}

function snapshotBomRow(root: string, row: BomRow): FabricationSnapshot["bom"][number] {
  return {
    reference: row.reference,
    sourcePath: sourcePath(root, row.sourcePath),
    value: row.value,
    footprint: row.footprint,
    manufacturer: row.manufacturer,
    mpn: row.mpn,
    suppliers: row.suppliers,
    lifecycle: row.lifecycle,
    dnp: row.dnp,
    quantity: row.quantity,
    compliance: row.compliance,
  };
}

async function projectScopedFiles(root: string, projects: ProjectContext[], patterns: string[]): Promise<string[]> {
  const files = await Promise.all(projects.map((project) => globFiles(path.resolve(root, project.root), patterns)));
  return [...new Set(files.flat())].sort((a, b) => a.localeCompare(b));
}

function sourcePath(root: string, source: string): string {
  return toPosixPath(path.isAbsolute(source) ? path.relative(root, source) : source);
}

function compareSnapshotBomRows(
  left: FabricationSnapshot["bom"][number],
  right: FabricationSnapshot["bom"][number],
): number {
  return left.reference.localeCompare(right.reference) || (left.sourcePath ?? "").localeCompare(right.sourcePath ?? "");
}

async function outputFromFiles(
  root: string,
  kind: string,
  files: string[],
): Promise<FabricationSnapshot["outputs"][number]> {
  return {
    kind,
    files: await Promise.all(
      files.map(async (file) => ({
        path: toPosixPath(path.relative(root, file)),
        digest: await hashFile(file),
      })),
    ),
  };
}

async function hashFile(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function outputFromRows(
  kind: string,
  rows: FabricationSnapshot["bom"],
): Promise<FabricationSnapshot["outputs"][number]> {
  return {
    kind,
    files:
      rows.length === 0
        ? []
        : [
            {
              path: "schematic",
              digest: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
            },
          ],
  };
}
