import type { BomRow } from "../bom/types.js";
import type { BomRiskSummary } from "./bom-risk.js";
import type { ReleaseMode } from "./config.types.js";
import type { ProjectContext } from "./context.js";
import type { FabricationSnapshot } from "./diff/fabrication.js";
import type { HardwareImpactV1 } from "./diff/hardware-impact.types.js";
import type { Finding, FindingSummary } from "./findings.js";
import type { LoadedPlugin } from "./plugin-loader.js";
import type { PolicyEvaluation } from "./policy.js";
import type { ReadinessScore } from "./readiness.js";
import type { WaiverStatus } from "./waivers.js";

/**
 * One component of a project's BOM.
 *
 * Deliberately narrower than {@link BomRow}: it omits `raw`, which echoes every column of
 * the source CSV, including internal cost, supplier, or notes columns a team may not intend
 * to publish in a report artifact. Mirrors the lean shape `fabrication.bom` already uses.
 */
export interface ProjectBomComponent {
  reference: string;
  value?: string | undefined;
  footprint?: string | undefined;
  manufacturer?: string | undefined;
  mpn?: string | undefined;
  lifecycle?: string | undefined;
  dnp?: boolean | undefined;
  quantity?: number | undefined;
  identityKey?: string | undefined;
}

/** The component rows resolved for one KiCad project, as the BOM rules saw them. */
export interface ProjectBom {
  project: string;
  components: ProjectBomComponent[];
}

/** Narrows a resolved BOM row to the publishable component fields. */
export function projectBomComponent(row: BomRow): ProjectBomComponent {
  return {
    reference: row.reference,
    ...(row.value === undefined ? {} : { value: row.value }),
    ...(row.footprint === undefined ? {} : { footprint: row.footprint }),
    ...(row.manufacturer === undefined ? {} : { manufacturer: row.manufacturer }),
    ...(row.mpn === undefined ? {} : { mpn: row.mpn }),
    ...(row.lifecycle === undefined ? {} : { lifecycle: row.lifecycle }),
    ...(row.dnp === undefined ? {} : { dnp: row.dnp }),
    ...(row.quantity === undefined ? {} : { quantity: row.quantity }),
    ...(row.identityKey === undefined ? {} : { identityKey: row.identityKey }),
  };
}

export interface RunResult {
  schemaVersion: 1;
  tool: {
    name: "boardreadyops";
    version: string;
  };
  status?: "passed" | "failed" | undefined;
  exitCode?: number | undefined;
  releaseMode?: ReleaseMode | undefined;
  summary: FindingSummary;
  readiness?: ReadinessScore | undefined;
  bomRisk?: BomRiskSummary | undefined;
  policy?: PolicyEvaluation | undefined;
  waivers?: { active: WaiverStatus[]; expired: WaiverStatus[] } | undefined;
  projects: ProjectContext[];
  boms?: ProjectBom[] | undefined;
  findings: Finding[];
  fabrication: FabricationSnapshot;
  hardwareImpact?: HardwareImpactV1 | undefined;
  plugins?: LoadedPlugin[] | undefined;
  generatedAt: string;
}
