import type { BoardReadyOpsConfig } from "./config.js";
import type { ReleaseMode } from "./config.types.js";
import type { FailOn } from "./findings.js";
import type { Logger } from "./logger.js";

type RunMode = "warn" | "enforce";

export interface ProjectContext {
  projectFile: string;
  root: string;
  schematicFiles: string[];
  boardFiles: string[];
  jobsetFiles: string[];
}

export interface PipelineOptions {
  cwd: string;
  path: string;
  project: string | undefined;
  config: string | undefined;
  mode: RunMode;
  releaseMode?: ReleaseMode | undefined;
  requireKicad: boolean;
  kicadCli: string | undefined;
  bom: string | undefined;
  pinmap: string | undefined;
  variant: string | undefined;
  concurrency: number;
  failOn: FailOn;
  gate: string | undefined;
  gateAutoDetected?: boolean;
  rules: string[];
  skips: string[];
  ignoreBaseline: boolean;
  annotations: boolean;
  quiet: boolean;
  verbose: boolean;
  color: "auto" | "always" | "never";
  notificationLinks?: {
    reportUrl?: string | undefined;
    runUrl?: string | undefined;
  };
}

export interface RuleContext {
  root: string;
  projects: ProjectContext[];
  config: BoardReadyOpsConfig;
  options: PipelineOptions;
  logger: Logger;
}
