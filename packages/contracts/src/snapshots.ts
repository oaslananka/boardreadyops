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
