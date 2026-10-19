import { createHash } from "node:crypto";
import {
  createPcbLayerSvg,
  createSchematicSvg,
  linkFindingAnchors,
  type SnapshotArtifact,
  type SnapshotFinding,
} from "@boardreadyops/contracts";
import { detectKicadCli } from "./cli.js";
import { exportNativeKicadSnapshots, verifiedNativePcbItemAnchors } from "./native-snapshots.js";
import { parsePcb } from "./pcb.js";
import { parseSchematic } from "./schematic.js";

export { createPcbLayerSvg, createSchematicSvg, linkFindingAnchors };

export interface GenerateSnapshotsOptions {
  schematicFiles?: string[];
  pcbFiles?: string[];
  findings?: SnapshotFinding[];
  /** Explicitly disable native plotting for non-native fixtures or compatibility. */
  nativeCli?: string | false;
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

async function schematicOrSummary(
  file: string,
  cliPath: string | undefined,
  findings: SnapshotFinding[] | undefined,
): Promise<SnapshotArtifact[]> {
  const native = cliPath ? await exportNativeKicadSnapshots(cliPath, file, "schematic").catch(() => []) : [];
  if (native.length) return native;
  const summary = await renderSchematicFile(file, findings);
  return summary ? [summary] : [];
}

async function pcbOrSummary(
  file: string,
  cliPath: string | undefined,
  findings: SnapshotFinding[] | undefined,
): Promise<SnapshotArtifact[]> {
  if (cliPath) {
    const pcb = await parsePcb(file).catch(() => undefined);
    const layers = pcb?.copperLayers ?? [];
    const native = await exportNativeKicadSnapshots(
      cliPath,
      file,
      "pcb_layer",
      layers.length ? layers : ["F.Cu", "B.Cu"],
    ).catch(() => []);
    if (native.length) {
      const bounds = pcb?.outlineBounds;
      return bounds && findings?.length
        ? native.map((snapshot) => ({
            ...snapshot,
            anchors: verifiedNativePcbItemAnchors(snapshot, bounds, findings),
          }))
        : native;
    }
  }
  return renderPcbFile(file, findings);
}

export async function generateSnapshots(options: GenerateSnapshotsOptions): Promise<SnapshotArtifact[]> {
  const cliPath = typeof options.nativeCli === "string" ? options.nativeCli : undefined;
  const cli = options.nativeCli === false ? undefined : await detectKicadCli(cliPath);
  const nativeCliPath = cli?.found ? cli.path : undefined;
  const schematics = (options.schematicFiles ?? []).map((file) =>
    schematicOrSummary(file, nativeCliPath, options.findings),
  );
  const boards = (options.pcbFiles ?? []).map((file) => pcbOrSummary(file, nativeCliPath, options.findings));
  const rendered = await Promise.all([...schematics, ...boards]);
  return rendered.flat().slice(0, 64);
}
