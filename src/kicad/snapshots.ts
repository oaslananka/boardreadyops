import { createHash } from "node:crypto";
import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { parsePcb } from "./pcb.js";
import { parseSchematic } from "./schematic.js";

export type SnapshotFinding = {
  fingerprint: string;
  ruleId: string;
  severity: string;
  message: string;
  details?: Record<string, unknown> | undefined;
};

export interface GenerateSnapshotsOptions {
  schematicFiles?: string[];
  pcbFiles?: string[];
  findings?: SnapshotFinding[];
}

export function createSchematicSvg(
  sheetName: string,
  components: Array<{ reference: string; value?: string | undefined; footprint?: string | undefined }>,
  nets: string[],
): { svg: string; anchors: CanvasAnchor[] } {
  const width = 1200;
  const height = 800;
  const anchors: CanvasAnchor[] = [];

  const cols = 4;
  const compWidth = 200;
  const compHeight = 100;
  const paddingX = 60;
  const paddingY = 80;

  let elementsSvg = "";

  components.forEach((comp, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = paddingX + col * (compWidth + 70);
    const y = paddingY + row * (compHeight + 50);

    const anchorId = `anchor_comp_${comp.reference}`;
    anchors.push({
      id: anchorId,
      kind: "component",
      targetRef: comp.reference,
      x: (x + compWidth / 2) / width,
      y: (y + compHeight / 2) / height,
      width: compWidth / width,
      height: compHeight / height,
      sheet: sheetName,
      metadata: {
        value: comp.value ?? "",
        footprint: comp.footprint ?? "",
      },
    });

    elementsSvg += `
      <g id="comp-${comp.reference}" class="schematic-symbol" transform="translate(${x}, ${y})">
        <rect width="${compWidth}" height="${compHeight}" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />
        <text x="12" y="30" fill="#f8fafc" font-family="monospace" font-size="16" font-weight="bold">${comp.reference}</text>
        <text x="12" y="55" fill="#94a3b8" font-family="sans-serif" font-size="13">${comp.value ?? ""}</text>
        <text x="12" y="80" fill="#64748b" font-family="monospace" font-size="11">${comp.footprint ?? ""}</text>
        <circle cx="0" cy="50" r="4" fill="#38bdf8" />
        <circle cx="${compWidth}" cy="50" r="4" fill="#38bdf8" />
      </g>
    `;
  });

  // Net labels banner at bottom
  if (nets.length > 0) {
    const netList = nets.slice(0, 12).join(" • ");
    elementsSvg += `
      <g transform="translate(${paddingX}, ${height - 40})">
        <text x="0" y="0" fill="#38bdf8" font-family="monospace" font-size="12">NETS: ${netList}</text>
      </g>
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #0f172a;">
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#334155" />
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grid)" />
      <text x="${paddingX}" y="40" fill="#f8fafc" font-family="sans-serif" font-size="20" font-weight="bold">Sheet: ${sheetName}</text>
      ${elementsSvg}
    </svg>
  `.trim();

  return { svg, anchors };
}

export function createPcbLayerSvg(
  layerName: string,
  footprints: Array<{
    reference: string;
    footprint: string;
    at?: { x: number; y: number; rotation?: number | undefined } | undefined;
  }>,
): { svg: string; anchors: CanvasAnchor[] } {
  const width = 1000;
  const height = 800;
  const anchors: CanvasAnchor[] = [];

  const boardX = 100;
  const boardY = 100;
  const boardW = 800;
  const boardH = 600;

  let fpSvg = "";
  const isTop = layerName.startsWith("F.");
  const layerColor = isTop ? "#ef4444" : "#3b82f6";

  footprints.forEach((fp, idx) => {
    // Map footprint coordinate (or generate grid layout if coordinates missing)
    const rawX = fp.at?.x ?? 50 + (idx % 6) * 120;
    const rawY = fp.at?.y ?? 50 + Math.floor(idx / 6) * 100;
    const x = boardX + (rawX % (boardW - 100));
    const y = boardY + (rawY % (boardH - 100));

    const w = 60;
    const h = 40;

    anchors.push({
      id: `anchor_pcb_${fp.reference}`,
      kind: "component",
      targetRef: fp.reference,
      x: (x + w / 2) / width,
      y: (y + h / 2) / height,
      width: w / width,
      height: h / height,
      layer: layerName,
      metadata: {
        footprint: fp.footprint,
      },
    });

    fpSvg += `
      <g id="pcb-fp-${fp.reference}" transform="translate(${x}, ${y})">
        <rect width="${w}" height="${h}" rx="2" fill="none" stroke="${layerColor}" stroke-width="2" />
        <rect x="5" y="5" width="8" height="8" fill="${layerColor}" />
        <rect x="${w - 13}" y="5" width="8" height="8" fill="${layerColor}" />
        <rect x="5" y="${h - 13}" width="8" height="8" fill="${layerColor}" />
        <rect x="${w - 13}" y="${h - 13}" width="8" height="8" fill="${layerColor}" />
        <text x="${w / 2}" y="${h / 2 + 4}" fill="#f8fafc" font-family="monospace" font-size="10" text-anchor="middle">${fp.reference}</text>
      </g>
    `;
  });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #022c22;">
      <!-- Board Edge.Cuts -->
      <rect x="${boardX}" y="${boardY}" width="${boardW}" height="${boardH}" rx="8" fill="#064e3b" stroke="#eab308" stroke-width="3" />
      <text x="${boardX + 20}" y="${boardY + 40}" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold">Layer: ${layerName}</text>
      ${fpSvg}
    </svg>
  `.trim();

  return { svg, anchors };
}

function extractComponentReference(finding: SnapshotFinding): string | undefined {
  if (finding.details && typeof finding.details === "object") {
    const d = finding.details as Record<string, unknown>;
    const comp = d.component ?? d.reference ?? d.designator ?? d.symbol;
    if (typeof comp === "string") return comp;
  }
  const match = finding.message.match(/\b([A-Z]{1,3}\d{1,4})\b/);
  return match ? match[1] : undefined;
}

export function linkFindingAnchors(anchors: CanvasAnchor[], findings: SnapshotFinding[]): CanvasAnchor[] {
  const result = [...anchors];

  findings.forEach((finding) => {
    const compRef = extractComponentReference(finding);
    if (!compRef) return;
    const targetComp = result.find((a) => a.kind === "component" && a.targetRef === compRef);
    if (targetComp) {
      result.push({
        id: `anchor_finding_${finding.fingerprint}`,
        kind: "finding",
        targetRef: compRef,
        x: targetComp.x,
        y: targetComp.y,
        sheet: targetComp.sheet,
        layer: targetComp.layer,
        metadata: {
          fingerprint: finding.fingerprint,
          ruleId: finding.ruleId,
          severity: finding.severity,
          message: finding.message,
        },
      });
    }
  });

  return result;
}

export async function generateSnapshots(options: GenerateSnapshotsOptions): Promise<SnapshotArtifact[]> {
  const artifacts: SnapshotArtifact[] = [];

  if (options.schematicFiles && options.schematicFiles.length > 0) {
    for (const file of options.schematicFiles) {
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
        const linkedAnchors = options.findings ? linkFindingAnchors(anchors, options.findings) : anchors;
        const sha256 = createHash("sha256").update(svg).digest("hex");

        artifacts.push({
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
        });
      } catch {
        // Fallback for mock/empty files
      }
    }
  }

  if (options.pcbFiles && options.pcbFiles.length > 0) {
    for (const file of options.pcbFiles) {
      try {
        const parsed = await parsePcb(file);
        const layersToRender = parsed.copperLayers.length > 0 ? parsed.copperLayers : ["F.Cu", "B.Cu"];

        for (const layer of layersToRender) {
          const { svg, anchors } = createPcbLayerSvg(
            layer,
            parsed.footprints.map((fp) => ({ reference: fp.reference, footprint: fp.footprint, at: fp.at })),
          );
          const linkedAnchors = options.findings ? linkFindingAnchors(anchors, options.findings) : anchors;
          const sha256 = createHash("sha256").update(svg).digest("hex");

          artifacts.push({
            id: `snap_pcb_${layer.replace(/\./g, "_")}`,
            name: `pcb_${layer.replace(/\./g, "_")}.svg`,
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
    }
  }

  return artifacts;
}
