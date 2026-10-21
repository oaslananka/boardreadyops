export type HardwareImpactBaselineReason =
  | "not-found"
  | "invalid-artifact"
  | "unsupported-result"
  | "candidate-mismatch";

export interface HardwareImpactV1 {
  version: 1;
  baseline:
    | { status: "available"; sha: string }
    | { status: "unavailable"; sha: string; reason: HardwareImpactBaselineReason };
  candidate: { sha: string };
  facts: {
    readiness: {
      previousScore: number | null;
      currentScore: number | null;
      scoreDelta: number | null;
      previousStatus: "ready" | "at-risk" | "blocked" | null;
      currentStatus: "ready" | "at-risk" | "blocked" | null;
      statusChanged: boolean;
      /** Additive v1 fact: an observed release verdict change is independent of readiness score. */
      conclusion?: {
        previous: "passed" | "failed" | null;
        current: "passed" | "failed" | null;
        changed: boolean;
      };
    };
    findings: {
      added: number;
      resolved: number;
      addedBlocking: number;
      resolvedBlocking: number;
      /** Optional for compatibility with v1 results emitted before severity-delta support. */
      worsened?: number;
      improved?: number;
    };
    bom: {
      added: number;
      removed: number;
      changed: number;
      truncated: boolean;
    };
    manufacturing: {
      outputsAdded: number;
      outputsRemoved: number;
      outputsChanged: number;
    };
  };
  assessment: {
    materialChange: boolean;
    riskDirection: "increased" | "decreased" | "unchanged" | "unknown";
    affectedDomains: Array<"readiness" | "findings" | "bom" | "manufacturing">;
  };
  evidence: Array<{
    domain: "readiness" | "findings" | "bom" | "manufacturing";
    kind: "finding" | "bom-row" | "output" | "readiness";
    label: string;
    path?: string | undefined;
    ruleId?: string | undefined;
    severity?: string | undefined;
    fingerprint?: string | undefined;
  }>;
}
