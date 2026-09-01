import { createHash } from "node:crypto";
import {
  createPcbLayerSvg,
  createSchematicSvg,
  linkFindingAnchors,
  type SnapshotArtifact,
} from "@boardreadyops/contracts";
import type { DemoFinding } from "./demo-data.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Builds real (not hand-drawn) review-canvas snapshots for the demo workspace from a review's
 * actual changed files and findings, using the same renderer the CLI uses for production runs.
 * Component layout is synthesized from the finding set touching each sheet/layer, since the demo
 * workspace has no underlying KiCad project to parse.
 */
export function buildDemoSnapshots(
  changedFiles: Array<{ path: string; status: "modified" | "added" | "deleted"; changesCount: number }>,
  findings: DemoFinding[],
): SnapshotArtifact[] {
  const artifacts: SnapshotArtifact[] = [];
  const snapshotFindings = findings.map((f) => ({
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    severity: f.severity,
    message: f.message,
    details: f.component ? { component: f.component.split(" ")[0] } : undefined,
  }));

  for (const file of changedFiles) {
    const fileName = file.path.split("/").pop() ?? file.path;

    if (file.path.endsWith(".kicad_sch")) {
      const sheetName = fileName.replace(/\.kicad_sch$/i, "");
      const sheetFindings = findings.filter((f) => f.sheet === sheetName || f.path === file.path);
      const components = uniqueComponents(sheetFindings);
      const nets = sheetFindings.map((_, i) => `NET_${i}_${sheetName.toUpperCase()}`);

      const { svg, anchors } = createSchematicSvg(sheetName, components, nets);
      artifacts.push({
        id: `demo_snap_sch_${sheetName}`,
        name: `schematic_${sheetName}.svg`,
        kind: "schematic",
        format: "svg",
        sheetOrLayer: sheetName,
        width: 1200,
        height: 800,
        content: svg,
        sha256: sha256(svg),
        anchors: linkFindingAnchors(anchors, snapshotFindings),
      });
    }

    if (file.path.endsWith(".kicad_pcb")) {
      const boardFindings = findings.filter((f) => f.path === file.path);
      const footprints = uniqueComponents(boardFindings).map((c) => ({ reference: c.reference, footprint: "" }));

      for (const layer of ["F.Cu", "B.Cu"]) {
        const { svg, anchors } = createPcbLayerSvg(layer, footprints);
        artifacts.push({
          id: `demo_snap_pcb_${layer.replaceAll(".", "_")}`,
          name: `pcb_${layer.replaceAll(".", "_")}.svg`,
          kind: "pcb_layer",
          format: "svg",
          sheetOrLayer: layer,
          width: 1000,
          height: 800,
          content: svg,
          sha256: sha256(svg),
          anchors: linkFindingAnchors(anchors, snapshotFindings),
        });
      }
    }
  }

  return artifacts;
}

function uniqueComponents(findings: DemoFinding[]): Array<{ reference: string; value?: string; footprint?: string }> {
  const seen = new Map<string, { reference: string; value?: string; footprint?: string }>();
  for (const finding of findings) {
    if (!finding.component) continue;
    const reference = finding.component.split(" ")[0] ?? finding.component;
    if (!seen.has(reference)) {
      seen.set(reference, { reference });
    }
  }
  return [...seen.values()];
}
