import type { BomRiskSummary } from "./bom-risk.js";
import type { ReleaseMode } from "./config.types.js";
import type { ProjectContext } from "./context.js";
import type { FabricationSnapshot } from "./diff/fabrication.js";
import type { Finding, FindingSummary } from "./findings.js";
import type { LoadedPlugin } from "./plugin-loader.js";
import type { PolicyEvaluation } from "./policy.js";
import type { ReadinessScore } from "./readiness.js";
import type { WaiverStatus } from "./waivers.js";

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
  findings: Finding[];
  fabrication: FabricationSnapshot;
  plugins?: LoadedPlugin[] | undefined;
  generatedAt: string;
}
