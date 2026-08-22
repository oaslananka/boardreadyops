import type { ReleaseRunResult } from "@boardreadyops/contracts";

export type FindingTemplateInput = {
  ruleId: string;
  severity: string;
  message: string;
  path?: string | undefined;
};

export type ArtifactTemplateInput = {
  kind: string;
  name: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  role: string;
};

export type ReportLinkTemplateInput = {
  label: string;
  url: string;
};

export type ReadinessTemplateInput = {
  score: number;
  status: "ready" | "at-risk" | "blocked" | string;
  blocking: number;
  nonBlocking: number;
  missingRequired: readonly string[];
  missingRecommended: readonly string[];
  warnings: readonly string[];
};

export type WaiverTemplateInput = {
  rule: string;
  owner: string;
  reason: string;
  expires?: string | undefined;
  stale: boolean;
  expired: boolean;
  matched: number;
};

export type RunTrustModeTemplateInput = "safe" | "standard";
export type SafeModeReasonTemplateInput = "draft-pull-request" | "fork-pull-request" | "private-repository";

export type ReadinessResultTemplateInput = {
  status: string;
  decision: string | null;
  findings?: readonly FindingTemplateInput[];
  artifacts?: readonly ArtifactTemplateInput[];
  metrics?: Readonly<Record<string, number>>;
  reportLinks?: readonly ReportLinkTemplateInput[];
  readiness?: ReadinessTemplateInput | undefined;
  waivers?:
    | {
        active: readonly WaiverTemplateInput[];
        expired: readonly WaiverTemplateInput[];
      }
    | undefined;
  detailsUrl?: string | undefined;
  trustMode?: RunTrustModeTemplateInput | undefined;
  safeModeReasons?: readonly SafeModeReasonTemplateInput[] | undefined;
  hardwareImpact?: ReleaseRunResult["hardwareImpact"] | undefined;
};

export declare function buildReadinessCheckOutput(input: ReadinessResultTemplateInput): {
  title: string;
  summary: string;
};

export declare function buildReadinessPrComment(input: ReadinessResultTemplateInput): string;
