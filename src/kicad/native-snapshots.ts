import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SnapshotArtifact } from "@boardreadyops/contracts";
import { runProcess } from "../util/process.js";

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_SHEETS = 16;
const EXPORT_TIMEOUT_MS = 45_000;

function digest(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Accept only self-contained SVG exported by the local KiCad CLI.
 * In particular, do not preserve an external DTD or allow externally linked
 * resources in an image that will later be displayed in a browser.
 */
export function normalizeKicadSvg(raw: string): { svg: string; width: number; height: number } | undefined {
  const svg = raw
    .replace(/<\?xml[^?]*\?>/giu, "")
    .replace(/<!DOCTYPE\s+svg\s+PUBLIC\s+["'][^"']+["']\s+["'][^"']+["']\s*>/giu, "")
    .trim();
  const opening = /<svg\b[^>]*>/isu.exec(svg)?.[0];
  const dimensions =
    opening && /\bviewBox\s*=\s*["']\s*([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/iu.exec(opening);
  if (!opening || !dimensions || !svg.includes("</svg>")) return undefined;
  const width = Number(dimensions[3]);
  const height = Number(dimensions[4]);
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return undefined;
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) return undefined;
  if (/<(?:script|foreignObject|iframe|object|embed|animate|set)\b|<!ENTITY\b|@import\b/iu.test(svg)) {
    return undefined;
  }
  if (/\son[a-z]+\s*=/iu.test(svg)) return undefined;
  for (const match of svg.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']+)["']/giu)) {
    if (!match[1]?.startsWith("#")) return undefined;
  }
  // SVG filter/fill URLs are limited to fragment references within the exported SVG.
  for (const match of svg.matchAll(/url\(\s*["']?([^)"']+)/giu)) {
    if (!match[1]?.trim().startsWith("#")) return undefined;
  }
  return { svg, width, height };
}

async function sourceDigest(file: string): Promise<string> {
  return digest(await fs.readFile(file));
}

async function collectSvg(
  output: string,
  beforeSha: string,
  sourceFile: string,
  kind: SnapshotArtifact["kind"],
  label: string,
): Promise<SnapshotArtifact | undefined> {
  const buffer = await fs.readFile(output);
  if (buffer.length === 0 || buffer.length > MAX_SVG_BYTES) return undefined;
  const normalized = normalizeKicadSvg(buffer.toString("utf8"));
  if (!normalized || (await sourceDigest(sourceFile)) !== beforeSha) return undefined;
  const id = digest([beforeSha, label].join(":")).slice(0, 16);
  return {
    id: `snap_native_${id}`,
    name: `kicad_native_${label.replace(/[^a-zA-Z0-9_.-]/gu, "_")}.svg`,
    kind,
    format: "svg",
    sheetOrLayer: label,
    width: normalized.width,
    height: normalized.height,
    content: normalized.svg,
    sha256: digest(normalized.svg),
    // Do not overlay synthetic component or fault coordinates onto a native plot.
    anchors: [],
  };
}

/**
 * No network or hosted KiCad calls. The native SVG is produced in a temporary
 * directory from the exact local file given by the authenticated publisher.
 * Missing/incompatible KiCad simply returns no native images to the caller.
 */
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
  const exports: SnapshotArtifact[] = [];

  try {
    // KiCad may create .kicad_prl beside its input. Render against a temporary
    // read-only-in-practice copy so the customer's source workspace stays clean.
    // Carry adjacent project sheets/settings needed for conventional hierarchies.
    const staging = path.join(directory, "source");
    await fs.mkdir(staging);
    const sourceDir = path.dirname(sourceFile);
    const inputFile = path.join(staging, path.basename(sourceFile));
    await fs.copyFile(sourceFile, inputFile);
    const adjacent = (await fs.readdir(sourceDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(kicad_sch|kicad_pro)$/iu.test(entry.name))
      .slice(0, 32);
    for (const entry of adjacent) {
      if (entry.name === path.basename(sourceFile)) continue;
      const from = path.join(sourceDir, entry.name);
      const stat = await fs.stat(from);
      if (stat.size <= MAX_SVG_BYTES * 4) await fs.copyFile(from, path.join(staging, entry.name));
    }
    if ((await sourceDigest(inputFile)) !== beforeSha) return [];

    if (kind === "pcb_layer") {
      for (const layer of layers.slice(0, MAX_SHEETS)) {
        if (!/^(?:F|B|In\d+)\.Cu$/u.test(layer)) continue;
        const supportingLayers: string[] = [];
        if (layer === "F.Cu") supportingLayers.push("F.SilkS");
        if (layer === "B.Cu") supportingLayers.push("B.SilkS");
        const output = path.join(directory, `pcb-${layer.replaceAll(".", "_")}.svg`);
        const processResult = await runProcess(
          cliPath,
          [
            "pcb",
            "export",
            "svg",
            "--layers",
            [layer, ...supportingLayers, "Edge.Cuts"].join(","),
            "--mode-single",
            "--fit-page-to-board",
            "--output",
            output,
            inputFile,
          ],
          { timeoutMs: EXPORT_TIMEOUT_MS, maxStdoutBytes: 8192, maxStderrBytes: 8192 },
        );
        if (processResult.code !== 0 || processResult.timedOut) continue;
        const artifact = await collectSvg(output, beforeSha, sourceFile, "pcb_layer", `${label} / ${layer}`).catch(
          () => undefined,
        );
        if (artifact) exports.push(artifact);
      }
    } else {
      const outputDirectory = path.join(directory, "sheets");
      await fs.mkdir(outputDirectory, { recursive: true });
      const result = await runProcess(cliPath, ["sch", "export", "svg", "--output", outputDirectory, inputFile], {
        timeoutMs: EXPORT_TIMEOUT_MS,
        maxStdoutBytes: 8192,
        maxStderrBytes: 8192,
      });
      if (result.code === 0 && !result.timedOut) {
        const names = (await fs.readdir(outputDirectory))
          .filter((name) => name.endsWith(".svg"))
          .sort()
          .slice(0, MAX_SHEETS);
        for (const name of names) {
          const sheetName = name.replace(/\.svg$/iu, "");
          const artifact = await collectSvg(
            path.join(outputDirectory, name),
            beforeSha,
            sourceFile,
            "schematic",
            `${label} / ${sheetName}`,
          ).catch(() => undefined);
          if (artifact) exports.push(artifact);
        }
      }
    }
    return exports;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
