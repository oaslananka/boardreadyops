import { createHash } from "node:crypto";
import {
  createPcbLayerSvg,
  createSchematicSvg,
  linkFindingAnchors,
  type SnapshotArtifact,
  type SnapshotFinding,
} from "@boardreadyops/contracts";
import { parsePcb } from "./pcb.js";
import { parseSchematic } from "./schematic.js";

export { createPcbLayerSvg, createSchematicSvg, linkFindingAnchors };

export interface GenerateSnapshotsOptions {
  schematicFiles?: string[];
  pcbFiles?: string[];
  findings?: SnapshotFinding[];
}

async function renderSchematicFile(file: string, findings?: SnapshotFinding[]): Promise<SnapshotArtifact | undefined> {
  try {
    const parsed = await parseSchematic(file);
    const sheetName =
      file
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.kicad_sch$/i, "") ?? "Main";
    const { svg, anchors } = createSchematicSvg(
      sheetName,
      parsed.components.map((c) => ({ reference: c.reference, value: c.value, footprint: c.footprint })),
      Array.from(parsed.netLabels),
    );
    const linkedAnchors = findings ? linkFindingAnchors(anchors, findings) : anchors;
    const sha256 = createHash("sha256").update(svg).digest("hex");

    return {
      id: `snap_sch_${sheetName}`,
      name: `schematic_${sheetName}.svg`,
      kind: "schematic",
      format: "svg",
      sheetOrLayer: sheetName,
      width: 1200,
      height: 800,
      content: svg,
      sha256,
      anchors: linkedAnchors,
    };
  } catch {
    return undefined;
  }
}

async function renderPcbFile(file: string, findings?: SnapshotFinding[]): Promise<SnapshotArtifact[]> {
  const artifacts: SnapshotArtifact[] = [];
  try {
    const parsed = await parsePcb(file);
    const layersToRender = parsed.copperLayers.length > 0 ? parsed.copperLayers : ["F.Cu", "B.Cu"];

    for (const layer of layersToRender) {
      const { svg, anchors } = createPcbLayerSvg(
        layer,
        parsed.footprints.map((fp) => ({ reference: fp.reference, footprint: fp.footprint, at: fp.at })),
      );
      const linkedAnchors = findings ? linkFindingAnchors(anchors, findings) : anchors;
      const sha256 = createHash("sha256").update(svg).digest("hex");

      artifacts.push({
        id: `snap_pcb_${layer.replaceAll(".", "_")}`,
        name: `pcb_${layer.replaceAll(".", "_")}.svg`,
        kind: "pcb_layer",
        format: "svg",
        sheetOrLayer: layer,
        width: 1000,
        height: 800,
        content: svg,
        sha256,
        anchors: linkedAnchors,
      });
    }
  } catch {
    // Fallback
  }
  return artifacts;
}

export async function generateSnapshots(options: GenerateSnapshotsOptions): Promise<SnapshotArtifact[]> {
  const artifacts: SnapshotArtifact[] = [];

  for (const file of options.schematicFiles ?? []) {
    const artifact = await renderSchematicFile(file, options.findings);
    if (artifact) artifacts.push(artifact);
  }

  for (const file of options.pcbFiles ?? []) {
    const pcbArtifacts = await renderPcbFile(file, options.findings);
    artifacts.push(...pcbArtifacts);
  }

  return artifacts;
}
