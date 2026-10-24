import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CanvasAnchor, SnapshotArtifact, SnapshotFinding } from "@boardreadyops/contracts";
import { runProcess } from "../util/process.js";
import type { PcbOutlineBounds } from "./pcb.js";

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_SHEETS = 16;
const EXPORT_TIMEOUT_MS = 45_000;
const PROCESS_LIMITS = { timeoutMs: EXPORT_TIMEOUT_MS, maxStdoutBytes: 8192, maxStderrBytes: 8192 };

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceDigest(file: string): Promise<string> {
  return fs.readFile(file).then(digest);
}

/** Native output is still untrusted browser-bound content. */
export function normalizeKicadSvg(raw: string): { svg: string; width: number; height: number } | undefined {
  const svg = raw
    .replace(/<\?xml[^?]*\?>/giu, "")
    .replace(/<!DOCTYPE\s+svg\s+PUBLIC\s+["'][^"']+["']\s+["'][^"']+["']\s*>/giu, "")
    .trim();
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES || !svg.includes("</svg>")) return undefined;
  const opening = /<svg\b[^>]*>/isu.exec(svg)?.[0];
  const coordinates = opening
    ?.match(/\bviewBox\s*=\s*["']([^"']+)["']/iu)?.[1]
    ?.trim()
    .split(/\s+/u)
    .map(Number);
  if (coordinates?.length !== 4) return undefined;
  const width = coordinates[2];
  const height = coordinates[3];
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return undefined;
  if (/<(?:script|foreignObject|iframe|object|embed|animate|set)\b|<!ENTITY\b|@import\b/iu.test(svg)) return undefined;
  if (/\son[a-z]+\s*=/iu.test(svg)) return undefined;
  if ([...svg.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']+)["']/giu)].some((match) => !match[1]?.startsWith("#")))
    return undefined;
  if ([...svg.matchAll(/url\(\s*["']?([^)"']+)/giu)].some((match) => !match[1]?.trim().startsWith("#")))
    return undefined;
  return { svg, width, height };
}

/**
 * A marker points to a KiCad-reported *source object*, never to an inferred
 * DRC fault center. Only exact millimeter reports, layer-matched copper
 * objects with UUIDs, and a rectangular Edge.Cuts/plot alignment qualify.
 */
export function verifiedNativePcbItemAnchors(
  snapshot: SnapshotArtifact,
  bounds: PcbOutlineBounds,
  findings: readonly SnapshotFinding[],
): CanvasAnchor[] {
  const layer = snapshot.sheetOrLayer.endsWith(" / F.Cu")
    ? "F.Cu"
    : snapshot.sheetOrLayer.endsWith(" / B.Cu")
      ? "B.Cu"
      : undefined;
  if (
    snapshot.kind !== "pcb_layer" ||
    !snapshot.name.startsWith("kicad_native_") ||
    !layer ||
    snapshot.format !== "svg" ||
    !snapshot.content
  )
    return [];
  const opening = /<svg\b[^>]*>/isu.exec(snapshot.content)?.[0];
  const box = opening
    ?.match(/\bviewBox\s*=\s*["']([^"']+)["']/iu)?.[1]
    ?.trim()
    .split(/\s+/u)
    .map(Number);
  if (box?.length !== 4 || box.some((value) => !Number.isFinite(value))) return [];
  const [originX, originY, width, height] = box;
  const boardWidth = bounds.maxX - bounds.minX;
  const boardHeight = bounds.maxY - bounds.minY;
  if (
    originX === undefined ||
    originY === undefined ||
    width === undefined ||
    height === undefined ||
    Math.abs(originX) > 0.0001 ||
    Math.abs(originY) > 0.0001 ||
    // KiCad 10 quantizes plot dimensions (10.0 mm becomes 9.9822 mm).
    // Permit only narrow plot-unit rounding, never distinct board geometry.
    Math.abs(width - boardWidth) > 0.025 ||
    Math.abs(height - boardHeight) > 0.025 ||
    boardWidth <= 0 ||
    boardHeight <= 0
  )
    return [];

  const result: CanvasAnchor[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    if (
      !finding.ruleId.startsWith("drc.") ||
      !finding.fingerprint ||
      !finding.details ||
      finding.details.coordinate_units !== "mm" ||
      !Array.isArray(finding.details.items)
    )
      continue;
    for (const item of finding.details.items) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      const description = candidate.description;
      const uuid = candidate.uuid;
      const pos = candidate.pos;
      // Only KiCad's exact copper-layer suffix or its native track-length
      // variant qualifies; combined-layer zones remain excluded.
      const sourceLayer =
        typeof description === "string"
          ? /\bon ([FB]\.Cu)(?:, length \d+(?:\.\d+)? mm)?$/iu.exec(description.trim())?.[1]
          : undefined;
      if (
        typeof description !== "string" ||
        sourceLayer !== layer ||
        typeof uuid !== "string" ||
        !/^[a-f0-9-]{36}$/iu.test(uuid) ||
        !pos ||
        typeof pos !== "object"
      )
        continue;
      const { x, y } = pos as { x?: unknown; y?: unknown };
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      const xx = (x - bounds.minX) / boardWidth;
      const yy = (y - bounds.minY) / boardHeight;
      if (xx < 0 || xx > 1 || yy < 0 || yy > 1) continue;
      const key = `${finding.fingerprint}:${uuid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name =
        /\bof ([#\w]+) on [FB]\.Cu$/iu.exec(description)?.[1] ?? (description.startsWith("Track ") ? "Track" : "Item");
      result.push({
        id: `kicad_item_${finding.fingerprint.slice(0, 12)}_${uuid.slice(0, 8)}`,
        kind: "finding",
        targetRef: name,
        x: xx,
        y: yy,
        layer,
        metadata: {
          fingerprint: finding.fingerprint,
          ruleId: finding.ruleId,
          severity: finding.severity,
          message: finding.message.slice(0, 500),
          sourceUuid: uuid,
          provenance: "kicad-json-object-position",
          locationMeaning: "Referenced source object, not verified violation center",
        },
      });
      if (result.length >= 48) return result;
    }
  }
  return result;
}

async function collectSvg(
  output: string,
  beforeSha: string,
  sourceFile: string,
  kind: "schematic" | "pcb_layer",
  label: string,
): Promise<SnapshotArtifact | undefined> {
  const buffer = await fs.readFile(output);
  if (!buffer.length || buffer.length > MAX_SVG_BYTES) return undefined;
  const normalized = normalizeKicadSvg(buffer.toString("utf8"));
  if (!normalized || (await sourceDigest(sourceFile)) !== beforeSha) return undefined;
  const id = digest([beforeSha, label].join(":")).slice(0, 16);
  return {
    id: `snap_native_${id}`,
    name: `kicad_native_${label.replace(/[^a-zA-Z0-9_.-]/gu, "_")}.svg`,
    kind,
    format: "svg",
    sheetOrLayer: label,
    // PostgreSQL run_snapshots stores INTEGER dimensions. Preserve the exact
    // SVG viewBox in `content`; only round up the display metadata.
    width: Math.ceil(normalized.width),
    height: Math.ceil(normalized.height),
    content: normalized.svg,
    sha256: digest(normalized.svg),
    // Summary anchors cannot be mapped to genuine KiCad coordinates.
    anchors: [],
  };
}

async function stageSource(sourceFile: string, tempRoot: string, sourceSha: string): Promise<string | undefined> {
  const stage = path.join(tempRoot, "source");
  await fs.mkdir(stage);
  const input = path.join(stage, path.basename(sourceFile));
  await fs.copyFile(sourceFile, input);
  const adjacent = (await fs.readdir(path.dirname(sourceFile), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && /\.(kicad_sch|kicad_pro)$/iu.test(entry.name) && entry.name !== path.basename(sourceFile),
    )
    .slice(0, 32);
  await Promise.all(
    adjacent.map(async ({ name }) => {
      const from = path.join(path.dirname(sourceFile), name);
      if ((await fs.stat(from)).size <= MAX_SVG_BYTES * 4) await fs.copyFile(from, path.join(stage, name));
    }),
  );
  return (await sourceDigest(input)) === sourceSha ? input : undefined;
}

async function pcbLayer(
  cliPath: string,
  input: string,
  original: string,
  beforeSha: string,
  tempRoot: string,
  label: string,
  layer: string,
): Promise<SnapshotArtifact | undefined> {
  if (!/^(?:F|B|In\d+)\.Cu$/u.test(layer)) return undefined;
  const extras: string[] = [];
  if (layer === "F.Cu") extras.push("F.SilkS");
  if (layer === "B.Cu") extras.push("B.SilkS");
  const output = path.join(tempRoot, `pcb-${layer.replaceAll(".", "_")}.svg`);
  const result = await runProcess(
    cliPath,
    [
      "pcb",
      "export",
      "svg",
      "--layers",
      [layer, ...extras, "Edge.Cuts"].join(","),
      "--mode-single",
      "--fit-page-to-board",
      "--output",
      output,
      input,
    ],
    PROCESS_LIMITS,
  );
  if (result.code !== 0 || result.timedOut) return undefined;
  return collectSvg(output, beforeSha, original, "pcb_layer", `${label} / ${layer}`).catch(() => undefined);
}

async function pcbSnapshots(
  cliPath: string,
  input: string,
  original: string,
  beforeSha: string,
  tempRoot: string,
  label: string,
  layers: string[],
): Promise<SnapshotArtifact[]> {
  const found = await Promise.all(
    [...new Set(layers)]
      .slice(0, MAX_SHEETS)
      .map((layer) => pcbLayer(cliPath, input, original, beforeSha, tempRoot, label, layer)),
  );
  return found.filter((artifact): artifact is SnapshotArtifact => artifact !== undefined);
}

async function schematicSnapshots(
  cliPath: string,
  input: string,
  original: string,
  beforeSha: string,
  tempRoot: string,
  label: string,
): Promise<SnapshotArtifact[]> {
  const outputDirectory = path.join(tempRoot, "sheets");
  await fs.mkdir(outputDirectory, { recursive: true });
  const result = await runProcess(
    cliPath,
    ["sch", "export", "svg", "--output", outputDirectory, input],
    PROCESS_LIMITS,
  );
  if (result.code !== 0 || result.timedOut) return [];
  const names = (await fs.readdir(outputDirectory))
    .filter((name) => name.endsWith(".svg"))
    .sort()
    .slice(0, MAX_SHEETS);
  const found = await Promise.all(
    names.map((name) =>
      collectSvg(
        path.join(outputDirectory, name),
        beforeSha,
        original,
        "schematic",
        `${label} / ${name.replace(/\.svg$/iu, "")}`,
      ).catch(() => undefined),
    ),
  );
  return found.filter((artifact): artifact is SnapshotArtifact => artifact !== undefined);
}

/** Locally plot in an isolated, temporary KiCad project copy. */
export async function exportNativeKicadSnapshots(
  cliPath: string,
  sourceFile: string,
  kind: "schematic" | "pcb_layer",
  layers: string[] = [],
): Promise<SnapshotArtifact[]> {
  const beforeSha = await sourceDigest(sourceFile).catch(() => undefined);
  if (!beforeSha) return [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-native-svg-"));
  const label = path.basename(sourceFile).replace(/\.(kicad_sch|kicad_pcb)$/iu, "");
  try {
    const staged = await stageSource(sourceFile, directory, beforeSha);
    if (!staged) return [];
    return kind === "pcb_layer"
      ? await pcbSnapshots(cliPath, staged, sourceFile, beforeSha, directory, label, layers)
      : await schematicSnapshots(cliPath, staged, sourceFile, beforeSha, directory, label);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
