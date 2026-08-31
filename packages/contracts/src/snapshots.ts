import { z } from "zod";

export const snapshotFormatSchema = z.enum(["svg", "png", "webp"]);
export type SnapshotFormat = z.infer<typeof snapshotFormatSchema>;

export const snapshotKindSchema = z.enum(["schematic", "pcb_layer", "3d_render"]);
export type SnapshotKind = z.infer<typeof snapshotKindSchema>;

export const canvasAnchorKindSchema = z.enum(["component", "net", "finding", "comment", "zone"]);
export type CanvasAnchorKind = z.infer<typeof canvasAnchorKindSchema>;

export const canvasAnchorSchema = z.object({
  id: z.string().min(1),
  kind: canvasAnchorKindSchema,
  targetRef: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  sheet: z.string().optional(),
  layer: z.string().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CanvasAnchor = z.infer<typeof canvasAnchorSchema>;

export const snapshotArtifactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: snapshotKindSchema,
  format: snapshotFormatSchema,
  sheetOrLayer: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  content: z.string().optional(), // SVG string or data URL
  sha256: z.string().min(64).max(64),
  anchors: z.array(canvasAnchorSchema).default([]),
});
export type SnapshotArtifact = z.infer<typeof snapshotArtifactSchema>;

export const snapshotManifestSchema = z.object({
  version: z.literal(1),
  baseSha: z.string().min(7).max(64),
  headSha: z.string().min(7).max(64),
  baseSnapshots: z.array(snapshotArtifactSchema),
  headSnapshots: z.array(snapshotArtifactSchema),
  createdAt: z.string().datetime(),
});
export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

/**
 * Pure SVG rendering for review-canvas snapshots. Deliberately free of KiCad file-parsing
 * dependencies so both the CLI (which feeds it parsed schematic/PCB data) and the web app
 * (which feeds it demo/fixture data) can render identical, safely-escaped markup without
 * either depending on the other's package.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export type SnapshotFinding = {
  fingerprint: string;
  ruleId: string;
  severity: string;
  message: string;
  details?: Record<string, unknown> | undefined;
};

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
      <g id="comp-${escapeXml(comp.reference)}" class="schematic-symbol" transform="translate(${x}, ${y})">
        <rect width="${compWidth}" height="${compHeight}" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />
        <text x="12" y="30" fill="#f8fafc" font-family="monospace" font-size="16" font-weight="bold">${escapeXml(comp.reference)}</text>
        <text x="12" y="55" fill="#94a3b8" font-family="sans-serif" font-size="13">${escapeXml(comp.value ?? "")}</text>
        <text x="12" y="80" fill="#64748b" font-family="monospace" font-size="11">${escapeXml(comp.footprint ?? "")}</text>
        <circle cx="0" cy="50" r="4" fill="#38bdf8" />
        <circle cx="${compWidth}" cy="50" r="4" fill="#38bdf8" />
      </g>
    `;
  });

  // Net labels banner at bottom
  if (nets.length > 0) {
    const netList = escapeXml(nets.slice(0, 12).join(" • "));
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
      <text x="${paddingX}" y="40" fill="#f8fafc" font-family="sans-serif" font-size="20" font-weight="bold">Sheet: ${escapeXml(sheetName)}</text>
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
      <g id="pcb-fp-${escapeXml(fp.reference)}" transform="translate(${x}, ${y})">
        <rect width="${w}" height="${h}" rx="2" fill="none" stroke="${layerColor}" stroke-width="2" />
        <rect x="5" y="5" width="8" height="8" fill="${layerColor}" />
        <rect x="${w - 13}" y="5" width="8" height="8" fill="${layerColor}" />
        <rect x="5" y="${h - 13}" width="8" height="8" fill="${layerColor}" />
        <rect x="${w - 13}" y="${h - 13}" width="8" height="8" fill="${layerColor}" />
        <text x="${w / 2}" y="${h / 2 + 4}" fill="#f8fafc" font-family="monospace" font-size="10" text-anchor="middle">${escapeXml(fp.reference)}</text>
      </g>
    `;
  });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #022c22;">
      <!-- Board Edge.Cuts -->
      <rect x="${boardX}" y="${boardY}" width="${boardW}" height="${boardH}" rx="8" fill="#064e3b" stroke="#eab308" stroke-width="3" />
      <text x="${boardX + 20}" y="${boardY + 40}" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold">Layer: ${escapeXml(layerName)}</text>
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
  const match = /\b([A-Z]{1,3}\d{1,4})\b/.exec(finding.message);
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
