import path from "node:path";
import type { RuleContext } from "../../core/context.js";
import { type PcbFootprint, parsePcb } from "../../kicad/pcb.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";

export function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export async function parsedBoards(context: RuleContext): Promise<Array<{ path: string; footprints: PcbFootprint[] }>> {
  const boards = [];
  for (const project of context.projects) {
    for (const board of project.boardFiles) {
      boards.push({ path: board, footprints: (await parsePcb(path.resolve(context.root, board))).footprints });
    }
  }
  return boards;
}

export function isFiducial(footprint: PcbFootprint): boolean {
  return /^FID\d*$/i.test(footprint.reference) || /(^|[:_-])fiducial([:_-]|$)/i.test(footprint.footprint);
}

export function isToolingHole(footprint: PcbFootprint): boolean {
  return /^MH\d*$/i.test(footprint.reference) || /mountinghole|tooling[_-]?hole|npth/i.test(footprint.footprint);
}

export function isTestPoint(footprint: PcbFootprint): boolean {
  return /^TP\d*$/i.test(footprint.reference) || /test[_-]?point/i.test(footprint.footprint);
}

export function footprintSide(footprint: PcbFootprint): "top" | "bottom" | "unknown" {
  if (footprint.layers.some((layer) => /^B\./i.test(layer))) {
    return "bottom";
  }
  if (footprint.layers.some((layer) => /^F\./i.test(layer))) {
    return "top";
  }
  return "unknown";
}

export function assemblyFootprints(footprints: PcbFootprint[]): PcbFootprint[] {
  return footprints.filter(
    (footprint) => !footprint.dnp && !footprint.boardOnly && !isFiducial(footprint) && !isToolingHole(footprint),
  );
}

export async function positionOutputText(
  root: string,
  searchRoots: string[],
  patterns: string[] = defaultPositionPatterns(),
): Promise<{ files: string[]; text: string }> {
  const files = new Set<string>();
  for (const searchRoot of normalizedSearchRoots(searchRoots)) {
    const directory = path.resolve(root, searchRoot);
    for (const file of await globFiles(directory, patterns)) {
      files.add(file);
    }
  }
  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
  const texts = await Promise.all(sortedFiles.map((file) => readTextFile(file).catch(() => "")));
  return { files: sortedFiles.map((file) => path.relative(root, file)), text: texts.join("\n") };
}

export function projectOutputSearchRoots(context: RuleContext): string[] {
  return [
    ...new Set(
      context.projects.flatMap((project) =>
        [project.projectFile, ...project.boardFiles, ...project.schematicFiles, ...project.jobsetFiles]
          .map((entry) => path.dirname(entry))
          .filter((entry) => entry.length > 0),
      ),
    ),
  ];
}

function normalizedSearchRoots(searchRoots: string[]): string[] {
  const roots = searchRoots.length > 0 ? searchRoots : ["."];
  return [...new Set(roots.map((entry) => (entry === "." ? "." : entry.replaceAll("\\", "/"))))];
}

function defaultPositionPatterns(): string[] {
  return ["**/*.pos", "**/*pos*.csv", "**/*position*.csv", "**/*positions*.csv", "**/*cpl*.csv", "**/*centroid*.csv"];
}

export function missingReferences(text: string, references: string[]): string[] {
  const uniqueReferences = [...new Set(references)].filter((reference) => reference.length > 0);
  if (uniqueReferences.length === 0) {
    return [];
  }
  const alternatives = uniqueReferences.map((reference) => reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const found = new Set<string>();
  const matcher = new RegExp(`(^|[^A-Za-z0-9_])(${alternatives})(?=[^A-Za-z0-9_]|$)`, "gm");
  for (const match of text.matchAll(matcher)) {
    found.add(match[2] ?? "");
  }
  return uniqueReferences.filter((reference) => !found.has(reference));
}
