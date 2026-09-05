import { z } from "zod";

export const cadFormatSchema = z.enum(["kicad", "altium", "easyeda", "fusion360", "ipc2581", "generic_gerber"]);
export type CadFormat = z.infer<typeof cadFormatSchema>;

export const packageSourceTypeSchema = z.enum(["git_checkout", "upload_bundle", "native_export"]);
export type PackageSourceType = z.infer<typeof packageSourceTypeSchema>;

export const ingestionCapabilitiesSchema = z.object({
  hasGerberOutlines: z.boolean(),
  hasPlatedHoles: z.boolean(),
  hasNonPlatedHoles: z.boolean(),
  hasBomMapping: z.boolean(),
  hasCentroidPlacement: z.boolean(),
  hasNetlistConnectivity: z.boolean(),
  hasSchematicHierarchies: z.boolean(),
});
export type IngestionCapabilities = z.infer<typeof ingestionCapabilitiesSchema>;

export const normalizedBoardMetadataSchema = z.object({
  name: z.string().min(1).max(256),
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  layerCount: z.number().int().positive().optional(),
});
export type NormalizedBoardMetadata = z.infer<typeof normalizedBoardMetadataSchema>;

export const layerRoleSchema = z.enum([
  "copper",
  "soldermask",
  "silkscreen",
  "solderpaste",
  "drill",
  "outline",
  "other",
]);
export type LayerRole = z.infer<typeof layerRoleSchema>;

export const layerSideSchema = z.enum(["top", "bottom", "inner", "both", "none"]);
export type LayerSide = z.infer<typeof layerSideSchema>;

export const normalizedLayerSchema = z.object({
  name: z.string().min(1),
  role: layerRoleSchema,
  side: layerSideSchema,
  index: z.number().int().positive().optional(),
  filename: z.string().min(1),
});
export type NormalizedLayer = z.infer<typeof normalizedLayerSchema>;

export const componentSideSchema = z.enum(["top", "bottom"]);
export type ComponentSide = z.infer<typeof componentSideSchema>;

export const normalizedComponentSchema = z.object({
  refDes: z.string().min(1),
  value: z.string(),
  footprint: z.string(),
  mpn: z.string().optional(),
  manufacturer: z.string().optional(),
  side: componentSideSchema,
  xMm: z.number().optional(),
  yMm: z.number().optional(),
  rotationDegrees: z.number().optional(),
  dnp: z.boolean(),
  sourceFile: z.string().min(1),
});
export type NormalizedComponent = z.infer<typeof normalizedComponentSchema>;

export const normalizedDrillHoleSchema = z.object({
  xMm: z.number(),
  yMm: z.number(),
  diameterMm: z.number().positive(),
  plated: z.boolean(),
});
export type NormalizedDrillHole = z.infer<typeof normalizedDrillHoleSchema>;

export const parserWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
});
export type ParserWarning = z.infer<typeof parserWarningSchema>;

export const netConnectionSchema = z.object({
  componentRef: z.string().min(1),
  pin: z.string().min(1),
});
export type NetConnection = z.infer<typeof netConnectionSchema>;

export const netlistSchema = z.record(z.string(), z.array(netConnectionSchema));
export type Netlist = z.infer<typeof netlistSchema>;

export const normalizedPcbPackageSchema = z.object({
  format: cadFormatSchema,
  formatVersion: z.string().optional(),
  sourceType: packageSourceTypeSchema,
  capabilities: ingestionCapabilitiesSchema,
  board: normalizedBoardMetadataSchema,
  layers: z.array(normalizedLayerSchema),
  components: z.array(normalizedComponentSchema),
  drillHoles: z.array(normalizedDrillHoleSchema),
  netlist: netlistSchema.optional(),
  parserWarnings: z.array(parserWarningSchema),
});
export type NormalizedPcbPackage = z.infer<typeof normalizedPcbPackageSchema>;

export function hasMinimumReviewCapabilities(capabilities: IngestionCapabilities): boolean {
  return capabilities.hasGerberOutlines && (capabilities.hasPlatedHoles || capabilities.hasNonPlatedHoles);
}
